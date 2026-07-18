// Elements
const apiKeyInput = document.getElementById('api-key-input');
const btnLoadEnv = document.getElementById('btn-load-env');
const voiceSelect = document.getElementById('voice-select');
const modelSelect = document.getElementById('model-select');
const systemInstructions = document.getElementById('system-instructions');
const btnToggleConnection = document.getElementById('btn-toggle-connection');
const btnToggleMute = document.getElementById('btn-toggle-mute');
const textConnection = document.getElementById('text-connection');
const textMute = document.getElementById('text-mute');
const iconMute = document.getElementById('icon-mute');
const statusText = document.getElementById('status-text');
const statusIndicator = document.getElementById('status-indicator');
const glowRing = document.getElementById('glow-ring');
const canvas = document.getElementById('canvas-visualizer');
const ctx = canvas.getContext('2d');
const transcriptContainer = document.getElementById('transcript-container');
const btnClearTranscript = document.getElementById('btn-clear-transcript');
const chatPlaceholder = document.getElementById('chat-placeholder');
const btnToggleConfig = document.getElementById('btn-toggle-config');
const configBody = document.getElementById('config-body');

// Wake Word Elements
const wakeWordEnabled = document.getElementById('wake-word-enabled');
const wakeWordInput = document.getElementById('wake-word-input');
const wakeWordGroup = document.getElementById('wake-word-group');
const sleepWordInput = document.getElementById('sleep-word-input');

// Session Manager Elements
const btnNewSession = document.getElementById('btn-new-session');
const sessionsList = document.getElementById('sessions-list');

// State Variables
let websocket = null;
let audioContext = null;      // Input mic context
let playbackContext = null;   // Output playback context
let micStream = null;
let micSource = null;
let micProcessor = null;
let micAnalyser = null;
let playbackAnalyser = null;

let isConnected = false;
let isMuted = false;
let appState = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, READY, SPEAKING, INTERRUPTED

// Wake Word State Variables
let isWaitingForWakeWord = false;
let isTransitioningToStandby = false; // Flag to wait for goodbye speech before standby

// Session Manager State Variables
let sessions = [];
let currentSessionId = null;

// Audio queue scheduling
let nextStartTime = 0;
const activeSourceNodes = [];

// Transcripts tracking
let currentGeminiBubble = null;
let currentUserBubble = null;

// Audio parameters
const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

// Load API Key from localStorage
const LOCAL_STORAGE_KEY = 'gemini_live_api_key';
const savedKey = localStorage.getItem(LOCAL_STORAGE_KEY);
if (savedKey) {
  apiKeyInput.value = savedKey;
}

// Load Wake Word Config from localStorage
const savedWakeWordEnabled = localStorage.getItem('gemini_wake_word_enabled') === 'true';
wakeWordEnabled.checked = savedWakeWordEnabled;
wakeWordGroup.style.display = savedWakeWordEnabled ? 'flex' : 'none';

const savedWakeWord = localStorage.getItem('gemini_wake_word');
if (savedWakeWord) {
  wakeWordInput.value = savedWakeWord;
}

const savedSleepWord = localStorage.getItem('gemini_sleep_word');
if (savedSleepWord) {
  sleepWordInput.value = savedSleepWord;
}

// Initialize Sessions & Load History on Startup
initSessions();

// Wake Word UI Listeners
wakeWordEnabled.addEventListener('change', () => {
  wakeWordGroup.style.display = wakeWordEnabled.checked ? 'flex' : 'none';
  localStorage.setItem('gemini_wake_word_enabled', wakeWordEnabled.checked);
});

wakeWordInput.addEventListener('change', () => {
  localStorage.setItem('gemini_wake_word', wakeWordInput.value.trim());
});

sleepWordInput.addEventListener('change', () => {
  localStorage.setItem('gemini_sleep_word', sleepWordInput.value.trim());
});

// Collapsible Config Panel
btnToggleConfig.addEventListener('click', () => {
  configBody.classList.toggle('collapsed');
  btnToggleConfig.textContent = configBody.classList.contains('collapsed') ? '➕' : '⚙️';
});

// Load API Key from Environment
btnLoadEnv.addEventListener('click', () => {
  const envKey = window.electronAPI.getApiKey();
  if (envKey) {
    apiKeyInput.value = envKey;
    localStorage.setItem(LOCAL_STORAGE_KEY, envKey);
    showNotification('API Key loaded from environment.', 'success');
  } else {
    showNotification('GEMINI_API_KEY environment variable not found.', 'error');
  }
});

// Save API Key when changed manually
apiKeyInput.addEventListener('change', () => {
  localStorage.setItem(LOCAL_STORAGE_KEY, apiKeyInput.value.trim());
});

// Clear transcript and stored history of active session
btnClearTranscript.addEventListener('click', () => {
  const activeSession = sessions.find(s => s.id === currentSessionId);
  if (activeSession) {
    activeSession.history = [];
    activeSession.title = '새 대화';
    localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
    renderSessionsList();
    loadConversationHistory();
    showNotification('현재 대화 이력이 초기화되었습니다.', 'success');
  }
});

