# Gemini Live PC - Voice Chat Desktop Client

This is a native PC voice conversation desktop client built with **Electron** and **Web Audio API** that connects directly to the **Gemini Multimodal Live API**. 

It allows bidirectional, low-latency, real-time voice conversations like **Gemini Live** directly on your computer.

## Features
- 🎙️ **Real-time 16kHz audio capture & downsampling** using the browser Web Audio API.
- 🔊 **Timeline-scheduled 24kHz audio streaming playback** for pop-free, fluid voice responses.
- ⚡ **Automated Voice Activity Detection (VAD) Barge-In**: Gemini will automatically pause and listen whenever you start speaking over its response.
- 🎨 **Premium Glassmorphism UI** with glowing canvas-rendered voice visualization waves.
- 👥 **8 Prebuilt Voices Tone Configurator**: Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr.
- 🧠 **Dynamic Custom System Instructions** to change the assistant's personality on the fly.
- 💬 **Live Text Transcripts bubble view** showing what you said and Gemini's responses.
- 🔑 **Secure Local Key Storage**: Your API key stays on your PC and is saved in local browser storage or can be loaded from your system's `GEMINI_API_KEY` environment variable.

---

## Installation & Running Locally

### Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher recommended)
- npm (installed with Node.js)

### Step 1: Install Dependencies
Open a command prompt or terminal in the `gemini-live-pc` directory and install the developer packages:
```bash
npm install
```

### Step 2: Set your Environment API Key (Optional)
If you prefer not to enter your API key in the UI, you can set it as a environment variable:
- **Windows (PowerShell):**
  ```powershell
  $env:GEMINI_API_KEY="your-api-key-here"
  ```
- **Windows (Command Prompt):**
  ```cmd
  set GEMINI_API_KEY="your-api-key-here"
  ```
- **macOS / Linux:**
  ```bash
  export GEMINI_API_KEY="your-api-key-here"
  ```

### Step 3: Run the Application
Start the Electron application:
```bash
npm run start
```

---

## Packaging into an Installable Application

To package this application into a native standalone installer (e.g., a `.exe` installer for Windows, or `.dmg`/`.app` for macOS):

```bash
# Package the application
npm run build
```

This will run `electron-builder` and generate the installation files inside the `./dist/` directory.

---

## Technical Specifications
- **Input Stream:** 16-bit Signed Integer Linear PCM, Mono, 16000Hz.
- **Output Stream:** 16-bit Signed Integer Linear PCM, Mono, 24000Hz.
- **Protocol:** WebSocket connection using `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`.
