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
import * as mm from 'music-metadata';
import crypto from 'crypto';

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

// RSS Feed Configuration (Apple Podcasts compliant)
const RSS_CONFIG = {
  title: process.env.PODCAST_TITLE || 'Ecoworks Podcast',
  description: process.env.PODCAST_DESCRIPTION || 'AI-generated podcasts from text using OpenAI TTS',
  subtitle: process.env.PODCAST_SUBTITLE || 'AI-Generated Audio Content',
  author: process.env.PODCAST_AUTHOR || 'Ecoworks Web Architecture',
  email: process.env.PODCAST_EMAIL || 'sean@ecoworks.ca',
  imageUrl: process.env.PODCAST_IMAGE || 'https://podcast.dev.ecoworks.ca/podcast-cover.jpg',
  language: 'en-us',
  category: 'Technology',
  subcategory: 'Tech News',
  explicit: 'no',
  type: 'episodic', // episodic or serial
  keywords: ['ai', 'tts', 'podcast', 'openai', 'technology', 'ecoworks'],
  // Unique podcast GUID (generated once, never changes)
  guid: process.env.PODCAST_GUID || 'ecoworks-podcast-2025-uuid',
};

// Helper: Generate title from text content
function generateTitleFromText(text, maxLength = 60) {
  if (!text) return 'Untitled Episode';

  // Get first sentence or first N words
  const firstSentence = text.split(/[.!?]/)[0].trim();
  let title = firstSentence;

  // If first sentence is too long, take first few words
  if (title.length > maxLength) {
    const words = text.split(/\s+/).slice(0, 8);
    title = words.join(' ');
    if (title.length > maxLength) {
      title = title.substring(0, maxLength - 3) + '...';
    }
  }

  // Capitalize first letter
  return title.charAt(0).toUpperCase() + title.slice(1);
}

// Helper: Get next episode number
function getNextEpisodeNumber() {
  const episodes = Object.values(podcastMetadata);
  if (episodes.length === 0) return 1;
  const maxEp = Math.max(...episodes.map(e => e.episodeNumber || 0));
  return maxEp + 1;
}

// Helper: Get actual MP3 duration using music-metadata
async function getAudioDuration(filepath) {
  try {
    const metadata = await mm.parseFile(filepath);
    return Math.floor(metadata.format.duration || 0);
  } catch (e) {
    console.error('Error reading audio duration:', e);
    // Fallback estimate
    const stats = await stat(filepath);
    return Math.ceil(stats.size / 16000);
  }
}

