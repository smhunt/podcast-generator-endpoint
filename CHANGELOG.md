# Changelog

All notable changes to the Podcast Generator API will be documented in this file.

## [1.6.0] - 2025-12-15

### Added
- Auto-open in podcast player feature (macOS only)
- Support for multiple podcast players:
  - Default App (system default audio player)
  - VLC (with playlist queue support)
  - Apple Music (plays via AppleScript)
- `GET /api/system-info` endpoint for platform detection and available players
- `POST /api/open-in-player` endpoint to open podcasts in external players
- Settings panel with toggle and player selection UI
- "Open" button on each podcast for manual player launch
- Player preferences saved to localStorage

### Changed
- Generation success now shows auto-open status message
- Podcast list shows "Open" button on macOS systems
## [1.6.0] - 2025-12-16

### Added
- Clerk authentication integration (same config as TranscribeGlobal)
- Sign-in screen for unauthenticated users
- User button in header for signed-in users
- Dark mode toggle with persistent theme preference
- Auth loading state with spinner

### Changed
- Complete UI redesign to match TranscribeGlobal styling
- Light mode default with CSS custom properties
- Clean card-based layout with subtle borders
- Sticky header with navigation
- Updated typography and spacing
- Fixed branding: "Ecoworks Web Architecture" (was "Webb")

## [1.5.0] - 2025-12-12

### Added
- Download button for each podcast in the list
- Individual audio players for each past podcast
- Lazy loading for audio files (only loads when played)
- Single-audio playback (playing one pauses all others)

### Changed
- Podcast list now shows header with play info and download button
- Audio uses `preload="none"` for better performance

## [1.4.0] - 2025-12-12

### Added
- Live cost preview while typing (characters, cost, est. duration)
- Confirmation dialog before generation with full cost breakdown
- Processing time tracking (shows how long API took)
- File size in API response and metadata
- Enhanced ID3 metadata: processing time, file size, developer attribution
- `/api/preview` endpoint for cost estimation
- Metadata grid in success results showing all generation details

### Changed
- API response now returns structured `metadata` object
- Improved console logging with all metrics

## [1.3.0] - 2025-12-12

### Added
- Mobile-responsive design optimized for phones and tablets
- Updated sample text with full technology explanation
- Ecoworks Web Architecture branding throughout

### Changed
- Voice grid displays 2 columns on mobile
- Buttons stack full-width on mobile
- Stats bar stacks vertically on small screens
- Larger tap targets for touch devices
- Improved text readability on mobile

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

**Podcast Generator API** - Built by Ecoworks Web Architecture
