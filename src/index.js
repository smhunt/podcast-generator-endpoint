import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createWriteStream, writeFileSync, renameSync, unlinkSync, existsSync } from 'fs';
import { mkdir, readdir, stat, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import NodeID3 from 'node-id3';
import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';

const execAsync = promisify(exec);

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3087;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/audio', express.static(path.join(__dirname, '../audio')));

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// TTS Pricing (per 1M characters)
const TTS_PRICING = {
  'tts-1': 15.00,      // $15 per 1M chars
  'tts-1-hd': 30.00,   // $30 per 1M chars
};

// Track session totals
let sessionStats = {
  totalGenerations: 0,
  totalCharacters: 0,
  totalCost: 0,
  startedAt: new Date().toISOString(),
};

// Ensure audio directory exists
await mkdir(path.join(__dirname, '../audio'), { recursive: true });

// Podcast metadata storage (for titles, descriptions)
const metadataPath = path.join(__dirname, '../audio/metadata.json');
let podcastMetadata = {};

// Load existing metadata
try {
  if (existsSync(metadataPath)) {
    const data = await readFile(metadataPath, 'utf-8');
    podcastMetadata = JSON.parse(data);
  }
} catch (e) {
  podcastMetadata = {};
}

// Save metadata helper
async function saveMetadata() {
  await writeFile(metadataPath, JSON.stringify(podcastMetadata, null, 2));
}

// RSS Feed Configuration
const RSS_CONFIG = {
  title: process.env.PODCAST_TITLE || 'Ecoworks Podcast',
  description: process.env.PODCAST_DESCRIPTION || 'AI-generated podcasts from text using OpenAI TTS',
  author: process.env.PODCAST_AUTHOR || 'Ecoworks Web Architecture',
  email: process.env.PODCAST_EMAIL || 'sean@ecoworks.ca',
  imageUrl: process.env.PODCAST_IMAGE || 'https://podcast.dev.ecoworks.ca/podcast-cover.jpg',
  language: 'en-us',
  category: 'Technology',
  explicit: 'no',
};

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Generate podcast from text
app.post('/api/generate', async (req, res) => {
  try {
    const { text, voice = 'alloy', title = 'podcast' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const model = 'tts-1';
    const costPerChar = TTS_PRICING[model] / 1_000_000;
    const cost = text.length * costPerChar;
    const startTime = Date.now();

    console.log(`Generating podcast: "${title}" with voice: ${voice} | Est. cost: $${cost.toFixed(4)}`);

    // Generate speech using OpenAI TTS
    const mp3 = await openai.audio.speech.create({
      model: model,
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      input: text,
    });

    const processingTimeMs = Date.now() - startTime;

    // Create filename with timestamp
    const timestamp = Date.now();
    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.mp3`;
    const filepath = path.join(__dirname, '../audio', filename);

    // Save the audio file
    const buffer = Buffer.from(await mp3.arrayBuffer());
    writeFileSync(filepath, buffer);
    const fileSizeBytes = buffer.length;

    // Format file size
    const formatBytes = (bytes) => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1048576).toFixed(2) + ' MB';
    };

    // Format processing time
    const formatTime = (ms) => {
      if (ms < 1000) return ms + 'ms';
      return (ms / 1000).toFixed(2) + 's';
    };

    const generatedAt = new Date().toISOString();

    // Add ID3 metadata to MP3
    const tags = {
      title: title,
      artist: `AI Voice: ${voice}`,
      album: 'Podcast Generator - Ecoworks Webb Architecture',
      year: new Date().getFullYear().toString(),
      comment: {
        language: 'eng',
        text: `Generated with OpenAI ${model} | Voice: ${voice} | Characters: ${text.length} | Cost: $${cost.toFixed(4)} | Processing: ${formatTime(processingTimeMs)} | Size: ${formatBytes(fileSizeBytes)}`,
      },
      userDefinedText: [
        { description: 'TTS_MODEL', value: model },
        { description: 'TTS_VOICE', value: voice },
        { description: 'CHARACTER_COUNT', value: text.length.toString() },
        { description: 'GENERATION_COST_USD', value: cost.toFixed(6) },
        { description: 'PROCESSING_TIME_MS', value: processingTimeMs.toString() },
        { description: 'FILE_SIZE_BYTES', value: fileSizeBytes.toString() },
        { description: 'GENERATED_AT', value: generatedAt },
        { description: 'GENERATOR', value: 'Podcast Generator API' },
        { description: 'DEVELOPER', value: 'Ecoworks Webb Architecture' },
      ],
    };
    NodeID3.write(tags, filepath);

    const audioUrl = `/audio/${filename}`;

    // Save metadata for this podcast
    podcastMetadata[filename] = {
      title: title,
      description: `Generated with ${voice} voice`,
      voice: voice,
      characters: text.length,
      cost: cost,
      createdAt: generatedAt,
    };
    await saveMetadata();

    // Update session stats
    sessionStats.totalGenerations++;
    sessionStats.totalCharacters += text.length;
    sessionStats.totalCost += cost;

    console.log(`Podcast generated: ${audioUrl} | Cost: $${cost.toFixed(4)} | Time: ${formatTime(processingTimeMs)} | Size: ${formatBytes(fileSizeBytes)}`);

    res.json({
      success: true,
      title,
      voice,
      audioUrl,
      filename,
      metadata: {
        textLength: text.length,
        model: model,
        voice: voice,
        cost: {
          amount: cost,
          formatted: `$${cost.toFixed(4)}`,
          ratePerMillion: TTS_PRICING[model],
        },
        processing: {
          timeMs: processingTimeMs,
          formatted: formatTime(processingTimeMs),
        },
        file: {
          sizeBytes: fileSizeBytes,
          formatted: formatBytes(fileSizeBytes),
        },
        generatedAt: generatedAt,
        developer: 'Ecoworks Webb Architecture',
      },
    });
  } catch (error) {
    console.error('Error generating podcast:', error);
    res.status(500).json({
      error: 'Failed to generate podcast',
      details: error.message
    });
  }
});

// Preview cost before generation
app.post('/api/preview', (req, res) => {
  const { text } = req.body;
  const charCount = text ? text.length : 0;
  const model = 'tts-1';
  const costPerChar = TTS_PRICING[model] / 1_000_000;
  const cost = charCount * costPerChar;

  res.json({
    charCount,
    model,
    cost: {
      amount: cost,
      formatted: `$${cost.toFixed(4)}`,
      ratePerMillion: TTS_PRICING[model],
    },
    estimatedDuration: `~${Math.ceil(charCount / 150)} seconds`, // rough estimate
  });
});

// Get session stats
app.get('/api/stats', (req, res) => {
  res.json({
    ...sessionStats,
    totalCostFormatted: `$${sessionStats.totalCost.toFixed(4)}`,
  });
});

// List available voices
app.get('/api/voices', (req, res) => {
  res.json({
    voices: [
      { id: 'alloy', name: 'Alloy', description: 'Neutral and balanced' },
      { id: 'echo', name: 'Echo', description: 'Warm and conversational' },
      { id: 'fable', name: 'Fable', description: 'Expressive and dramatic' },
      { id: 'onyx', name: 'Onyx', description: 'Deep and authoritative' },
      { id: 'nova', name: 'Nova', description: 'Friendly and upbeat' },
      { id: 'shimmer', name: 'Shimmer', description: 'Clear and professional' },
    ],
  });
});

// List generated podcasts
app.get('/api/podcasts', async (req, res) => {
  try {
    const audioDir = path.join(__dirname, '../audio');
    const files = await readdir(audioDir);

    const podcasts = await Promise.all(
      files
        .filter(f => f.endsWith('.mp3'))
        .map(async (filename) => {
          const fileStat = await stat(path.join(audioDir, filename));
          const meta = podcastMetadata[filename] || {};
          return {
            filename,
            title: meta.title || filename.replace(/_\d+\.mp3$/, '').replace(/_/g, ' '),
            description: meta.description || '',
            url: `/audio/${filename}`,
            size: fileStat.size,
            createdAt: fileStat.birthtime,
            voice: meta.voice,
          };
        })
    );

    res.json({ podcasts: podcasts.sort((a, b) => b.createdAt - a.createdAt) });
  } catch (error) {
    res.json({ podcasts: [] });
  }
});

// Get system info for platform detection
app.get('/api/system-info', async (req, res) => {
  const platform = os.platform();
  const isMac = platform === 'darwin';

  // Detect available players on Mac
  const availablePlayers = [];

  if (isMac) {
    // Always available - default app handler
    availablePlayers.push({
      id: 'default',
      name: 'Default App',
      description: 'Opens with your default audio player',
      available: true,
    });

    // Check for VLC
    try {
      await execAsync('mdfind "kMDItemKind == \'Application\'" | grep -i VLC.app');
      availablePlayers.push({
        id: 'vlc',
        name: 'VLC',
        description: 'Add to VLC playlist queue',
        available: true,
      });
    } catch {
      availablePlayers.push({
        id: 'vlc',
        name: 'VLC',
        description: 'Not installed',
        available: false,
      });
    }

    // Apple Music is always available on Mac
    availablePlayers.push({
      id: 'apple-music',
      name: 'Apple Music',
      description: 'Add to Up Next queue',
      available: true,
    });
  }

  res.json({
    platform,
    isMac,
    availablePlayers,
    supportsAutoOpen: isMac,
  });
});

// Open podcast in a player (Mac only)
app.post('/api/open-in-player', async (req, res) => {
  const { filename, player = 'default' } = req.body;

  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }

  const platform = os.platform();
  if (platform !== 'darwin') {
    return res.status(400).json({ error: 'Auto-open is only supported on macOS' });
  }

  const filepath = path.join(__dirname, '../audio', filename);

  if (!existsSync(filepath)) {
    return res.status(404).json({ error: 'Podcast file not found' });
  }

  try {
    let command;
    let result = { success: true, player, filename };

    switch (player) {
      case 'vlc':
        // Open in VLC and add to playlist queue
        // First check if VLC is running, if so enqueue, otherwise open
        try {
          await execAsync('pgrep -x VLC');
          // VLC is running, enqueue the file
          command = `open -a VLC --args --playlist-enqueue "${filepath}"`;
        } catch {
          // VLC not running, just open normally
          command = `open -a VLC "${filepath}"`;
        }
        break;

      case 'apple-music':
        // Use AppleScript to add to Apple Music "Up Next" queue
        const appleScript = `
          tell application "Music"
            activate
            set theFile to POSIX file "${filepath}"
            play theFile
          end tell
        `;
        command = `osascript -e '${appleScript.replace(/'/g, "'\\''")}'`;
        break;

      case 'default':
      default:
        // Open with default application
        command = `open "${filepath}"`;
        break;
    }

    await execAsync(command);
    console.log(`Opened podcast in ${player}: ${filename}`);

    res.json(result);
  } catch (error) {
    console.error(`Error opening podcast in ${player}:`, error);
    res.status(500).json({
      error: `Failed to open podcast in ${player}`,
      details: error.message,
    });
  }
});

