---
description: Repository Information Overview
alwaysApply: true
---

# Voice Email Information

## Summary

Voice Email is a Node.js application that allows users to listen to emails by phone. It integrates with Gmail, Twilio, and various text-to-speech services to convert emails to audio that can be accessed via phone calls. The system supports multiple users accessing a shared mailbox, with caller identification managed through a Google Sheet.

## Structure

- **Root Directory**: Contains main application files (app.js, main.js, gmailHelper.js)
- **Configuration Files**: .env for environment variables, credentials.json for Google API authentication
- **Dependencies**: Managed via package.json with npm

## Language & Runtime

**Language**: JavaScript (Node.js)
**Version**: Node.js (version not specified in files)
**Package Manager**: npm

## Dependencies

**Main Dependencies**:

- **API Clients**:
  - @aws-sdk/client-polly (^3.896.0) - Amazon Polly for TTS
  - @google/generative-ai (^0.24.1) - Google Gemini AI
  - openai (^4.17.4) - OpenAI API
  - microsoft-cognitiveservices-speech-sdk (^1.35.0) - Microsoft Speech services
  - twilio (^4.8.0) - Twilio for phone integration
- **Google Services**:
  - googleapis - For Gmail and Google Sheets integration
  - @google-cloud/local-auth - For authentication
- **Utilities**:
  - express (^4.18.2) - Web server
  - dayjs (^1.11.7) - Date handling
  - html-to-text (^9.0.5) - HTML parsing
  - fluent-ffmpeg (^2.1.3) - Audio processing
  - node-cron (^4.2.1) - Scheduled tasks
  - dotenv (^16.0.3) - Environment variable management

## Build & Installation

```bash
npm install
```

## Main Components

**Entry Point**: app.js - Express server that handles incoming Twilio calls
**Core Functionality**:

- **main.js**: Contains the main logic for handling calls and text-to-speech conversion
- **gmailHelper.js**: Handles Gmail API interactions, message retrieval and processing

## Voice Processing

**Voice Models**:

- Google Gemini AI (default)
- Microsoft Speech Services
- Amazon Polly

**Audio Processing**:

- Uses FFmpeg for audio format conversion
- Supports MP3 and WAV formats

## External Services

**Required Services**:

- Gmail API - For email access
- Google Sheets API - For user management
- Twilio - For phone call handling
- Text-to-Speech APIs (Google Gemini, Microsoft, or Amazon Polly)

## Testing

**Test Files**:

- testTTS.js - Tests text-to-speech functionality
- testFFmpeg.js - Tests FFmpeg audio processing

## Runtime Requirements

- Google account with Gmail
- Google Sheet for user management
- Twilio account with phone number
- API keys for chosen TTS service
- Environment variables in .env file for API credentials

## Operation

The application runs as an Express server on port 8008, receiving webhook calls from Twilio when a user calls the configured phone number. It authenticates the caller against a Google Sheet, retrieves unread emails from Gmail, converts them to speech using the configured TTS service, and plays them over the phone call.