// Connection toggle handler
btnToggleConnection.addEventListener('click', () => {
  if (isConnected || isWaitingForWakeWord) {
    disconnect();
  } else {
    if (wakeWordEnabled.checked) {
      isWaitingForWakeWord = true;
    }
    connect();
  }
});

// Mute toggle handler
btnToggleMute.addEventListener('click', () => {
  isMuted = !isMuted;
  if (isMuted) {
    btnToggleMute.classList.add('btn-danger');
    btnToggleMute.classList.remove('btn-secondary');
    textMute.textContent = 'Unmute Mic';
    iconMute.textContent = '🔇';
    updateStatus('MUTED');
  } else {
    btnToggleMute.classList.remove('btn-danger');
    btnToggleMute.classList.add('btn-secondary');
    textMute.textContent = 'Mute Mic';
    iconMute.textContent = '🎙️';
    if (activeSourceNodes.length > 0) {
      updateStatus('SPEAKING');
    } else {
      updateStatus('READY');
    }
  }
});

// --- AUDIO UTILITIES ---

// Convert Float32Array to 16-bit PCM (ArrayBuffer)
function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    // Convert to 16-bit signed integer
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); // Little endian
  }
  return buffer;
}

// Convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Decode Base64 string to ArrayBuffer
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Convert 16-bit PCM ArrayBuffer to Float32 array for playback
function pcm16ToFloat32(arrayBuffer) {
  const dataView = new DataView(arrayBuffer);
  const numSamples = arrayBuffer.byteLength / 2;
  const float32Array = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const intSample = dataView.getInt16(i * 2, true); // Little endian
    float32Array[i] = intSample / 32768.0;
  }
  return float32Array;
}

// --- CORE SYSTEM FUNCTIONS ---

// Update UI States & Glow Rings
function updateStatus(state) {
  appState = state;
  statusIndicator.className = 'status-dot';
  glowRing.className = 'glow-ring';
  
  switch (state) {
    case 'DISCONNECTED':
      statusText.textContent = 'Disconnected';
      statusIndicator.classList.add('disconnected');
      btnToggleConnection.classList.remove('active');
      textConnection.textContent = 'Start Conversation';
      btnToggleMute.disabled = true;
      break;
      
    case 'WAITING_FOR_WAKE_WORD':
      const word = wakeWordInput.value.trim();
      statusText.textContent = `Standby (Say "${word}")`;
      statusIndicator.classList.add('waiting-wake');
      glowRing.classList.add('waiting-wake');
      btnToggleConnection.classList.add('active');
      textConnection.textContent = 'Cancel Standby';
      btnToggleMute.disabled = true;
      break;
      
    case 'CONNECTING':
      statusText.textContent = 'Connecting...';
      statusIndicator.classList.add('connecting');
      glowRing.classList.add('connecting');
      textConnection.textContent = 'Connecting...';
      break;
      
    case 'READY':
      statusText.textContent = 'Listening (Say something)';
      statusIndicator.classList.add('listening');
      glowRing.classList.add('listening');
      btnToggleConnection.classList.add('active');
      textConnection.textContent = 'Stop Conversation';
      btnToggleMute.disabled = false;
      break;
      
    case 'SPEAKING':
      statusText.textContent = 'Gemini Speaking';
      statusIndicator.classList.add('speaking');
      glowRing.classList.add('speaking');
      break;
      
    case 'INTERRUPTED':
      statusText.textContent = 'Interrupted';
      statusIndicator.classList.add('connecting');
      break;
      
    case 'MUTED':
      statusText.textContent = 'Microphone Muted';
      statusIndicator.classList.add('muted');
      break;
  }
}