// Rename a podcast
app.put('/api/podcasts/:filename/rename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { newTitle } = req.body;

    if (!newTitle) {
      return res.status(400).json({ error: 'newTitle is required' });
    }

    const audioDir = path.join(__dirname, '../audio');
    const oldPath = path.join(audioDir, filename);

    if (!existsSync(oldPath)) {
      return res.status(404).json({ error: 'Podcast not found' });
    }

    // Update metadata with new title
    if (!podcastMetadata[filename]) {
      podcastMetadata[filename] = {};
    }
    podcastMetadata[filename].title = newTitle;
    await saveMetadata();

    // Update ID3 tags
    const tags = NodeID3.read(oldPath);
    tags.title = newTitle;
    NodeID3.write(tags, oldPath);

    console.log(`Podcast renamed: ${filename} -> "${newTitle}"`);

    res.json({
      success: true,
      filename,
      newTitle,
      message: 'Podcast renamed successfully'
    });
  } catch (error) {
    console.error('Error renaming podcast:', error);
    res.status(500).json({ error: 'Failed to rename podcast', details: error.message });
  }
});

// Update podcast metadata (title, description)
app.patch('/api/podcasts/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const { title, description } = req.body;

    const audioDir = path.join(__dirname, '../audio');
    const filepath = path.join(audioDir, filename);

    if (!existsSync(filepath)) {
      return res.status(404).json({ error: 'Podcast not found' });
    }

    if (!podcastMetadata[filename]) {
      podcastMetadata[filename] = {};
    }

    if (title) {
      podcastMetadata[filename].title = title;
      // Update ID3 tags
      const tags = NodeID3.read(filepath) || {};
      tags.title = title;
      NodeID3.write(tags, filepath);
    }

    if (description) {
      podcastMetadata[filename].description = description;
    }

    await saveMetadata();

    res.json({
      success: true,
      filename,
      metadata: podcastMetadata[filename]
    });
  } catch (error) {
    console.error('Error updating podcast:', error);
    res.status(500).json({ error: 'Failed to update podcast', details: error.message });
  }
});

