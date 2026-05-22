const socket = io();

// --- SHARED AUDIO CONTEXT LIFECYCLE ACCESSOR ---
let globalAudioCtx = null;
function getAudioContext() {
    if (!globalAudioCtx) {
        globalAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (globalAudioCtx.state === 'suspended') {
        globalAudioCtx.resume();
    }
    return globalAudioCtx;
}

const username = localStorage.getItem('username') || 'ANON_AGENT';
const chatFeed = document.getElementById('chat-feed');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text-btn');
const secretInput = document.getElementById('secret-msg');
const keyInput = document.getElementById('enc-key');
const carrierUpload = document.getElementById('carrier-upload');
const vaultList = document.getElementById('vault-list');
const auditLogEl = document.getElementById('audit-log');
let selectedCarrierFile = null;
let recordingStream = null;
let mediaRecorder = null;
let audioChunks = [];
let selectedBlobUrl = null;
let currentAudioBlob = null;

const stopBtn = document.getElementById('stop-btn');
const recordBtn = document.getElementById('record-btn');
const previewPlayer = document.getElementById('audio-preview');
const previewContainer = document.getElementById('preview-container');
const micAnimation = document.getElementById('mic-animation');
const logoutBtn = document.getElementById('logout-btn');

if (logoutBtn) {
    logoutBtn.onclick = () => {
        localStorage.removeItem('username');
        window.location.href = '/';
    };
}

async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        window.showToast && window.showToast('VOICE_CAPTURE_UNSUPPORTED', true);
        return;
    }

    try {
        recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        let recorderMime = '';
        const types = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/aac'];
        for (const t of types) {
            if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
                recorderMime = t;
                break;
            }
        }
        
        const options = recorderMime ? { mimeType: recorderMime } : {};
        mediaRecorder = new MediaRecorder(recordingStream, options);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            const actualMime = mediaRecorder.mimeType || 'audio/webm';
            const ext = actualMime.split('/')[1]?.split(';')[0] || 'webm';
            currentAudioBlob = new Blob(audioChunks, { type: actualMime });
            selectedCarrierFile = new File([currentAudioBlob], `recording_${Date.now()}.${ext}`, { type: actualMime });
            selectedBlobUrl = URL.createObjectURL(currentAudioBlob);
            if (previewPlayer && previewContainer) {
                previewContainer.style.display = 'flex';
                previewPlayer.src = selectedBlobUrl;
                previewPlayer.load();
            }
            addToAuditLog('VOICE_CAPTURE_COMPLETE');
        };

        mediaRecorder.start();
        if (recordBtn) {
            recordBtn.disabled = true;
            recordBtn.textContent = 'RECORDING...';
        }
        if (stopBtn) stopBtn.style.display = 'flex';
        if (micAnimation) micAnimation.style.display = 'flex';
        addToAuditLog('VOICE_CAPTURE_STARTED');
    } catch (error) {
        console.error('VOICE_CAPTURE_ERROR:', error);
        window.showToast && window.showToast('VOICE_CAPTURE_FAILED', true);
        addToAuditLog('VOICE_CAPTURE_ERROR');
    }
}

function forceStopRecording(event) {
    event && event.preventDefault();
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (recordingStream) {
        recordingStream.getTracks().forEach(track => track.stop());
        recordingStream = null;
    }
    if (recordBtn) {
        recordBtn.disabled = false;
        recordBtn.textContent = '🎤 Record Voice';
    }
    if (stopBtn) stopBtn.style.display = 'none';
    if (micAnimation) micAnimation.style.display = 'none';
}

// --- 0. HANDSHAKE LISTENERS (RECEIVE AT TOP) ---

socket.on('user-count', (count) => {
    const userCountVal = document.getElementById('user-count-val');
    if (userCountVal) userCountVal.textContent = count;
});

socket.on('incoming-packet', (packet) => {
    receive(packet);
});

// Typing Indicator Handlers
let typingTimeout = null;
textInput.addEventListener('input', () => {
    socket.emit('typing', { username, isTyping: true });
    
    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', { username, isTyping: false });
    }, 2000);
});

socket.on('typing', (data) => {
    const indicator = document.getElementById('typing-indicator');
    const text = document.getElementById('typing-text');
    if (indicator && text) {
        if (data.isTyping) {
            text.textContent = `${data.username} is typing...`;
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    }
});// ... rest of script until click listener ...// Event Delegation for Decrypt interactions
window.addEventListener("click", async (e) => {
    if (e.target.classList.contains('decode-btn')) {
        const card = e.target.closest('.message');
        const secretText = card.dataset.payload;
        const correctKey = card.dataset.key || '';
        const audioEl = card.querySelector('audio');

        // Visual: Decrypting Progress Bar
        const progressContainer = card.querySelector('.progress-container');
        const progressBar = card.querySelector('.progress-bar');
        const originalText = e.target.textContent;
        
        e.target.disabled = true;
        e.target.textContent = "DECRYPTING...";
        
        if (progressContainer) {
            progressContainer.style.display = 'block';
        }
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.offsetHeight; // trigger reflow
            progressBar.style.transition = 'width 1.5s linear';
            progressBar.style.width = '100%';
        }

        // Real steganography decoding directly from the audio waveform
        let decodedText = null;
        if (audioEl && audioEl.src) {
            try {
                addToAuditLog("EXTRACTING_LSB_PAYLOAD...");
                const response = await fetch(audioEl.src);
                const audioBlob = await response.blob();
                decodedText = await StegoEngine.decode(audioBlob);
            } catch (err) {
                console.error("STEGO_DECODE_ERR:", err);
            }
        }

        // Wait 1.5s total to match the scanning scanning animation
        await new Promise(resolve => setTimeout(resolve, 1500));

        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (progressBar) {
            progressBar.style.width = '0%';
            progressBar.style.transition = 'none';
        }
        e.target.textContent = originalText;
        e.target.disabled = false;

        // Fallback to metadata payload if real stego extraction failed/empty
        const finalSecretText = decodedText || secretText;

        if (!finalSecretText) {
            addToAuditLog("SYSTEM_ERROR: PAYLOAD_MISSING");
            if(window.showToast) window.showToast("SYSTEM_ERROR: PAYLOAD_MISSING", true);
            return;
        }

        // Ask for key only if one was set; skip prompt for unprotected payloads
        const pass = correctKey ? prompt('Enter decryption key:') : '';
        if (pass === null) return; // user cancelled

        const normalizedPass = pass || '';
        const normalizedKey  = correctKey || '';

        if (normalizedPass === normalizedKey) {
            addToAuditLog("STEGO_PAYLOAD_DECRYPTED");
            const reveal = document.createElement('div');
            reveal.style.color = 'var(--electric-cyan)';
            reveal.style.marginTop = '15px';
            reveal.style.padding = '12px';
            reveal.style.background = 'rgba(0, 242, 255, 0.05)';
            reveal.style.border = '1px solid rgba(0, 242, 255, 0.1)';
            reveal.style.fontFamily = 'Share Tech Mono, monospace';
            reveal.style.fontWeight = 'bold';
            reveal.style.position = 'relative';
            
            const msgSpan = document.createElement('span');
            msgSpan.textContent = `> INTERCEPTED: ${finalSecretText}`;
            reveal.appendChild(msgSpan);

            const timerSpan = document.createElement('span');
            timerSpan.style.color = 'var(--vivid-magenta)';
            timerSpan.style.marginLeft = '10px';
            timerSpan.textContent = "[15s]";
            reveal.appendChild(timerSpan);
            
            card.appendChild(reveal);
            e.target.style.display = 'none';

            let timeLeft = 15;
            const countdown = setInterval(() => {
                timeLeft--;
                timerSpan.textContent = `[${timeLeft}s]`;
                if (timeLeft <= 0) clearInterval(countdown);
            }, 1000);

            setTimeout(() => {
                msgSpan.textContent = "> [DATA_PURGED]";
                reveal.style.color = "#444";
                reveal.style.borderColor = "#222";
                timerSpan.remove();
                setTimeout(() => reveal.remove(), 2000);
            }, 15000);
        } else {
            addToAuditLog("AES_KEY_MISMATCH");
            if(window.showToast) window.showToast("ACCESS_DENIED: INVALID_AES_KEY", true);
        }
    }
});