// Helper: Format duration for iTunes (HH:MM:SS or MM:SS)
function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper: Split text into chunks under 4096 characters
function chunkText(text, maxChars = 4000) {
  const chunks = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const para of paragraphs) {
    // If single paragraph exceeds limit, split by sentences
    if (para.length > maxChars) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }

      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if ((currentChunk + sentence).length > maxChars) {
          if (currentChunk) chunks.push(currentChunk.trim());
          currentChunk = sentence + ' ';
        } else {
          currentChunk += sentence + ' ';
        }
      }
    } else if ((currentChunk + para).length > maxChars) {
      chunks.push(currentChunk.trim());
      currentChunk = para + '\n\n';
    } else {
      currentChunk += para + '\n\n';
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Generate podcast from text
app.post('/api/generate', async (req, res) => {
  try {
    const { text, voice = 'alloy', title: providedTitle, subtitle, keywords, episodeType = 'full' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Auto-generate title if not provided
    const title = providedTitle?.trim() || generateTitleFromText(text);

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    const model = 'tts-1';
    const costPerChar = TTS_PRICING[model] / 1_000_000;
    const cost = text.length * costPerChar;
    const startTime = Date.now();

    console.log(`Generating podcast: "${title}" with voice: ${voice} | Est. cost: $${cost.toFixed(4)}`);

    // Split text into chunks if needed
    const chunks = text.length > 4000 ? chunkText(text) : [text];
    console.log(`Text split into ${chunks.length} chunk(s)`);

    // Generate speech for each chunk
    const audioBuffers = [];
    for (let i = 0; i < chunks.length; i++) {
      console.log(`Generating chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars)...`);
      const mp3 = await openai.audio.speech.create({
        model: model,
        voice: voice,
        input: chunks[i],
      });
      audioBuffers.push(Buffer.from(await mp3.arrayBuffer()));
    }

    // Concatenate all audio buffers
    const buffer = Buffer.concat(audioBuffers);

    const processingTimeMs = Date.now() - startTime;

    // Create filename with timestamp
    const timestamp = Date.now();
    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.mp3`;
    const filepath = path.join(__dirname, '../audio', filename);

    // Save the audio file
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

    // Get actual audio duration
    const duration = await getAudioDuration(filepath);
    const episodeNumber = getNextEpisodeNumber();

    // Save metadata for this podcast (Apple Podcasts compliant)
    podcastMetadata[filename] = {
      title: title,
      description: text.substring(0, 500) + (text.length > 500 ? '...' : ''),
      subtitle: subtitle || generateTitleFromText(text, 100),
      voice: voice,
      characters: text.length,
      cost: cost,
      duration: duration,
      fileSize: fileSizeBytes,
      createdAt: generatedAt,
      episodeNumber: episodeNumber,
      seasonNumber: 1,
      episodeType: episodeType,
      explicit: false,
      keywords: keywords || ['ai', 'podcast', 'technology'],
      author: RSS_CONFIG.author,
      guid: `${filename}-${crypto.randomUUID()}`,
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

// RSS Feed for Apple Podcasts (fully compliant)
app.get('/feed.xml', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://podcast.dev.ecoworks.ca`;
    const audioDir = path.join(__dirname, '../audio');
    const files = await readdir(audioDir);

    const episodes = await Promise.all(
      files
        .filter(f => f.endsWith('.mp3'))
        .map(async (filename) => {
          const filepath = path.join(audioDir, filename);
          const fileStat = await stat(filepath);
          const meta = podcastMetadata[filename] || {};

          // Get actual duration or use stored value
          const duration = meta.duration || await getAudioDuration(filepath);

          return {
            title: meta.title || filename.replace(/_\d+\.mp3$/, '').replace(/_/g, ' '),
            description: meta.description || `Episode generated with ${meta.voice || 'AI'} voice`,
            subtitle: meta.subtitle || '',
            filename,
            url: `${baseUrl}/audio/${encodeURIComponent(filename)}`,
            size: fileStat.size,
            pubDate: new Date(meta.createdAt || fileStat.birthtime).toUTCString(),
            duration: duration,
            durationFormatted: formatDuration(duration),
            guid: meta.guid || filename,
            episodeNumber: meta.episodeNumber || 1,
            seasonNumber: meta.seasonNumber || 1,
            episodeType: meta.episodeType || 'full',
            explicit: meta.explicit ? 'yes' : 'no',
            keywords: meta.keywords || [],
            author: meta.author || RSS_CONFIG.author,
          };
        })
    );

    // Sort by episode number (newest first for episodic)
    episodes.sort((a, b) => b.episodeNumber - a.episodeNumber);

    // Generate RSS XML (Apple Podcasts fully compliant)
    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:atom="http://www.w3.org/2005/Atom"
     xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${escapeXml(RSS_CONFIG.title)}</title>
    <description>${escapeXml(RSS_CONFIG.description)}</description>
    <link>${baseUrl}</link>
    <language>${RSS_CONFIG.language}</language>
    <copyright>Copyright ${new Date().getFullYear()} ${escapeXml(RSS_CONFIG.author)}</copyright>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>Ecoworks Podcast Generator v1.0</generator>
    <atom:link href="${baseUrl}/feed.xml" rel="self" type="application/rss+xml"/>

    <itunes:type>${RSS_CONFIG.type}</itunes:type>
    <itunes:subtitle>${escapeXml(RSS_CONFIG.subtitle)}</itunes:subtitle>
    <itunes:author>${escapeXml(RSS_CONFIG.author)}</itunes:author>
    <itunes:summary>${escapeXml(RSS_CONFIG.description)}</itunes:summary>
    <itunes:owner>
      <itunes:name>${escapeXml(RSS_CONFIG.author)}</itunes:name>
      <itunes:email>${RSS_CONFIG.email}</itunes:email>
    </itunes:owner>
    <itunes:explicit>${RSS_CONFIG.explicit}</itunes:explicit>
    <itunes:category text="${RSS_CONFIG.category}">
      <itunes:category text="${RSS_CONFIG.subcategory}"/>
    </itunes:category>
    <itunes:keywords>${RSS_CONFIG.keywords.join(',')}</itunes:keywords>
    <itunes:image href="${RSS_CONFIG.imageUrl}"/>
    <image>
      <url>${RSS_CONFIG.imageUrl}</url>
      <title>${escapeXml(RSS_CONFIG.title)}</title>
      <link>${baseUrl}</link>
    </image>
    <podcast:guid>${RSS_CONFIG.guid}</podcast:guid>
    <podcast:locked>no</podcast:locked>

${episodes.map(ep => `    <item>
      <title>${escapeXml(ep.title)}</title>
      <description>${escapeXml(ep.description)}</description>
      <link>${baseUrl}/#episode-${ep.episodeNumber}</link>
      <enclosure url="${ep.url}" length="${ep.size}" type="audio/mpeg"/>
      <guid isPermaLink="false">${ep.guid}</guid>
      <pubDate>${ep.pubDate}</pubDate>
      <itunes:title>${escapeXml(ep.title)}</itunes:title>
      <itunes:subtitle>${escapeXml(ep.subtitle)}</itunes:subtitle>
      <itunes:summary>${escapeXml(ep.description)}</itunes:summary>
      <itunes:duration>${ep.durationFormatted}</itunes:duration>
      <itunes:explicit>${ep.explicit}</itunes:explicit>
      <itunes:episode>${ep.episodeNumber}</itunes:episode>
      <itunes:season>${ep.seasonNumber}</itunes:season>
      <itunes:episodeType>${ep.episodeType}</itunes:episodeType>
      <itunes:author>${escapeXml(ep.author)}</itunes:author>
      <itunes:image href="${RSS_CONFIG.imageUrl}"/>
      <itunes:keywords>${ep.keywords.join(',')}</itunes:keywords>
      <content:encoded><![CDATA[<p>${escapeXml(ep.description)}</p>]]></content:encoded>
    </item>`).join('\n')}
  </channel>
</rss>`;

    res.set('Content-Type', 'application/rss+xml');
    res.set('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes
    res.send(rssXml);
  } catch (error) {
    console.error('Error generating RSS feed:', error);
    res.status(500).json({ error: 'Failed to generate RSS feed' });
  }
});

// Feed validation endpoint
app.get('/api/validate-feed', async (req, res) => {
  try {
    const baseUrl = process.env.BASE_URL || `https://podcast.dev.ecoworks.ca`;
    const issues = [];
    const warnings = [];

    // Check artwork
    const artworkPath = path.join(__dirname, '../public/podcast-cover.jpg');
    if (!existsSync(artworkPath)) {
      issues.push('Missing podcast artwork (podcast-cover.jpg)');
    }

    // Check episodes
    const audioDir = path.join(__dirname, '../audio');
    const files = await readdir(audioDir);
    const mp3Files = files.filter(f => f.endsWith('.mp3'));

    if (mp3Files.length === 0) {
      warnings.push('No episodes found - feed will be empty');
    }

    // Check each episode
    for (const filename of mp3Files) {
      const meta = podcastMetadata[filename];
      if (!meta) {
        warnings.push(`Missing metadata for: ${filename}`);
      } else {
        if (!meta.title) warnings.push(`Missing title for: ${filename}`);
        if (!meta.description) warnings.push(`Missing description for: ${filename}`);
        if (!meta.duration) warnings.push(`Missing duration for: ${filename}`);
      }
    }

    // Check required config
    if (!RSS_CONFIG.title) issues.push('Missing podcast title');
    if (!RSS_CONFIG.author) issues.push('Missing podcast author');
    if (!RSS_CONFIG.email) issues.push('Missing podcast email');

    const isValid = issues.length === 0;

    res.json({
      valid: isValid,
      issues,
      warnings,
      feedUrl: `${baseUrl}/feed.xml`,
      subscribeUrl: `podcast://${baseUrl.replace('https://', '')}/feed.xml`,
      episodeCount: mp3Files.length,
      artworkUrl: `${baseUrl}/podcast-cover.jpg`,
    });
  } catch (error) {
    res.status(500).json({ error: 'Validation failed', details: error.message });
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