// Delete a podcast
app.delete('/api/podcasts/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const audioDir = path.join(__dirname, '../audio');
    const filepath = path.join(audioDir, filename);

    if (!existsSync(filepath)) {
      return res.status(404).json({ error: 'Podcast not found' });
    }

    unlinkSync(filepath);

    // Remove from metadata
    delete podcastMetadata[filename];
    await saveMetadata();

    console.log(`Podcast deleted: ${filename}`);

    res.json({ success: true, message: 'Podcast deleted successfully' });
  } catch (error) {
    console.error('Error deleting podcast:', error);
    res.status(500).json({ error: 'Failed to delete podcast', details: error.message });
  }
});

// RSS Feed for Apple Podcasts
app.get('/feed.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://podcast.dev.ecoworks.ca`;
    const audioDir = path.join(__dirname, '../audio');
    const files = await readdir(audioDir);

    const episodes = await Promise.all(
      files
        .filter(f => f.endsWith('.mp3'))
        .map(async (filename) => {
          const fileStat = await stat(path.join(audioDir, filename));
          const meta = podcastMetadata[filename] || {};
          const title = meta.title || filename.replace(/_\d+\.mp3$/, '').replace(/_/g, ' ');
          const description = meta.description || `Episode generated with ${meta.voice || 'AI'} voice`;
          const pubDate = new Date(fileStat.birthtime).toUTCString();
          const duration = Math.ceil(fileStat.size / 16000); // Rough estimate: ~128kbps

          return {
            title,
            description,
            filename,
            url: `${baseUrl}/audio/${filename}`,
            size: fileStat.size,
            pubDate,
            duration,
            guid: filename,
          };
        })
    );

    // Sort by date descending
    episodes.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Generate RSS XML (Apple Podcasts compliant)
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(RSS_CONFIG.title)}</title>
    <description>${escapeXml(RSS_CONFIG.description)}</description>
    <link>${baseUrl}</link>
    <language>${RSS_CONFIG.language}</language>
    <copyright>Copyright ${new Date().getFullYear()} ${escapeXml(RSS_CONFIG.author)}</copyright>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>

    <itunes:author>${escapeXml(RSS_CONFIG.author)}</itunes:author>
    <itunes:summary>${escapeXml(RSS_CONFIG.description)}</itunes:summary>
    <itunes:owner>
      <itunes:name>${escapeXml(RSS_CONFIG.author)}</itunes:name>
      <itunes:email>${RSS_CONFIG.email}</itunes:email>
    </itunes:owner>
    <itunes:explicit>${RSS_CONFIG.explicit}</itunes:explicit>
    <itunes:category text="${RSS_CONFIG.category}"/>
    <itunes:image href="${RSS_CONFIG.imageUrl}"/>
    <image>
      <url>${RSS_CONFIG.imageUrl}</url>
      <title>${escapeXml(RSS_CONFIG.title)}</title>
      <link>${baseUrl}</link>
    </image>