// Start WebSocket & Audio Pipelines
async function connect() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showNotification('Please enter a valid Gemini API Key.', 'error');
    return;
  }

  updateStatus('CONNECTING');
  chatPlaceholder.style.display = 'none';

  const model = modelSelect.value;
  const voice = voiceSelect.value;
  let instructions = systemInstructions.value.trim();

  // If Wake Word is enabled, inject standby and exit guidelines to system instructions
  if (wakeWordEnabled.checked) {
    const wakeWord = wakeWordInput.value.trim();
    const sleepWord = sleepWordInput.value.trim();
    instructions += `\n\n[STANDBY RULE: You are currently in Standby Mode. Do not respond to any speech from the user unless they say your name "${wakeWord}".
    Always transcribe user speech in Korean characters (한글) unconditionally (e.g. transcribe 'ludens' or 'luden' as '루덴스' or '루덴').
    Once they say "${wakeWord}" or its Korean phonetic variations (like "루덴스", "루벤스", "루덴", "우덴"), wake up, say a short welcoming reply (like "네, 말씀하세요!" or "부르셨나요?"), and converse normally.
    If they say "${sleepWord}" (or "종료", "잘가"), you must say a polite goodbye containing "다음에 또 만나요" or "다음에 또 대화해요" and immediately return to silent standby mode, ignoring subsequent speech. Never output system status messages. Just remain quiet.]`;
  }

  // Load past conversation history and feed it to system instructions
  const activeSession = sessions.find(s => s.id === currentSessionId);
  let historyText = '';
  if (activeSession && activeSession.history && activeSession.history.length > 0) {
    try {
      historyText = '\n\n[PAST CONVERSATION CONTEXT (Use this to remember what was discussed previously):\n';
      // Feed last 15 messages (7-8 turns) to stay within setup prompt limits comfortably
      const recentHistory = activeSession.history.slice(-15);
      recentHistory.forEach(item => {
        const roleLabel = item.role === 'user' ? 'User' : 'Model';
        historyText += `${roleLabel}: ${item.text}\n`;
      });
      historyText += ']';
    } catch(e) {
      console.error('Failed to parse history for system instruction:', e);
    }
  }
  if (historyText) {
    instructions += historyText;
  }

  // Gemini Multimodal Live API endpoint
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  
  try {
    websocket = new WebSocket(url);
  } catch (err) {
    console.error('Failed to establish WebSocket connection:', err);
    disconnect();
    return;
  }

  websocket.onopen = async () => {
    console.log('WebSocket connected.');
    
    // Setup message
    const setupMessage = {
      setup: {
        model: model,
        generation_config: {
          response_modalities: ["AUDIO"],
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: voice
              }
            }
          }
        },
        system_instruction: {
          parts: [{ text: instructions }]
        },
        realtime_input_config: {
          automatic_activity_detection: {
            disabled: false
          }
        },
        input_audio_transcription: {},
        output_audio_transcription: {}
      }
    };
    
    websocket.send(JSON.stringify(setupMessage));
    console.log('Setup configuration sent.');
    
    // Initialize Audio Capture & Playback
    await initAudio();
    isConnected = true;
    
    if (isWaitingForWakeWord) {
      updateStatus('WAITING_FOR_WAKE_WORD');
    } else {
      updateStatus('READY');
    }
  };

  websocket.onmessage = async (event) => {
    try {
      let textData = '';
      if (typeof event.data === 'string') {
        textData = event.data;
      } else if (event.data instanceof Blob) {
        textData = await event.data.text();
      } else if (event.data instanceof ArrayBuffer) {
        const decoder = new TextDecoder('utf-8');
        textData = decoder.decode(event.data);
      }
      
      const response = JSON.parse(textData);
      handleServerMessage(response);
    } catch (e) {
      console.error('Error parsing server message:', e);
      console.error('Raw event data:', event.data);
    }
  };

  websocket.onerror = (error) => {
    console.error('WebSocket Error:', error);
    showNotification('WebSocket connection error occurred.', 'error');
    disconnect();
  };

  websocket.onclose = (event) => {
    console.log(`WebSocket closed: Code ${event.code}, Reason: ${event.reason}`);
    disconnect();
  };
}

// Disconnect Websocket & Release Audio
function disconnect() {
  isConnected = false;
  isWaitingForWakeWord = false;
  
  // Close WebSocket
  if (websocket) {
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.close();
    }
    websocket = null;
  }

  // Stop playback audio
  stopPlayback();

  // Close audio capture nodes
  if (micProcessor) {
    micProcessor.disconnect();
    micProcessor = null;
  }
  if (micSource) {
    micSource.disconnect();
    micSource = null;
  }
  if (micStream) {
    micStream.getTracks().forEach(track => track.stop());
    micStream = null;
  }
  if (audioContext && audioContext.state !== 'closed') {
    audioContext.close();
    audioContext = null;
  }
  if (playbackContext && playbackContext.state !== 'closed') {
    playbackContext.close();
    playbackContext = null;
  }
  
  updateStatus('DISCONNECTED');
  currentUserBubble = null;
  currentGeminiBubble = null;
  console.log('App disconnected.');
}

// (Local Speech Recognition deprecated in favor of Gemini Server-Side VAD matching)

// Play a high-quality double beep chime using Web Audio
function playChime() {
  if (!playbackContext) return;
  try {
    const osc1 = playbackContext.createOscillator();
    const gainNode1 = playbackContext.createGain();
    
    osc1.type = 'sine';
    osc1.connect(gainNode1);
    gainNode1.connect(playbackContext.destination);
    
    const now = playbackContext.currentTime;
    
    // First high note (C5)
    osc1.frequency.setValueAtTime(523.25, now);
    gainNode1.gain.setValueAtTime(0, now);
    gainNode1.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gainNode1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.start(now);
    osc1.stop(now + 0.25);
    
    // Second higher note (E5)
    const osc2 = playbackContext.createOscillator();
    const gainNode2 = playbackContext.createGain();
    
    osc2.type = 'sine';
    osc2.connect(gainNode2);
    gainNode2.connect(playbackContext.destination);
    
    osc2.frequency.setValueAtTime(659.25, now + 0.1);
    gainNode2.gain.setValueAtTime(0, now + 0.1);
    gainNode2.gain.linearRampToValueAtTime(0.12, now + 0.14);
    gainNode2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  } catch (e) {
    console.warn('Failed to play chime:', e);
  }
}