// Helper to convert Blob URL to Base64
async function getBase64FromUrl(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

const LOG_MAP = {
    'STEGO_PROTOCOL_ARMED': { normal: 'SECURE_CHANNEL_ACTIVATED', covert: 'STEGO_PROTOCOL_ARMED' },
    'STEGO_PROTOCOL_DISARMED': { normal: 'SECURE_CHANNEL_DEACTIVATED', covert: 'STEGO_PROTOCOL_DISARMED' },
    'VOICE_CAPTURE_STARTED': { normal: 'AUDIO_INPUT_STARTED', covert: 'VOICE_CAPTURE_STARTED' },
    'VOICE_CAPTURE_COMPLETE': { normal: 'AUDIO_INPUT_COMPLETE', covert: 'VOICE_CAPTURE_COMPLETE' },
    'VOICE_CAPTURE_ERROR': { normal: 'AUDIO_INPUT_ERROR', covert: 'VOICE_CAPTURE_ERROR' },
    'STEGO_PAYLOAD_DECRYPTED': { normal: 'PAYLOAD_DECRYPTED', covert: 'STEGO_PAYLOAD_DECRYPTED' },
    'AES_KEY_MISMATCH': { normal: 'DECRYPTION_FAILED', covert: 'AES_KEY_MISMATCH' },
    'STEGO_PACKET_ENCODED_AND_SENT': { normal: 'AUDIO_MESSAGE_SENT', covert: 'STEGO_PACKET_ENCODED_AND_SENT' },
    'COVERT_PACKET_RECEIVED': { normal: 'AUDIO_MESSAGE_RECEIVED', covert: 'COVERT_PACKET_RECEIVED' },
    'CARRIER_UPLINK_STABLE': { normal: 'MEDIA_STREAM_STABLE', covert: 'CARRIER_UPLINK_STABLE' },
    'CARRIER_LOAD_SUCCESS': { normal: 'MEDIA_LOAD_SUCCESS', covert: 'CARRIER_LOAD_SUCCESS' },
    'CARRIER_LOAD_FAILURE': { normal: 'MEDIA_LOAD_FAILURE', covert: 'CARRIER_LOAD_FAILURE' },
    'SYSTEM_ERROR: PAYLOAD_MISSING': { normal: 'ERROR: AUDIO_DATA_CORRUPT', covert: 'SYSTEM_ERROR: PAYLOAD_MISSING' }
};

function updateAuditLogs() {
    const isCovert = document.body.classList.contains('covert-active');
    document.querySelectorAll('.audit-entry').forEach(entry => {
        const code = entry.dataset.logCode;
        if (code) {
            const map = LOG_MAP[code];
            const text = map ? (isCovert ? map.covert : map.normal) : code;
            const timePart = entry.textContent.split(' | ')[0];
            entry.textContent = `${timePart} | ${text}`;
        }
    });
}

function addToAuditLog(message) {
    if (!auditLogEl) return;
    const entry = document.createElement('div');
    entry.className = 'audit-entry';
    entry.dataset.logCode = message;
    
    const isCovert = document.body.classList.contains('covert-active');
    const map = LOG_MAP[message];
    const text = map ? (isCovert ? map.covert : map.normal) : message;
    
    entry.textContent = `${new Date().toLocaleTimeString()} | ${text}`;
    auditLogEl.prepend(entry);
}

function getBase64FromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function addToVault(audioUrl, filename) {
    if (!vaultList) return;
    const item = document.createElement('div');
    item.className = 'vault-item';
    item.innerHTML = `<span>${filename}</span> <a href="${audioUrl}" download="${filename}">DOWNLOAD</a>`;
    vaultList.appendChild(item);
}

// ================================================================
// === REAL LSB STEGANOGRAPHY ENGINE =============================
// ================================================================
const StegoEngine = {
    // Convert string to bit string
    strToBits: (str) => {
        return str.split('').map(char => char.charCodeAt(0).toString(2).padStart(8, '0')).join('');
    },
    // Convert bit string back to string
    bitsToStr: (bits) => {
        let str = '';
        for (let i = 0; i < bits.length; i += 8) {
            str += String.fromCharCode(parseInt(bits.substr(i, 8), 2));
        }
        return str;
    },
    // Helper: Decode Audio data without resampling
    async decodeAudioExactly(audioBlob) {
        const arrayBuffer = await audioBlob.arrayBuffer();
        let sampleRate = 44100;
        
        // Parse WAV sample rate from header if available
        if (arrayBuffer.byteLength >= 44) {
            const view = new DataView(arrayBuffer);
            if (view.getUint32(0, false) === 0x52494646 && // "RIFF"
                view.getUint32(8, false) === 0x57415645) { // "WAVE"
                sampleRate = view.getUint32(24, true);
            }
        }
        
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, sampleRate);
        return await offlineCtx.decodeAudioData(arrayBuffer);
    },
    // Main Encoder: Returns a WAV Blob with hidden data
    async encode(audioBlob, secretText) {
        if (!secretText) return audioBlob;
        
        const audioBuffer = await this.decodeAudioExactly(audioBlob);
        
        // We use the first channel for stego
        const channelData = audioBuffer.getChannelData(0);
        const bitString = this.strToBits(secretText);
        
        // Add a 32-bit length header
        const lengthHeader = bitString.length.toString(2).padStart(32, '0');
        const finalBits = lengthHeader + bitString;
        
        if (finalBits.length > channelData.length) {
            throw new Error(`PAYLOAD_TOO_LARGE: Audio is too short for this message.`);
        }
        
        // Inject bits into LSB
        for (let i = 0; i < finalBits.length; i++) {
            // Convert float sample (-1 to 1) to 16-bit int (-32768 to 32767)
            let sample = Math.max(-1, Math.min(1, channelData[i]));
            let intSample = sample < 0 ? sample * 32768 : sample * 32767;
            
            // Set LSB
            if (finalBits[i] === '1') {
                intSample = (Math.round(intSample) | 1);
            } else {
                intSample = (Math.round(intSample) & ~1);
            }
            
            // Convert back to float
            channelData[i] = intSample < 0 ? intSample / 32768 : intSample / 32767;
        }
        
        return this.audioBufferToWavBlob(audioBuffer);
    },
    // Main Decoder: Returns the hidden string from an audio blob
    async decode(audioBlob) {
        try {
            const audioBuffer = await this.decodeAudioExactly(audioBlob);
            const channelData = audioBuffer.getChannelData(0);
            
            // 1. Read 32-bit length header
            let lengthBits = '';
            for (let i = 0; i < 32; i++) {
                let sample = Math.max(-1, Math.min(1, channelData[i]));
                let intSample = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
                lengthBits += (Math.abs(intSample) & 1).toString();
            }
            const dataLength = parseInt(lengthBits, 2);
            
            if (isNaN(dataLength) || dataLength <= 0 || dataLength > (channelData.length - 32)) {
                return null; // No valid stego header found
            }
            
            // 2. Read data bits
            let dataBits = '';
            for (let i = 32; i < 32 + dataLength; i++) {
                let sample = Math.max(-1, Math.min(1, channelData[i]));
                let intSample = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
                dataBits += (Math.abs(intSample) & 1).toString();
            }
            
            return this.bitsToStr(dataBits);
        } catch (e) {
            console.error("StegoEngine decode error:", e);
            return null;
        }
    },
    // Helper: Convert AudioBuffer to lossless WAV Blob
    audioBufferToWavBlob(buffer) {
        const numOfChan = buffer.numberOfChannels;
        const length = buffer.length * numOfChan * 2 + 44;
        const outBuffer = new ArrayBuffer(length);
        const view = new DataView(outBuffer);
        const channels = [];
        let offset = 0;
        let pos = 0;
        
        const setUint16 = (data) => { view.setUint16(pos, data, true); pos += 2; };
        const setUint32 = (data) => { view.setUint32(pos, data, true); pos += 4; };
        
        setUint32(0x46464952); // "RIFF"
        setUint32(length - 8); // file length - 8
        setUint32(0x45564157); // "WAVE"
        setUint32(0x20746d66); // "fmt " chunk
        setUint32(16);         // length = 16
        setUint16(1);          // PCM (uncompressed)
        setUint16(numOfChan);
        setUint32(buffer.sampleRate);
        setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
        setUint16(numOfChan * 2); // block-align
        setUint16(16);            // 16-bit
        setUint32(0x61746164); // "data" - chunk
        setUint32(length - pos - 4); // chunk length
        
        for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
        
        while (pos < length) {
            for (let i = 0; i < numOfChan; i++) {
                let sample = Math.max(-1, Math.min(1, channels[i][offset]));
                sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF);
                view.setInt16(pos, sample, true);
                pos += 2;
            }
            offset++;
        }
        return new Blob([outBuffer], { type: 'audio/wav' });
    }
};

