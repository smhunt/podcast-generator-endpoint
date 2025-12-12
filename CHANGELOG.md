# Changelog

All notable changes to the Podcast Generator API will be documented in this file.

## [1.2.0] - 2025-12-12

### Added
- Cost tracking per generation ($15/1M characters for TTS-1)
- Session statistics (total generations, characters, cost)
- ID3 metadata embedded in MP3 files:
  - Title, artist (voice), album
  - TTS model, voice, character count
  - Generation cost and timestamp
- `/api/stats` endpoint for session statistics
- Cost badge displayed on successful generation

### Changed
- UI now shows real-time session statistics in header

## [1.1.0] - 2025-12-12

### Added
- Postman collection for API testing (`postman/Podcast-Generator-API.postman_collection.json`)
- Interactive web UI for podcast generation
- Voice selector with all 6 OpenAI TTS voices
- Real-time podcast list with audio playback
- API status indicator (online/offline)
- Focus-only cursor visibility in input fields

## [1.0.0] - 2025-12-12

### Added
- Initial release
- Express server on port 3087
- `POST /api/generate` - Generate podcast audio from text
- `GET /api/voices` - List available TTS voices (alloy, echo, fable, onyx, nova, shimmer)
- `GET /api/podcasts` - List generated audio files
- `GET /health` - Health check endpoint
- OpenAI TTS-1 integration
- Audio file storage in `/audio` directory
- CORS support
- Environment variable configuration

---

**Podcast Generator API** - Built by Ecoworks Webb Architecture