// Play a high-quality descending double beep chime using Web Audio
function playSleepChime() {
  if (!playbackContext) return;
  try {
    const osc1 = playbackContext.createOscillator();
    const gainNode1 = playbackContext.createGain();
    
    osc1.type = 'sine';
    osc1.connect(gainNode1);
    gainNode1.connect(playbackContext.destination);
    
    const now = playbackContext.currentTime;
    
    // First high note (E5)
    osc1.frequency.setValueAtTime(659.25, now);
    gainNode1.gain.setValueAtTime(0, now);
    gainNode1.gain.linearRampToValueAtTime(0.12, now + 0.04);
    gainNode1.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc1.start(now);
    osc1.stop(now + 0.25);
    
    // Second lower note (C5)
    const osc2 = playbackContext.createOscillator();
    const gainNode2 = playbackContext.createGain();
    
    osc2.type = 'sine';
    osc2.connect(gainNode2);
    gainNode2.connect(playbackContext.destination);
    
    osc2.frequency.setValueAtTime(523.25, now + 0.1);
    gainNode2.gain.setValueAtTime(0, now + 0.1);
    gainNode2.gain.linearRampToValueAtTime(0.12, now + 0.14);
    gainNode2.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  } catch (e) {
    console.warn('Failed to play sleep chime:', e);
  }
}

// Initialize Audio Contexts (Capture and Playback)
async function initAudio() {
  try {
    // 1. Microphone capture at 16kHz
    audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: INPUT_SAMPLE_RATE
    });
    
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    micAnalyser = audioContext.createAnalyser();
    micAnalyser.fftSize = 256;
    
    micSource = audioContext.createMediaStreamSource(micStream);
    micSource.connect(micAnalyser);
    
    // ScriptProcessor to buffer audio chunks for streaming
    const bufferSize = 2048; // ~128ms latency
    micProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1);
    
    micProcessor.onaudioprocess = (e) => {
      if (!isConnected || isMuted || appState === 'CONNECTING') return;
      
      const inputData = e.inputBuffer.getChannelData(0);
      const pcm16 = floatTo16BitPCM(inputData);
      const base64PCM = arrayBufferToBase64(pcm16);
      
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        const audioInputMsg = {
          realtime_input: {
            audio: {
              mime_type: "audio/pcm;rate=16000",
              data: base64PCM
            }
          }
        };
        websocket.send(JSON.stringify(audioInputMsg));
      }
    };
    
    micAnalyser.connect(micProcessor);
    micProcessor.connect(audioContext.destination);

    // 2. Playback AudioContext for Gemini response output
    playbackContext = new (window.AudioContext || window.webkitAudioContext)();
    playbackAnalyser = playbackContext.createAnalyser();
    playbackAnalyser.fftSize = 256;
    playbackAnalyser.connect(playbackContext.destination);
    
    nextStartTime = 0;
    
    console.log('Audio initialized successfully.');
  } catch (err) {
    console.error('Microphone access denied or audio init error:', err);
    showNotification('Could not access microphone. Please check settings.', 'error');
    throw err;
  }
}

