# Halo

A free, privacy-focused AI assistant desktop application with real-time audio capture and contextual AI capabilities.

## What is Halo?

Halo is a desktop AI assistant that listens, understands, and helps. It captures audio from your system or microphone, transcribes conversations in real-time, and provides intelligent summaries and responses. Whether you're in a meeting, watching a lecture, or having a conversation, Halo can transcribe the audio, summarize key points, and answer questions about what was said.

The application works entirely on your device with optional cloud sync. You can use commercial AI providers like OpenAI and Anthropic, or run everything locally with Ollama for complete privacy. All conversation history and transcripts are stored locally in SQLite, giving you full control over your data.

## Features

- Real-time audio transcription and summarization
- Multi-provider AI support (OpenAI, Anthropic, Google, Deepgram)
- Local AI model support via Ollama
- Session-based conversation management
- Custom presets and personalization
- Cross-platform support (macOS, Windows, Linux)

## Tech Stack

- Electron for desktop application framework
- Next.js for web interface
- SQLite for local data storage
- Firebase for optional cloud sync and authentication
- Express for internal API routing

## Installation

```bash
npm run setup
```

This will install dependencies, build the web frontend, and start the application.

## Development

```bash
npm start          # Start the application
npm run build      # Build for production
npm run build:win  # Build for Windows
```

## Requirements

- Node.js 16 or higher
- npm or equivalent package manager

## Configuration

API keys for AI providers can be configured through the settings interface. Local models via Ollama require Ollama to be installed separately.

## License

GPL-3.0

## Privacy

Halo prioritizes user privacy with local-first data storage. Cloud features are optional and require explicit authentication.