// --- 4. MESSAGE HANDLING & SOCKETS ---

async function transmit(message, audioBlob) {
    if (!audioBlob && !message) return;

    // FIX: Capture form values SYNCHRONOUSLY before any async operation.
    // FileReader is async — by the time its callback fires, the inputs
    // may already have been cleared by the caller, losing the payload.
    const capturedPayload = secretInput.value || "";
    const capturedKey = keyInput.value || "";

    const sendPacket = (base64, mimeType) => {
        const packet = {
            sender: username,
            text: message,
            audioData: base64,
            audioMime: mimeType || (audioBlob ? audioBlob.type : null),
            type: 'STEGO_PACKET',
            hidden_payload: capturedPayload, // metadata fallback for UI
            aes_key: capturedKey
        };
        
        socket.emit('incoming-packet', packet);
        
        // Local Display
        renderMessage({
            text: packet.text,
            audio: packet.audioData,
            audioMime: packet.audioMime,
            sender: username,
            hidden_payload: packet.hidden_payload,
            aes_key: packet.aes_key
        }, true);

        // ... reset inputs ...
        secretInput.value = '';
        keyInput.value = '';
        currentAudioBlob = null;
        selectedCarrierFile = null;
        if (previewPlayer) {
            previewPlayer.src = '';
            const previewContainerEl = document.getElementById('preview-container');
            if (previewContainerEl) previewContainerEl.style.display = 'none';
        }
        
        addToAuditLog('STEGO_PACKET_ENCODED_AND_SENT');
    };

    if (audioBlob) {
        try {
            addToAuditLog('ENCODING_LSB_BITS...');
            // Step 1: Actually hide the data in the audio samples
            const stegoBlob = await StegoEngine.encode(audioBlob, capturedPayload);
            // Step 2: Convert to base64 for transmission
            const reader = new FileReader();
            reader.onload = () => sendPacket(reader.result, stegoBlob.type);
            reader.readAsDataURL(stegoBlob);
        } catch (err) {
            console.error("STEGO_ENCODE_ERROR:", err);
            window.showToast && window.showToast("STEGO_ENCODE_FAILED: " + err.message, true);
        }
    } else {
        sendPacket(null, null);
    }
}

// --- 5. UI RENDERING (THE RECEIVE) ---