// Handle Incoming Server Message
function handleServerMessage(message) {
  // 1. Check for Turn Interruption (User Barge-In)
  if (message.serverContent && message.serverContent.interrupted) {
    console.log('Model interrupted by user voice.');
    stopPlayback();
    if (!isWaitingForWakeWord) {
      updateStatus('READY');
    }
    
    // Append an interrupted label in transcript
    if (currentGeminiBubble) {
      const bubble = currentGeminiBubble.querySelector('.message-bubble');
      if (bubble && !bubble.textContent.endsWith(' (말이 끊김)')) {
        bubble.textContent += ' [말이 끊김]';
      }
      currentGeminiBubble = null;
    }
    currentUserBubble = null; // Prepare for next user speech bubble
    return;
  }

  // 2. Check for User Speech Transcription
  if (message.serverContent && message.serverContent.inputTranscription) {
    const transcript = message.serverContent.inputTranscription.text;
    if (transcript) {
      appendOrUpdateUserTranscript(transcript);
      
      const lowerTranscript = transcript.toLowerCase().replace(/\s+/g, '');
      
      // Check for Wake Word in Standby Mode (using space-stripped fuzzy matching and phonetic variations)
      if (isWaitingForWakeWord) {
        const rawWakeWord = wakeWordInput.value.trim().toLowerCase();
        
        // Generate list of acceptable variations
        const variations = [rawWakeWord];
        // Strip spaces
        variations.push(rawWakeWord.replace(/\s+/g, ''));
        
        // If the wake word contains "루덴스" or "ludens", automatically include common Korean homophones/prefixes
        if (rawWakeWord.includes('루덴스') || rawWakeWord.includes('ludens')) {
          variations.push('루덴', '루벤', '누덴', '우덴', '유덴', '루댄');
        }
        
        // Check if any variation matches the transcript (or is a substring of it)
        const matched = variations.some(v => v && lowerTranscript.includes(v));
        if (matched) {
          console.log(`Wake word detected via Gemini transcript ("${transcript}")! Waking up.`);
          isWaitingForWakeWord = false;
          playChime();
          updateStatus('READY');
        }
      }
      // Check for Sleep Word (End Word) in Active Mode
      else if (wakeWordEnabled.checked && !isWaitingForWakeWord && !isTransitioningToStandby) {
        const rawSleepWord = sleepWordInput.value.trim().toLowerCase();
        const sleepVariations = [rawSleepWord];
        sleepVariations.push(rawSleepWord.replace(/\s+/g, ''));
        
        // If the sleep word contains "종료", automatically include common Korean endings/variations
        if (rawSleepWord.includes('종료')) {
          sleepVariations.push('대화종료', '종료해', '대화끝', '끝내자', '잘가', '안녕', '바이');
        }
        
        const matchedSleep = sleepVariations.some(v => v && lowerTranscript.includes(v));
        if (matchedSleep) {
          console.log(`Sleep word detected via Gemini transcript ("${transcript}")! Transitioning to standby after goodbye.`);
          isTransitioningToStandby = true;
          // We do NOT stop playback or play sleep chime yet. We let the goodbye speech finish playing.
        }
      }
    }
  }

  // 3. Check for Model Turn Output (Audio Data & Text Transcripts)
  if (message.serverContent && message.serverContent.modelTurn) {
    const parts = message.serverContent.modelTurn.parts;
    
    parts.forEach(part => {
      // Handle Audio Stream
      if (part.inlineData && part.inlineData.mimeType.startsWith('audio/')) {
        if (isWaitingForWakeWord) {
          console.log('Discarding model audio during standby.');
          return;
        }
        const audioBase64 = part.inlineData.data;
        const pcmBuffer = base64ToArrayBuffer(audioBase64);
        const float32Samples = pcm16ToFloat32(pcmBuffer);
        
        playAudioChunk(float32Samples);
      }
      
      // Handle Text Transcript (if returned directly)
      if (part.text) {
        if (isWaitingForWakeWord) return;
        appendOrUpdateGeminiTranscript(part.text);
      }
    });
  }
  
  // 4. Check for Model Speech Transcript stream
  if (message.serverContent && message.serverContent.outputTranscription) {
    const transcript = message.serverContent.outputTranscription.text;
    if (transcript) {
      if (isWaitingForWakeWord) return;
      appendOrUpdateGeminiTranscript(transcript);
    }
  }

  // 5. Check for Turn Completion
  if (message.serverContent && message.serverContent.turnComplete) {
    console.log('Model turn complete.');
    // Keep speaking state until the final audio buffer is done playing
    if (activeSourceNodes.length === 0) {
      saveCurrentTurnToHistory();
      
      if (isTransitioningToStandby) {
        isWaitingForWakeWord = true;
        isTransitioningToStandby = false;
        playSleepChime();
        updateStatus('WAITING_FOR_WAKE_WORD');
      } else if (!isWaitingForWakeWord) {
        updateStatus('READY');
      }
      currentGeminiBubble = null;
      currentUserBubble = null;
    }
  }
}

// Play Audio Chunk using Timeline Scheduling
function playAudioChunk(float32Data) {
  if (!playbackContext) return;
  
  // Resume context if suspended (browser security)
  if (playbackContext.state === 'suspended') {
    playbackContext.resume();
  }

  // Create standard 24kHz single-channel buffer
  const audioBuffer = playbackContext.createBuffer(1, float32Data.length, OUTPUT_SAMPLE_RATE);
  audioBuffer.getChannelData(0).set(float32Data);
  
  const sourceNode = playbackContext.createBufferSource();
  sourceNode.buffer = audioBuffer;
  
  sourceNode.connect(playbackAnalyser);
  
  const now = playbackContext.currentTime;
  let startTime = nextStartTime;
  
  if (startTime < now) {
    // If we fell behind, reset to play immediately with a tiny offset (20ms) to avoid click
    startTime = now + 0.02;
  }
  
  sourceNode.start(startTime);
  nextStartTime = startTime + audioBuffer.duration;
  
  activeSourceNodes.push(sourceNode);
  updateStatus('SPEAKING');

  sourceNode.onended = () => {
    // Remove from active nodes list
    const index = activeSourceNodes.indexOf(sourceNode);
    if (index > -1) {
      activeSourceNodes.splice(index, 1);
    }
    
    // If all responses finished playing and server turn is complete, return to ready
    if (activeSourceNodes.length === 0 && !isMuted) {
      saveCurrentTurnToHistory();
      
      if (isTransitioningToStandby) {
        isWaitingForWakeWord = true;
        isTransitioningToStandby = false;
        playSleepChime();
        updateStatus('WAITING_FOR_WAKE_WORD');
      } else if (!isWaitingForWakeWord) {
        updateStatus('READY');
      }
      currentGeminiBubble = null;
      currentUserBubble = null;
    }
  };
}

