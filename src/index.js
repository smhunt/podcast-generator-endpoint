import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createWriteStream, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import NodeID3 from 'node-id3';

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

    console.log(`Generating podcast: "${title}" with voice: ${voice}`);

    // Generate speech using OpenAI TTS
    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: voice, // alloy, echo, fable, onyx, nova, shimmer
      input: text,
    });

    // Create filename with timestamp
    const timestamp = Date.now();
    const filename = `${title.replace(/[^a-z0-9]/gi, '_')}_${timestamp}.mp3`;
    const filepath = path.join(__dirname, '../audio', filename);

    // Save the audio file
    const buffer = Buffer.from(await mp3.arrayBuffer());
    writeFileSync(filepath, buffer);

    // Calculate cost for metadata
    const model = 'tts-1';
    const costPerChar = TTS_PRICING[model] / 1_000_000;
    const cost = text.length * costPerChar;

    // Add ID3 metadata to MP3
    const tags = {
      title: title,
      artist: `AI Voice: ${voice}`,
      album: 'Podcast Generator',
      year: new Date().getFullYear().toString(),
      comment: {
        language: 'eng',
        text: `Generated with OpenAI ${model} | Voice: ${voice} | Characters: ${text.length} | Cost: $${cost.toFixed(4)}`,
      },
      userDefinedText: [
        { description: 'TTS_MODEL', value: model },
        { description: 'TTS_VOICE', value: voice },
        { description: 'CHARACTER_COUNT', value: text.length.toString() },
        { description: 'GENERATION_COST', value: `$${cost.toFixed(4)}` },
        { description: 'GENERATED_AT', value: new Date().toISOString() },
        { description: 'GENERATOR', value: 'Podcast Generator API' },
      ],
    };
    NodeID3.write(tags, filepath);

    const audioUrl = `/audio/${filename}`;

    // Update session stats
    sessionStats.totalGenerations++;
    sessionStats.totalCharacters += text.length;
    sessionStats.totalCost += cost;

    console.log(`Podcast generated: ${audioUrl} | Cost: $${cost.toFixed(4)}`);

    res.json({
      success: true,
      title,
      voice,
      audioUrl,
      filename,
      textLength: text.length,
      cost: {
        amount: cost,
        formatted: `$${cost.toFixed(4)}`,
        model,
        ratePerMillion: TTS_PRICING[model],
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error generating podcast:', error);
    res.status(500).json({
      error: 'Failed to generate podcast',
      details: error.message
    });
  }
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
    const { readdir, stat } = await import('fs/promises');
    const audioDir = path.join(__dirname, '../audio');
    const files = await readdir(audioDir);

    const podcasts = await Promise.all(
      files
        .filter(f => f.endsWith('.mp3'))
        .map(async (filename) => {
          const fileStat = await stat(path.join(audioDir, filename));
          return {
            filename,
            url: `/audio/${filename}`,
            size: fileStat.size,
            createdAt: fileStat.birthtime,
          };
        })
    );

    res.json({ podcasts: podcasts.sort((a, b) => b.createdAt - a.createdAt) });
  } catch (error) {
    res.json({ podcasts: [] });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎙️  Podcast Generator API running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://10.10.10.24:${PORT}`);
  console.log(`\n🌐 Web UI: http://10.10.10.24:${PORT}`);
  console.log(`\n📡 Endpoints:`);
  console.log(`   POST /api/generate - Generate podcast from text`);
  console.log(`   GET  /api/voices   - List available voices`);
  console.log(`   GET  /api/podcasts - List generated podcasts`);
  console.log(`   GET  /health       - Health check\n`);
});