function receive(packet) {
    if (packet.sender === username) return;  // Skip own messages echoed back by server

    let audioUrl = null;
    if (packet.audioData) {
        try {
            // FIX: use the MIME type sent by the transmitter (was always hardcoded 'audio/wav')
            const mimeType = packet.audioMime || 'audio/webm';
            const base64Part = packet.audioData.includes(',') ? packet.audioData.split(',')[1] : packet.audioData;
            const binaryString = window.atob(base64Part);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes], { type: mimeType });
            audioUrl = URL.createObjectURL(blob);
            addToAuditLog('> COVERT_PACKET_RECEIVED');
        } catch (err) {
            console.error("PACKET_AUDIO_DECODE_ERROR:", err);
        }
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.style.alignSelf = 'flex-start';
    wrapper.style.marginBottom = '20px';
    if (packet.hidden_payload) {
        wrapper.classList.add('stego-element');
    }

    const senderLabel = document.createElement('div');
    senderLabel.className = 'sender-tag';
    senderLabel.style.color = 'var(--electric-cyan)';
    senderLabel.textContent = packet.sender || 'REMOTE_AGENT';
    wrapper.appendChild(senderLabel);

    const card = document.createElement('div');
    card.className = 'message';
    card.style.background = 'rgba(255, 255, 255, 0.03)';
    card.style.borderLeft = '3px solid var(--electric-cyan)';

    if (packet.text) {
        const textDiv = document.createElement('div');
        textDiv.textContent = packet.text;
        card.appendChild(textDiv);
    }

    if (audioUrl) {
        const label = document.createElement('div');
        label.style.color = '#888';
        label.style.fontSize = '10px';
        label.style.fontWeight = '700';
        label.style.marginTop = packet.text ? '12px' : '0';
        label.style.marginBottom = '8px';
        label.textContent = 'ENCRYPTED_DATA_PACKET';
        card.appendChild(label);

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = audioUrl;
        audio.style.width = '100%';
        audio.style.height = '32px';
        audio.load();
        card.appendChild(audio);

        const progContainer = document.createElement('div');
        progContainer.className = 'progress-container';
        progContainer.style.display = 'none';
        const progBar = document.createElement('div');
        progBar.className = 'progress-bar';
        progContainer.appendChild(progBar);
        card.appendChild(progContainer);

        const decodeBtn = document.createElement('button');
        decodeBtn.className = 'decode-btn';
        decodeBtn.textContent = 'DECRYPT_PAYLOAD';
        decodeBtn.style.marginTop = '12px';
        decodeBtn.style.width = '100%';
        
        if (packet.hidden_payload) card.dataset.payload = packet.hidden_payload;
        if (packet.aes_key) card.dataset.key = packet.aes_key;
        
        card.appendChild(decodeBtn);

        // Add received stego audio to vault
        if (packet.hidden_payload) {
            addToVault(audioUrl, `REMOTE_CARRIER_${Date.now()}.webm`);
        }
    }

    // Capture scroll state before appending
    const isAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight < 100;

    wrapper.appendChild(card);
    chatFeed.appendChild(wrapper);

    if (isAtBottom) {
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }
}

function renderMessage(payload, isMe) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
    wrapper.style.marginBottom = '20px';
    if (payload.hidden_payload) {
        wrapper.classList.add('stego-element');
    }

    const senderLabel = document.createElement('div');
    senderLabel.className = 'sender-tag';
    senderLabel.style.color = isMe ? 'var(--vivid-magenta)' : 'var(--electric-cyan)';
    senderLabel.textContent = isMe ? 'LOCAL_AGENT' : (payload.sender || 'REMOTE_AGENT');
    wrapper.appendChild(senderLabel);

    const card = document.createElement('div');
    card.className = 'message';
    card.style.background = 'rgba(255, 255, 255, 0.03)';
    card.style.borderLeft = isMe ? '3px solid var(--vivid-magenta)' : '3px solid var(--electric-cyan)';

    // Handle Text
    const messageText = payload.text || payload.content;
    if (messageText) {
        const textDiv = document.createElement('div');
        textDiv.textContent = messageText;
        card.appendChild(textDiv);
    }

    // Handle Audio
    if (payload.audio) {
        const label = document.createElement('div');
        label.style.color = '#888';
        label.style.fontSize = '10px';
        label.style.fontWeight = '700';
        label.style.marginTop = messageText ? '12px' : '0';
        label.style.marginBottom = '8px';
        label.textContent = 'ENCRYPTED_DATA_PACKET';
        card.appendChild(label);

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = payload.audio;
        audio.style.width = '100%';
        audio.style.height = '32px';
        audio.load();
        card.appendChild(audio);

        const progContainer = document.createElement('div');
        progContainer.className = 'progress-container';
        progContainer.style.display = 'none';
        const progBar = document.createElement('div');
        progBar.className = 'progress-bar';
        progContainer.appendChild(progBar);
        card.appendChild(progContainer);

        const decodeBtn = document.createElement('button');
        decodeBtn.className = 'decode-btn';
        decodeBtn.textContent = 'DECRYPT_PAYLOAD';
        decodeBtn.style.marginTop = '12px';
        decodeBtn.style.width = '100%';
        
        if (payload.hidden_payload) {
            card.dataset.payload = payload.hidden_payload;
        }

        if (payload.aes_key) {
            card.dataset.key = payload.aes_key;
        }
        
        card.appendChild(decodeBtn);
        
        // FIX: Add sent audio to vault too (not just incoming)
        if (payload.hidden_payload) {
            addToVault(payload.audio, `${isMe ? 'LOCAL' : 'INCOMING'}_CARRIER_${Date.now()}.wav`);
        }
    }

    // Capture scroll state before appending
    const isAtBottom = chatFeed.scrollHeight - chatFeed.scrollTop - chatFeed.clientHeight < 100;

    wrapper.appendChild(card);
    chatFeed.appendChild(wrapper);

    if (isMe || isAtBottom) {
        chatFeed.scrollTop = chatFeed.scrollHeight;
    }
}

// --- 6. INPUT HANDLERS ---

sendTextBtn.onclick = async () => {
    const text = textInput.value;
    if (!text && !currentAudioBlob) return;
    textInput.value = '';
    // NOTE: secretInput, keyInput, currentAudioBlob, and preview are reset
    // inside transmit() → sendPacket() to avoid the async race condition
    transmit(text, currentAudioBlob);
};
textInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        sendTextBtn.click();
    }
};

carrierUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    // Reset file input so same file can be re-selected next time
    e.target.value = '';

    selectedCarrierFile = file;
    currentAudioBlob = file;
    if (selectedBlobUrl) {
        URL.revokeObjectURL(selectedBlobUrl);
        selectedBlobUrl = null;
    }

    selectedBlobUrl = URL.createObjectURL(file);
    const probe = new Audio();

    probe.oncanplaythrough = () => {
        addToAuditLog('CARRIER_UPLINK_STABLE');
        if (previewPlayer && previewContainer) {
            previewContainer.style.display = 'flex';
            previewPlayer.src = selectedBlobUrl;
            previewPlayer.load();
        }
        addToAuditLog('CARRIER_LOAD_SUCCESS');
        if (window.showToast) window.showToast('CARRIER_READY: YOU CAN NOW ADD PAYLOAD AND SEND', false);
    };

    probe.onerror = () => {
        if (selectedBlobUrl) {
            URL.revokeObjectURL(selectedBlobUrl);
            selectedBlobUrl = null;
        }
        if (window.showToast) window.showToast('CARRIER_REJECTED: BROWSER_CANNOT_DECODE', true);
        addToAuditLog('CARRIER_LOAD_FAILURE');
    };

    probe.src = selectedBlobUrl;
    probe.load();
};