// Stop current playback & clear queue (interruption)
function stopPlayback() {
  activeSourceNodes.forEach(node => {
    try {
      node.stop();
    } catch (e) {
      // Source node may have already ended
    }
  });
  activeSourceNodes.length = 0;
  nextStartTime = 0;
}

// --- TRANSCRIPT RENDERING ---

// Append or update user speech bubble
function appendOrUpdateUserTranscript(text) {
  if (!currentUserBubble) {
    // Hide placeholder if any
    chatPlaceholder.style.display = 'none';
    
    currentUserBubble = document.createElement('div');
    currentUserBubble.className = 'message message-user';
    currentUserBubble.innerHTML = `
      <div class="message-label">🎙️ User</div>
      <div class="message-bubble"></div>
    `;
    transcriptContainer.appendChild(currentUserBubble);
  }
  
  const bubbleContent = currentUserBubble.querySelector('.message-bubble');
  bubbleContent.textContent = text;
  scrollTranscriptToBottom();
}

// Append or update Gemini speech bubble
function appendOrUpdateGeminiTranscript(text) {
  if (!currentGeminiBubble) {
    chatPlaceholder.style.display = 'none';
    
    currentGeminiBubble = document.createElement('div');
    currentGeminiBubble.className = 'message message-gemini streaming';
    currentGeminiBubble.innerHTML = `
      <div class="message-label">✨ Gemini</div>
      <div class="message-bubble"></div>
    `;
    transcriptContainer.appendChild(currentGeminiBubble);
  }
  
  const bubbleContent = currentGeminiBubble.querySelector('.message-bubble');
  
  // Append text incrementally
  if (bubbleContent.textContent.trim() === '') {
    bubbleContent.textContent = text;
  } else if (!bubbleContent.textContent.includes(text)) {
    // If it's a full replacement transcript
    if (text.length > bubbleContent.textContent.length) {
      bubbleContent.textContent = text;
    } else {
      // Append text snippet
      bubbleContent.textContent += text;
    }
  }
  
  scrollTranscriptToBottom();
}

function scrollTranscriptToBottom() {
  transcriptContainer.scrollTop = transcriptContainer.scrollHeight;
}

// --- CONVERSATION SESSION & HISTORY UTILITIES ---
let lastSavedUserBubble = null;

function initSessions() {
  const savedSessions = localStorage.getItem('gemini_sessions');
  const savedCurrentId = localStorage.getItem('gemini_current_session_id');
  
  if (savedSessions) {
    try {
      sessions = JSON.parse(savedSessions);
    } catch (e) {
      sessions = [];
    }
  }
  
  if (!sessions || sessions.length === 0) {
    const defaultSession = {
      id: 'session_' + Date.now(),
      title: '새 대화',
      createdAt: Date.now(),
      history: []
    };
    sessions = [defaultSession];
    currentSessionId = defaultSession.id;
    localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
    localStorage.setItem('gemini_current_session_id', currentSessionId);
  } else {
    currentSessionId = savedCurrentId;
    if (!sessions.some(s => s.id === currentSessionId)) {
      currentSessionId = sessions[0].id;
      localStorage.setItem('gemini_current_session_id', currentSessionId);
    }
  }
  
  renderSessionsList();
  loadConversationHistory();
}