${episodes.map(ep => `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${escapeXml(ep.description)}</description>
      <enclosure url="${ep.url}" length="${ep.size}" type="audio/mpeg"/>
      <guid isPermaLink="false">${ep.guid}</guid>
      <pubDate>${ep.pubDate}</pubDate>
      <itunes:duration>${ep.duration}</itunes:duration>
      <itunes:explicit>no</itunes:explicit>
    </item>`).join('\n')}
  </channel>
</rss>`;

    res.set('Content-Type', 'application/rss+xml');
    res.send(rssXml);
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    res.status(500).json({ error: 'Failed to generate RSS feed' });
  }
});

// Helper function to escape XML special characters
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️  Podcast Generator API running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://10.10.10.24:${PORT}`);
  console.log(`\n🌐 Web UI: http://10.10.10.24:${PORT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST   /api/generate              - Generate podcast from text`);
  console.log(`   GET    /api/voices                - List available voices`);
  console.log(`   GET    /api/podcasts              - List generated podcasts`);
  console.log(`   PUT    /api/podcasts/:file/rename - Rename a podcast`);
  console.log(`   PATCH  /api/podcasts/:file        - Update podcast metadata`);
  console.log(`   DELETE /api/podcasts/:file        - Delete a podcast`);
  console.log(`   GET    /api/system-info           - Get platform info`);
  console.log(`   POST   /api/open-in-player        - Open in player (macOS)`);
  console.log(`   GET    /feed.xml                  - RSS feed (Apple Podcasts)`);
  console.log(`   GET    /health                    - Health check\n`);
});