// ================================================================
// === NEW MODULES (Purely Additive — No existing code modified) ===
// ================================================================

// --- MODULE B: AGENT ROSTER ---
(function() {
    // Re-register agent on connection or reconnection
    socket.on('connect', () => {
        socket.emit('register-agent', { username });
    });

    if (socket.connected) {
        socket.emit('register-agent', { username });
    }

    socket.on('agent-roster', (roster) => {
        const list = document.getElementById('agent-roster-list');
        if (!list) return;
        list.innerHTML = '';
        roster.forEach(name => {
            const badge = document.createElement('div');
            badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';
            const dot = name === username ? 'var(--vivid-magenta)' : 'var(--electric-cyan)';
            badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%!important;background:${dot};flex-shrink:0;"></span><span style="color:${dot};font-size:10px;text-transform:uppercase;">${name}${name === username ? ' [YOU]' : ''}</span>`;
            list.appendChild(badge);
        });
    });
})();

// --- MODULE C: PAYLOAD ANALYZER ---
(function() {
    let carrierBytes = 0;
    function updateLSB() {
        const lsbVal = document.getElementById('lsb-density-val');
        const lsbBar = document.getElementById('lsb-bar');
        const lsbDetail = document.getElementById('lsb-detail');
        if (!lsbVal) return;
        const bits = secretInput ? secretInput.value.length * 8 : 0;
        const density = carrierBytes > 0 ? Math.min((bits / carrierBytes) * 100, 100) : 0;
        lsbVal.textContent = density.toFixed(1) + '%';
        lsbVal.style.color = density > 50 ? 'var(--vivid-magenta)' : density > 20 ? 'var(--accent-amber)' : 'var(--electric-cyan)';
        if (lsbBar) lsbBar.style.width = Math.min(density, 100) + '%';
        if (lsbDetail) lsbDetail.textContent = `PAYLOAD: ${bits} bits | CARRIER: ${carrierBytes} bytes`;
        // Sync header chip
        const headerChip = document.getElementById('lsb-header-val');
        if (headerChip) headerChip.textContent = density.toFixed(1) + '%';
    }
    if (secretInput) secretInput.addEventListener('input', updateLSB);
    const ul = document.getElementById('carrier-upload');
    if (ul) ul.addEventListener('change', (e) => { if (e.target.files[0]) { carrierBytes = e.target.files[0].size; updateLSB(); } });
})();

// --- MODULE D: MESSAGE SHREDDER ---
(function() {
    const btn = document.getElementById('shredder-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
        if (!confirm('CONFIRM: PURGE ALL INTERFACE DATA?')) return;
        if (chatFeed) {
            chatFeed.querySelectorAll('.message-wrapper').forEach(el => el.remove());
            const emptyEl = chatFeed.querySelector('.chat-empty');
            if (emptyEl) emptyEl.style.display = '';
        }
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.style.display = 'none';
        if (auditLogEl) auditLogEl.innerHTML = '';
        if (vaultList) vaultList.innerHTML = '';
        const txBody = document.getElementById('tx-log-body');
        if (txBody) txBody.innerHTML = '';
        const status = document.getElementById('shred-status');
        if (status) status.textContent = `> SHREDDED AT ${new Date().toLocaleTimeString()}`;
        if (window.showToast) window.showToast('[DATA_PURGED] All interface data wiped.');
    });
})();