function renderSessionsList() {
  sessionsList.innerHTML = '';
  
  sessions.forEach(session => {
    const isActive = session.id === currentSessionId;
    
    const item = document.createElement('div');
    item.className = `session-item ${isActive ? 'active' : ''}`;
    
    const mainArea = document.createElement('div');
    mainArea.className = 'session-main';
    
    const icon = document.createElement('span');
    icon.className = 'session-icon';
    icon.textContent = '💬';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'session-title';
    titleSpan.textContent = session.title;
    
    mainArea.appendChild(icon);
    mainArea.appendChild(titleSpan);
    item.appendChild(mainArea);
    
    const actions = document.createElement('div');
    actions.className = 'session-actions';
    
    const btnRename = document.createElement('button');
    btnRename.className = 'session-btn rename';
    btnRename.innerHTML = '✏️';
    btnRename.title = '이름 변경';
    
    const btnDelete = document.createElement('button');
    btnDelete.className = 'session-btn delete';
    btnDelete.innerHTML = '🗑️';
    btnDelete.title = '대화 삭제';
    
    actions.appendChild(btnRename);
    actions.appendChild(btnDelete);
    item.appendChild(actions);
    
    sessionsList.appendChild(item);
    
    // Select Session
    mainArea.addEventListener('click', () => {
      if (session.id === currentSessionId) return;
      if (isConnected || isWaitingForWakeWord) {
        disconnect();
      }
      currentSessionId = session.id;
      localStorage.setItem('gemini_current_session_id', currentSessionId);
      renderSessionsList();
      loadConversationHistory();
      showNotification(`"${session.title}" 대화가 로드되었습니다.`, 'success');
    });
    
    // Rename Session
    btnRename.addEventListener('click', (e) => {
      e.stopPropagation();
      
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'session-rename-input';
      input.value = session.title;
      
      mainArea.replaceChild(input, titleSpan);
      actions.style.display = 'none';
      input.focus();
      
      const finalizeRename = () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== session.title) {
          session.title = newTitle;
          localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
        }
        renderSessionsList();
      };
      
      input.addEventListener('blur', finalizeRename);
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          finalizeRename();
        }
      });
    });
    
    // Delete Session
    btnDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      
      if (sessions.length <= 1) {
        showNotification('최소 하나의 대화 세션은 유지되어야 합니다.', 'error');
        return;
      }
      
      if (confirm(`"${session.title}" 대화 세션을 정말 삭제하시겠습니까?`)) {
        if (isConnected || isWaitingForWakeWord) {
          disconnect();
        }
        sessions = sessions.filter(s => s.id !== session.id);
        localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
        
        if (currentSessionId === session.id) {
          currentSessionId = sessions[0].id;
          localStorage.setItem('gemini_current_session_id', currentSessionId);
        }
        
        renderSessionsList();
        loadConversationHistory();
        showNotification('대화 세션이 삭제되었습니다.', 'success');
      }
    });
  });
}

// Bind New Session Click Handler
btnNewSession.addEventListener('click', () => {
  if (isConnected || isWaitingForWakeWord) {
    disconnect();
  }
  
  const newSession = {
    id: 'session_' + Date.now(),
    title: '새 대화',
    createdAt: Date.now(),
    history: []
  };
  
  sessions.push(newSession);
  currentSessionId = newSession.id;
  localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
  localStorage.setItem('gemini_current_session_id', currentSessionId);
  
  renderSessionsList();
  loadConversationHistory();
  showNotification('새 대화 세션이 시작되었습니다.', 'success');
});

function loadConversationHistory() {
  transcriptContainer.innerHTML = '';
  transcriptContainer.appendChild(chatPlaceholder);
  chatPlaceholder.style.display = 'flex';
  
  currentUserBubble = null;
  currentGeminiBubble = null;
  lastSavedUserBubble = null;
  
  const activeSession = sessions.find(s => s.id === currentSessionId);
  if (activeSession && activeSession.history && activeSession.history.length > 0) {
    chatPlaceholder.style.display = 'none';
    activeSession.history.forEach(item => {
      if (item.role === 'user') {
        appendUserBubbleStatic(item.text);
      } else if (item.role === 'model') {
        appendGeminiBubbleStatic(item.text);
      }
    });
    scrollTranscriptToBottom();
  }
}

function appendUserBubbleStatic(text) {
  const messageRow = document.createElement('div');
  messageRow.className = 'message message-user';
  messageRow.innerHTML = `
    <div class="message-label">🎙️ User</div>
    <div class="message-bubble">${text}</div>
  `;
  transcriptContainer.appendChild(messageRow);
}

function appendGeminiBubbleStatic(text) {
  const messageRow = document.createElement('div');
  messageRow.className = 'message message-gemini';
  messageRow.innerHTML = `
    <div class="message-label">✨ Gemini</div>
    <div class="message-bubble">${text}</div>
  `;
  transcriptContainer.appendChild(messageRow);
}

function saveCurrentTurnToHistory() {
  if (!currentUserBubble || !currentGeminiBubble) return;
  if (currentUserBubble === lastSavedUserBubble) return;
  
  const userBubble = currentUserBubble.querySelector('.message-bubble');
  const geminiBubble = currentGeminiBubble.querySelector('.message-bubble');
  
  if (userBubble && geminiBubble) {
    const userText = userBubble.textContent.trim();
    const geminiText = geminiBubble.textContent.trim();
    
    if (userText && geminiText) {
      const activeSession = sessions.find(s => s.id === currentSessionId);
      if (activeSession) {
        activeSession.history.push({ role: 'user', text: userText });
        activeSession.history.push({ role: 'model', text: geminiText });
        
        // Auto-rename title if it's currently a default title
        if (activeSession.title === '새 대화' || activeSession.title === '새 대화 세션') {
          const cleanTitle = userText.length > 15 ? userText.substring(0, 15) + '...' : userText;
          activeSession.title = cleanTitle;
          renderSessionsList();
        }
        
        localStorage.setItem('gemini_sessions', JSON.stringify(sessions));
        lastSavedUserBubble = currentUserBubble;
        console.log('Conversation turn saved to session history.');
      }
    }
  }
}