// --- MODULE A: LIVE PING MONITOR ---
(function() {
    const canvas = document.getElementById('ping-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const data = [];
    const MAX = 30;
    const curEl = document.getElementById('ping-current');
    const avgEl = document.getElementById('ping-avg');

    function draw() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        if (data.length < 2) return;
        const max = Math.max(...data, 100);
        const step = W / (MAX - 1);
        const latest = data[data.length - 1];
        const col = latest < 50 ? '#00ff88' : latest < 150 ? 'var(--accent-amber)' : 'var(--vivid-magenta)';
        ctx.beginPath();
        data.forEach((v, i) => { const x = i * step, y = H - (v / max) * H * 0.85; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
        ctx.lineTo((data.length - 1) * step, H); ctx.lineTo(0, H); ctx.closePath();
        ctx.fillStyle = latest < 50 ? 'rgba(0,255,136,0.07)' : latest < 150 ? 'rgba(255,191,0,0.07)' : 'rgba(255,0,234,0.07)';
        ctx.fill();
    }

    setInterval(() => {
        const t = Date.now();
        socket.emit('ping-check', t, (ts) => {
            const ms = Date.now() - ts;
            data.push(ms);
            if (data.length > MAX) data.shift();
            const avg = Math.round(data.reduce((a, b) => a + b, 0) / data.length);
            if (curEl) curEl.textContent = ms + ' ms';
            if (avgEl) avgEl.textContent = 'AVG: ' + avg + ' ms';
            draw();
        });
    }, 1000);
})();

// --- MODULE E: TRANSMISSION LOG ---
(function() {
    const tbody = document.getElementById('tx-log-body');
    if (!tbody) return;
    function addRow(dir, sender, payload, key) {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.04)';
        if (payload) {
            tr.className = 'stego-element';
        }
        const col = dir === '↑' ? 'var(--vivid-magenta)' : 'var(--electric-cyan)';
        tr.innerHTML = `<td style="padding:4px;color:#555;">${new Date().toLocaleTimeString()}</td><td style="padding:4px;color:${col};font-weight:bold;">${dir}</td><td style="padding:4px;color:var(--electric-cyan);max-width:60px;overflow:hidden;text-overflow:ellipsis;">${sender||'?'}</td><td style="padding:4px;color:#aaa;">${payload ? payload.length+'B' : '---'}</td><td class="stego-element" style="padding:4px;color:#555;">${key ? key.substring(0,2)+'***' : '---'}</td>`;
        tbody.insertBefore(tr, tbody.firstChild);
        while (tbody.children.length > 50) tbody.removeChild(tbody.lastChild);
    }
    socket.on('incoming-packet', (pkt) => addRow(pkt.sender === username ? '↑' : '↓', pkt.sender, pkt.hidden_payload, pkt.aes_key));
})();

// --- MODULE F: NOISE GENERATOR ---
(function() {
    const btn = document.getElementById('noise-toggle-btn');
    if (!btn) return;
    const pulse = document.getElementById('noise-pulse');
    const statusEl = document.getElementById('noise-status');
    const countEl = document.getElementById('noise-count');
    let timer = null, count = 0, running = false;
    function rnd(len) { let s=''; const c='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for(let i=0;i<len;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
    function schedule() {
        if (!running) return;
        timer = setTimeout(() => { socket.emit('noise-packet', { data: rnd(32+Math.floor(Math.random()*64)), ts: Date.now() }); count++; if(countEl) countEl.textContent=count; schedule(); }, 2000 + Math.random()*3000);
    }
    btn.addEventListener('click', () => {
        running = !running;
        if (running) {
            btn.textContent = 'STOP_FLOOD'; btn.style.borderColor = 'var(--vivid-magenta)'; btn.style.color = 'var(--vivid-magenta)';
            if (pulse) pulse.style.background = 'var(--vivid-magenta)';
            if (statusEl) statusEl.style.color = 'var(--vivid-magenta)', statusEl.textContent = 'ACTIVE — FLOODING';
            schedule();
        } else {
            clearTimeout(timer); btn.textContent = 'START_FLOOD'; btn.style.borderColor = ''; btn.style.color = '';
            if (pulse) pulse.style.background = '#333';
            if (statusEl) statusEl.style.color = '#555', statusEl.textContent = 'INACTIVE';
        }
    });
})();

// --- MODULE G: AUDIO SPECTRUM ANALYZER ---
(function() {
    const canvas = document.getElementById('spectrum-canvas');
    const statusEl = document.getElementById('spectrum-status');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let audioCtx, analyser, sourceNode, animFrame, boundEl;

    function resize() { canvas.width = canvas.offsetWidth || 300; canvas.height = canvas.offsetHeight || 180; }
    resize(); window.addEventListener('resize', resize);

    function draw() {
        resize();
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(buf);
        const W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        const bw = (W / buf.length) * 2.5;
        let x = 0;
        for (let i = 0; i < buf.length; i++) {
            const bh = (buf[i] / 255) * H;
            const isCovert = document.body.classList.contains('covert-active');
            ctx.fillStyle = isCovert 
                ? `hsl(${320 + (i / buf.length) * 40}, 100%, 55%)` 
                : `hsl(${180 + (i / buf.length) * 160}, 100%, 55%)`;
            ctx.fillRect(x, H - bh, bw, bh);
            x += bw + 1;
        }
        animFrame = requestAnimationFrame(draw);
    }

    function stop() { 
        if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; } 
        boundEl = null; 
        resize(); 
        ctx.clearRect(0, 0, canvas.width, canvas.height); 
        if (statusEl) statusEl.textContent = '> NO_CARRIER_SIGNAL'; 
    }

    function attach(el) {
        if (!audioCtx) {
            audioCtx = getAudioContext();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();

        if (!el._audioSourceNode) {
            try {
                el._audioSourceNode = audioCtx.createMediaElementSource(el);
                el._audioSourceNode.connect(analyser);
            } catch(e) {
                console.error("MediaElementSource creation error:", e);
            }
        }
        
        boundEl = el;
        if (statusEl) statusEl.textContent = '> CARRIER_SIGNAL_ACTIVE';
        if (animFrame) cancelAnimationFrame(animFrame);
        draw();
    }

    function bind(el) {
        if (el._specBound) return; el._specBound = true;
        el.addEventListener('play', () => attach(el));
        el.addEventListener('pause', stop); el.addEventListener('ended', stop);
    }

    const preview = document.getElementById('audio-preview');
    if (preview) bind(preview);
    if (chatFeed) new MutationObserver(() => chatFeed.querySelectorAll('audio').forEach(bind)).observe(chatFeed, { childList: true, subtree: true });
})();

// --- MODULE H: SELF-DESTRUCT TIMER ---
(function() {
    const armBtn = document.getElementById('sdt-arm-btn');
    const abortBtn = document.getElementById('sdt-abort-btn');
    const display = document.getElementById('sdt-display');
    const minInput = document.getElementById('sdt-minutes');
    if (!armBtn) return;
    let timer = null, secs = 0;
    function fmt(s) { return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
    function purge() {
        if (chatFeed) {
            chatFeed.querySelectorAll('.message-wrapper').forEach(el => el.remove());
            const emptyEl = chatFeed.querySelector('.chat-empty');
            if (emptyEl) emptyEl.style.display = '';
        }
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.style.display = 'none';
        if (auditLogEl) auditLogEl.innerHTML = '';
        if (vaultList) vaultList.innerHTML = '';
        const tb = document.getElementById('tx-log-body'); if (tb) tb.innerHTML = '';
        if (display) { display.textContent = '[PURGED]'; display.style.color = '#ff3333'; }
        if (window.showToast) window.showToast('[AUTO_PURGE_COMPLETE] Self-destruct executed.');
        setTimeout(() => { if (display) display.style.display = 'none'; if (minInput) minInput.style.display = ''; if (abortBtn) abortBtn.style.display = 'none'; armBtn.textContent = 'ARM'; armBtn.disabled = false; }, 2000);
    }
    armBtn.addEventListener('click', () => {
        secs = (parseInt(minInput.value) || 5) * 60;
        minInput.style.display = 'none'; display.style.display = 'block'; display.style.color = 'var(--vivid-magenta)';
        abortBtn.style.display = 'inline-block'; armBtn.textContent = 'ARMED'; armBtn.disabled = true;
        timer = setInterval(() => { secs--; display.textContent = fmt(secs); if (secs <= 10) display.style.color = '#ff3333'; if (secs <= 0) { clearInterval(timer); armBtn.disabled = false; purge(); } }, 1000);
    });
    abortBtn.addEventListener('click', () => {
        clearInterval(timer); display.style.display = 'none'; minInput.style.display = ''; abortBtn.style.display = 'none'; armBtn.textContent = 'ARM'; armBtn.disabled = false;
        if (window.showToast) window.showToast('[ABORT] Self-destruct sequence cancelled.');
    });
})();

// --- MODULE I: COVERT PROTOCOL CONTROLLER ---
(function() {
    const covertTrigger = document.getElementById('covert-logo-trigger');
    if (!covertTrigger) return;
    
    covertTrigger.addEventListener('click', () => {
        const isActive = document.body.classList.toggle('covert-active');
        const overlay = document.getElementById('covert-handshake-overlay');
        const payloadSec = document.querySelector('.payload-section');
        const densityCard = document.getElementById('density-card');

        if (overlay) {
            overlay.classList.add('sweep');
            setTimeout(() => {
                overlay.classList.remove('sweep');
            }, 1800);
        }

        const emptyIcon = document.getElementById('chat-empty-icon');
        const emptyText = document.getElementById('chat-empty-text');
        const emptySub = document.getElementById('chat-empty-sub');
        const brandSub = document.getElementById('brand-sub-text');

        if (isActive) {
            if (payloadSec) payloadSec.style.display = 'flex';
            if (densityCard) densityCard.style.display = 'block';
            if (brandSub) brandSub.textContent = 'Hidden Messages · Inside Sound · Encrypted';
            if (covertTrigger) covertTrigger.setAttribute('title', 'Disable Stego Uplink / Return to Normal Mode');
            
            if (emptyIcon) emptyIcon.textContent = '📶';
            if (emptyText) emptyText.innerHTML = '<span style="color:#ff007f;text-shadow:0 0 10px rgba(255,0,127,0.5);">📶 COVERT STEGO PROTOCOL ACTIVE</span>';
            if (emptySub) emptySub.textContent = 'Input secret message, attach audio carrier, and send to hide data.';

            addToAuditLog('STEGO_PROTOCOL_ARMED');
            updateAuditLogs();
            if (window.showToast) window.showToast('📶 SECURE UPLINK INITIATED: COVERT PROTOCOL ACTIVE');
        } else {
            if (payloadSec) payloadSec.style.display = 'none';
            if (densityCard) densityCard.style.display = 'none';
            if (brandSub) brandSub.textContent = 'End-to-End Encrypted Secure Chat';
            if (covertTrigger) covertTrigger.setAttribute('title', 'WhisperNet Logo');

            if (emptyIcon) emptyIcon.textContent = '🔒';
            if (emptyText) emptyText.textContent = 'This conversation is private and encrypted.';
            if (emptySub) emptySub.textContent = 'Send a message to begin.';

            addToAuditLog('STEGO_PROTOCOL_DISARMED');
            updateAuditLogs();
            if (window.showToast) window.showToast('📶 SECURE UPLINK TERMINATED: COVERT PROTOCOL DEACTIVATED');
        }
    });
})();

// --- MODULE J: WHISPER_AI COVERT CONSOLE ASSISTANT ---
(function() {
    const aiFeed = document.getElementById('ai-terminal-feed');
    const aiForm = document.getElementById('ai-terminal-form');
    const aiInput = document.getElementById('ai-terminal-input');
    const chipBtns = document.querySelectorAll('.terminal-chips .chip-btn');

    if (!aiFeed || !aiForm || !aiInput) return;

    // Premium typewriting delayed text print
    function printAI(text, isHTML = false) {
        const msg = document.createElement('div');
        msg.className = 'terminal-msg ai';
        msg.innerHTML = '<div class="ai-header">> WHISPER_AI:</div>';
        
        const contentSpan = document.createElement('span');
        msg.appendChild(contentSpan);
        aiFeed.appendChild(msg);
        aiFeed.scrollTop = aiFeed.scrollHeight;

        let i = 0;
        const speed = 12; // fast typewriting speed in ms

        return new Promise((resolve) => {
            if (isHTML) {
                contentSpan.innerHTML = text;
                aiFeed.scrollTop = aiFeed.scrollHeight;
                resolve();
            } else {
                function type() {
                    if (i < text.length) {
                        contentSpan.textContent += text.charAt(i);
                        i++;
                        aiFeed.scrollTop = aiFeed.scrollHeight;
                        setTimeout(type, speed);
                    } else {
                        resolve();
                    }
                }
                type();
            }
        });
    }

    function printUser(text) {
        const msg = document.createElement('div');
        msg.className = 'terminal-msg user';
        msg.textContent = `> AGENT: ${text}`;
        aiFeed.appendChild(msg);
        aiFeed.scrollTop = aiFeed.scrollHeight;
    }

    // Dynamic State Scanner for Context-Aware Answers
    function getLiveUIContext() {
        const secretText = secretInput ? secretInput.value : '';
        const bitCount = secretText.length * 8;
        
        let carrierSize = 0;
        const carrierEl = document.getElementById('carrier-upload');
        if (carrierEl && carrierEl.files[0]) {
            carrierSize = carrierEl.files[0].size;
        }

        // Live Traffic Mask State
        const noiseStatusText = document.getElementById('noise-status');
        const noiseCountText = document.getElementById('noise-count');
        const isMasking = noiseStatusText && noiseStatusText.textContent.includes('ACTIVE');
        const decoyCount = noiseCountText ? noiseCountText.textContent : '0';

        // Live Vault List State
        const vaultItems = document.querySelectorAll('#vault-list .vault-item');
        const vaultCount = vaultItems ? vaultItems.length : 0;

        return {
            secretText,
            bitCount,
            carrierSize,
            isMasking,
            decoyCount,
            vaultCount
        };
    }

    // Main AI Command & Natural Q&A Processor
    async function processAIQuery(rawQuery) {
        const query = rawQuery.trim().toLowerCase();
        const ctx = getLiveUIContext();

        if (query === '/help') {
            await printAI(
                "WhisperAI Secure Commands:\n" +
                "• /stego    - Explain LSB Steganography & verify active payload bits.\n" +
                "• /density  - View exact capacity metrics of your carrier file.\n" +
                "• /mask     - Audit decoy flood status of the network masking layer.\n" +
                "• /vault    - Analyze carrier audio files stored in your safe vault.\n" +
                "--------------------------------------------------\n" +
                "You can also ask normal questions! Try typing 'How do I hide a message?' or 'Is my traffic secure?'",
                false
            );
        } 
        else if (query === '/stego' || query.includes('stego') || query.includes('steganography')) {
            let response = "SYSTEM UPLINK // LSB STEGANOGRAPHY ENGINE\n" +
                "Least Significant Bit (LSB) Steganography works by substituting the lowest bit of each digital audio sample with secret message bits. Because changing the LSB causes only a tiny wave change, the audio sounds identical to human ears!\n\n" +
                "LIVE CONTEXT SCANNER:\n";
            
            if (ctx.bitCount > 0) {
                response += `> Currently configured secret payload size is: ${ctx.bitCount} bits (${ctx.secretText.length} characters).\n`;
            } else {
                response += `> Currently configured secret payload: NONE (Type a message in 'Secret Message' first).\n`;
            }

            if (ctx.carrierSize > 0) {
                response += `> Current audio carrier is loaded: YES (${ctx.carrierSize} bytes). You are fully prepared to hide data!`;
            } else {
                response += `> Current audio carrier is loaded: NO (Please click 'Attach Audio' or 'Record Voice' in the composer to bind a carrier!).`;
            }
            await printAI(response);
        }
        else if (query === '/density' || query.includes('density') || query.includes('capacity') || query.includes('payload')) {
            let response = "SYSTEM UPLINK // PAYLOAD DENSITY METRICS\n" +
                "Message Density is calculated as the ratio of secret bits to carrier bytes. High density (>50%) changes too many LSBs and could degrade audio sound quality, increasing detection risks.\n\n" +
                "LIVE CONTEXT SCANNER:\n" +
                `• Secret payload: ${ctx.bitCount} bits\n` +
                `• Audio carrier: ${ctx.carrierSize} bytes\n`;

            if (ctx.carrierSize > 0) {
                const density = ((ctx.bitCount / ctx.carrierSize) * 100).toFixed(2);
                response += `> Computed stego density: ${density}%\n`;
                if (density > 50) {
                    response += "⚠️ WARNING: Stego density is extremely high! Audio degradation possible. Shorten message or use a larger audio carrier.";
                } else {
                    response += "💡 SAFE RATIO: Payload is highly covert and completely imperceptible.";
                }
            } else {
                response += "> Stego density: 0.0%\n💡 Please choose a carrier audio file and type your secret message to calculate real-time density.";
            }
            await printAI(response);
        }
        else if (query === '/mask' || query.includes('mask') || query.includes('traffic') || query.includes('decoy') || query.includes('noise')) {
            let response = "SYSTEM UPLINK // TRAFFIC MASKING LAYER\n" +
                "To prevent an eavesdropper from doing timing attacks, the Traffic Mask continuously floods the WebSocket pipe with random decoy packets every 2-5 seconds, burying real messages in background noise.\n\n" +
                "LIVE CONTEXT SCANNER:\n";

            if (ctx.isMasking) {
                response += `⚡ STATUS: ACTIVE - FLOODING CONDUIT\n` +
                    `> Decoy packets sent in this session: ${ctx.decoyCount}\n` +
                    `> Covert protection level: MAXIMUM (Traffic patterns are fully masked).`;
            } else {
                response += `💤 STATUS: INACTIVE\n` +
                    `> Decoy packets sent: 0\n` +
                    `> Covert protection level: NORMAL\n` +
                    `💡 Action: Click the 'Start Masking' button in the 'Traffic Mask' bottom panel to begin flooding decoys.`;
            }
            await printAI(response);
        }
        else if (query === '/vault' || query.includes('vault') || query.includes('file') || query.includes('download')) {
            let response = "SYSTEM UPLINK // FILE VAULT REGISTRY\n" +
                "The File Vault holds clean download anchors for all stego-encoded audio files exchanged during this session. This separates secure carrier wavs from standard chat assets.\n\n" +
                "LIVE CONTEXT SCANNER:\n";

            if (ctx.vaultCount > 0) {
                response += `> Files in vault: ${ctx.vaultCount}\n` +
                    `> Active Safe Storage: YES\n` +
                    `💡 You can download and save these files safely. Use the DECRYPT_PAYLOAD button in the chat box to read their hidden content at any time.`;
            } else {
                response += `> Files in vault: 0\n` +
                    `> Active Safe Storage: EMPTY\n` +
                    `💡 Stego carrier files will automatically register here as soon as you send or receive an audio packet containing a secret payload.`;
            }
            await printAI(response);
        }
        else if (query.includes('hi') || query.includes('hello') || query.includes('hey') || query.includes('help')) {
            await printAI(
                "Greetings, Agent. I am the WhisperAI Secure Companion.\n" +
                "I scan your live interface context to guide you through LSB steganography and traffic security. Type /help to see all commands!"
            );
        }
        else if (query.includes('hide') || query.includes('send') || query.includes('embed') || query.includes('how to')) {
            await printAI(
                "STEP-BY-STEP: HOW TO HIDE A SECRET MESSAGE\n" +
                "1. Type your confidential message inside the 'Secret Message' input.\n" +
                "2. (Optional) Provide a passcode in the 'Password / Key' field to encrypt the payload with AES.\n" +
                "3. Attach a carrier audio file by clicking 'Attach Audio' or click 'Record Voice' to record your microphone.\n" +
                "4. Type a normal cover text in the main composer box (e.g., 'Check this out!') and click Send.\n" +
                "The stego engine will automatically blend the secret bits into the audio carrier and transmit it safely!"
            );
        }
        else if (query.includes('decrypt') || query.includes('extract') || query.includes('decode') || query.includes('read')) {
            await printAI(
                "STEP-BY-STEP: HOW TO EXTRACT A HIDDEN PAYLOAD\n" +
                "1. Look at the chat feed for messages containing an audio player labeled 'ENCRYPTED_DATA_PACKET'.\n" +
                "2. Click the 'DECRYPT_PAYLOAD' button attached to the card.\n" +
                "3. If a passcode was set, you will be prompted to enter it. Otherwise, decryption happens instantly!\n" +
                "The engine will fetch the audio bytes, scan the least significant bits, and reveal the secret payload."
            );
        }
        else if (query.includes('key') || query.includes('password') || query.includes('aes') || query.includes('lock')) {
            await printAI(
                "SECURITY ADVISORY // PAYLOAD LOCKS:\n" +
                "Stego keys add a second layer of defense. Even if someone discovers stego-encoding in your audio file, they cannot parse the characters without the correct AES key. The password field is located inside the stego composer panel."
            );
        }
        else if (query.includes('clear') || query.includes('purge') || query.includes('timer') || query.includes('destruct')) {
            await printAI(
                "DECONSTRUCTION UTILITIES // SELF DESTRUCT:\n" +
                "• Auto Delete: Click 'Arm' in the sidebar to trigger a localized interface purge when the timer runs out.\n" +
                "• Shred Everything: Click 'Clear Everything' to immediately wipe the chat feed, transaction database, and session history from this machine."
            );
        }
        else {
            // Smart cyberpunk helper fallback
            await printAI(
                `Unrecognized command/keyword: "${rawQuery}"\n` +
                "Agent, I can answer questions regarding:\n" +
                "• Steganography (LSB, bits, audio files)\n" +
                "• Density ratios (bits vs carrier bytes)\n" +
                "• Traffic masking (decoys, timings)\n" +
                "• Keys and decoding hidden payloads.\n\n" +
                "Type /help to inspect the available Secure Commands roster."
            );
        }
    }

    // Form submit listener
    aiForm.onsubmit = async (e) => {
        e.preventDefault();
        const text = aiInput.value.trim();
        if (!text) return;

        aiInput.value = '';
        printUser(text);
        
        // Brief cyber processing delay
        await new Promise(resolve => setTimeout(resolve, 300));
        await processAIQuery(text);
    };

    // Chip-click listener
    chipBtns.forEach(btn => {
        btn.onclick = async () => {
            const cmd = btn.getAttribute('data-cmd');
            printUser(cmd);
            await new Promise(resolve => setTimeout(resolve, 300));
            await processAIQuery(cmd);
        };
    });

    // Boot-up message
    setTimeout(async () => {
        await printAI(
            "==========================================\n" +
            "🔒 SYSTEM UPLINK SECURE // WHISPER_AI ONLINE\n" +
            "WhisperAI Terminal Client v1.0.4 Loaded Successfully.\n" +
            "==========================================\n" +
            "Ready to assist you with secure steganography and traffic masking.\n" +
            "Click a command chip or type /help to begin."
        );
    }, 1000);
})();