// Alert notifications
function showNotification(message, type = 'info') {
  console.log(`Notification (${type}): ${message}`);
  // Optional HTML Toast Notification
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '20px';
  toast.style.padding = '12px 24px';
  toast.style.borderRadius = '8px';
  toast.style.backgroundColor = type === 'error' ? '#ef4444' : '#10b981';
  toast.style.color = '#fff';
  toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
  toast.style.fontSize = '14px';
  toast.style.zIndex = '9999';
  toast.style.transition = 'opacity 0.3s ease';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// --- VISUALIZER DRAWING (CANVAS) ---

function drawVisualizer() {
  requestAnimationFrame(drawVisualizer);
  
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  
  const centerX = width / 2;
  const centerY = height / 2;
  const baseRadius = 80;
  
  // Select data array depending on the active state
  let dataArray = null;
  let activeAnalyser = null;
  
  if (appState === 'SPEAKING' && playbackAnalyser) {
    activeAnalyser = playbackAnalyser;
  } else if ((appState === 'READY' || appState === 'MUTED') && micAnalyser && !isMuted) {
    activeAnalyser = micAnalyser;
  }
  
  if (activeAnalyser) {
    const bufferLength = activeAnalyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);
    activeAnalyser.getByteFrequencyData(dataArray);
  }
  
  // Set glow shadow styles
  ctx.shadowBlur = 20;
  
  // Determine Visualizer Color based on state
  let gradient = ctx.createRadialGradient(centerX, centerY, baseRadius - 10, centerX, centerY, baseRadius + 40);
  
  if (appState === 'DISCONNECTED') {
    ctx.shadowColor = 'rgba(239, 68, 68, 0.3)';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
    
    // Draw idle dashed circle
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
    ctx.setLineDash([5, 8]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  } else if (appState === 'CONNECTING') {
    ctx.shadowColor = 'rgba(234, 179, 8, 0.4)';
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.6)';
    ctx.lineWidth = 3;
    
    // Draw a rotating ring
    const rotationTime = Date.now() / 500;
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, rotationTime, rotationTime + Math.PI * 1.5);
    ctx.stroke();
    return;
  } else if (appState === 'MUTED') {
    ctx.shadowColor = 'rgba(249, 115, 22, 0.3)';
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.5)';
    
    // Static circle for muted mic
    ctx.beginPath();
    ctx.arc(centerX, centerY, baseRadius, 0, 2 * Math.PI);
    ctx.lineWidth = 3;
    ctx.stroke();
    return;
  } else if (appState === 'SPEAKING') {
    // Violet/Purple Gradient for Gemini Speaking
    gradient.addColorStop(0, '#a855f7');
    gradient.addColorStop(1, '#6366f1');
    ctx.shadowColor = 'rgba(168, 85, 247, 0.5)';
    ctx.strokeStyle = gradient;
  } else { // READY / LISTENING
    // Emerald/Cyan Gradient for User Speaking / Listening
    gradient.addColorStop(0, '#10b981');
    gradient.addColorStop(1, '#06b6d4');
    ctx.shadowColor = 'rgba(16, 185, 129, 0.4)';
    ctx.strokeStyle = gradient;
  }
  
  ctx.lineWidth = 4;
  ctx.beginPath();
  
  if (dataArray) {
    const numPoints = 80;
    const angleStep = (Math.PI * 2) / numPoints;
    
    for (let i = 0; i < numPoints; i++) {
      // Index smoothing
      const dataIndex = Math.floor((i / numPoints) * (dataArray.length * 0.6));
      const rawVal = dataArray[dataIndex] || 0;
      
      // Calculate wave multiplier
      const amplitude = Math.max(0, (rawVal - 40) / 180) * 45;
      
      const angle = i * angleStep;
      // Add a slight sinewave wobble for extra organic feel
      const wobble = Math.sin(Date.now() / 150 + i * 0.5) * 2;
      const currentRadius = baseRadius + amplitude + wobble;
      
      const x = centerX + Math.cos(angle) * currentRadius;
      const y = centerY + Math.sin(angle) * currentRadius;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    
    ctx.closePath();
    ctx.stroke();
  } else {
    // Idle state: draw organic undulating sine wave ring
    const numPoints = 80;
    const angleStep = (Math.PI * 2) / numPoints;
    const timeFactor = Date.now() / 800;
    
    for (let i = 0; i < numPoints; i++) {
      const angle = i * angleStep;
      // Organic waving motion using sine and cosine frequencies
      const offset = Math.sin(angle * 4 + timeFactor) * Math.cos(angle * 2 - timeFactor) * 4;
      const currentRadius = baseRadius + offset;
      
      const x = centerX + Math.cos(angle) * currentRadius;
      const y = centerY + Math.sin(angle) * currentRadius;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.stroke();
  }
}

// Start Visualizer loop immediately
drawVisualizer();
