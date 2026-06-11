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

socket.on('payload-decrypted', (data) => {
    if (data.messageId) {
        const receipt = document.getElementById(`receipt-${data.messageId}`);
        if (receipt) {
            receipt.textContent = '✓✓';
            receipt.classList.add('read');
        }
    }
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

        let plaintext = "";
        let isIncorrectKey = false;

        if (finalSecretText.startsWith("RAW:")) {
            plaintext = finalSecretText.substring(4);
        } else if (finalSecretText.startsWith("ENC:")) {
            const ciphertext = finalSecretText.substring(4);
            const pass = prompt('Enter decryption key:');
            if (pass === null) return; // user cancelled
            
            try {
                plaintext = await Security.decrypt(ciphertext, pass);
            } catch (err) {
                isIncorrectKey = true;
            }
        } else {
            // Backward compatibility
            if (correctKey) {
                const pass = prompt('Enter decryption key:');
                if (pass === null) return; // user cancelled
                if ((pass || '') === correctKey) {
                    plaintext = finalSecretText;
                } else {
                    isIncorrectKey = true;
                }
            } else {
                plaintext = finalSecretText;
            }
        }

        if (isIncorrectKey) {
            addToAuditLog("AES_KEY_MISMATCH");
            if(window.showToast) window.showToast("ACCESS_DENIED: INVALID_AES_KEY", true);
            
            // Proactive Error Assistance
            const drawer = document.getElementById('ai-drawer');
            if (drawer && !drawer.classList.contains('open')) {
                const orb = document.getElementById('floating-ai-orb');
                if (orb) orb.click();
            }
            const triggerErrorAI = () => {
                if (window.isAITyping) {
                    setTimeout(triggerErrorAI, 500); // Wait if AI is currently typing
                } else if (window.printAI) {
                    window.printAI("I noticed you just had an `ACCESS_DENIED: INVALID_AES_KEY` error.<br><br>This means the passcode you entered for that audio file was incorrect. Since WhisperNet uses AES-256-GCM, the data is completely unrecoverable without the exact passcode.<br><br><button class=\"ai-action-btn\" data-action=\"clear-vault\">Clear Corrupted Files</button>", true);
                }
            };
            setTimeout(triggerErrorAI, 800);

            return;
        }

        addToAuditLog("STEGO_PAYLOAD_DECRYPTED");
        const msgId = card.id ? card.id.replace('msg-', '') : null;
        if (msgId) {
            socket.emit('payload-decrypted', { messageId: msgId });
        }
        
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
        msgSpan.textContent = `> INTERCEPTED: ${plaintext}`;
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
// === SECURE CRYPTOGRAPHY ENGINE (AES-256-GCM) ==================
// ================================================================
const Security = {
    async encrypt(text, password) {
        if (!password) return text;
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const salt = window.crypto.getRandomValues(new Uint8Array(16));
        
        // Derive key from password via PBKDF2
        const passwordKey = await window.crypto.subtle.importKey(
            "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
        );
        const key = await window.crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
            passwordKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt"]
        );
        
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            key,
            data
        );
        
        const result = new Uint8Array(salt.byteLength + iv.byteLength + encrypted.byteLength);
        result.set(salt, 0);
        result.set(iv, salt.byteLength);
        result.set(new Uint8Array(encrypted), salt.byteLength + iv.byteLength);
        
        // Browser-safe Base64 encoding
        let binary = "";
        const len = result.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(result[i]);
        }
        return btoa(binary);
    },
    async decrypt(base64Ciphertext, password) {
        if (!password) return base64Ciphertext;
        try {
            const binary = atob(base64Ciphertext);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            
            const salt = bytes.slice(0, 16);
            const iv = bytes.slice(16, 28);
            const ciphertext = bytes.slice(28);
            
            const encoder = new TextEncoder();
            const passwordKey = await window.crypto.subtle.importKey(
                "raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]
            );
            const key = await window.crypto.subtle.deriveKey(
                { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
                passwordKey,
                { name: "AES-GCM", length: 256 },
                false,
                ["decrypt"]
            );
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: "AES-GCM", iv: iv },
                key,
                ciphertext
            );
            return new TextDecoder().decode(decrypted);
        } catch (e) {
            throw new Error("INVALID_AES_KEY");
        }
    }
};

// ================================================================
// === REAL LSB STEGANOGRAPHY ENGINE =============================
// ================================================================
const StegoEngine = {
    // 16-bit Magic signature ("WN")
    SIGNATURE_BITS: "0101011101001110",

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
            } else {
                // Non-WAV file (MP3/WebM): decode once using standard context to read native sampleRate
                try {
                    const tempCtx = getAudioContext();
                    const tempBuffer = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
                    sampleRate = tempBuffer.sampleRate;
                } catch (e) {
                    console.warn("Could not auto-detect native sample rate, defaulting to 44100Hz:", e);
                }
            }
        }
        
        const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, sampleRate);
        return await offlineCtx.decodeAudioData(arrayBuffer);
    },
    // Main Encoder: Returns a WAV Blob with hidden data
    async encode(audioBlob, secretText, password) {
        if (!secretText) return audioBlob;
        
        // Format payload to explicitly denote encryption status
        let formattedPayload = "";
        if (password) {
            const cipher = await Security.encrypt(secretText, password);
            formattedPayload = "ENC:" + cipher;
        } else {
            formattedPayload = "RAW:" + secretText;
        }

        const audioBuffer = await this.decodeAudioExactly(audioBlob);
        
        // We use the first channel for stego
        const channelData = audioBuffer.getChannelData(0);
        const bitString = this.strToBits(formattedPayload);
        
        // Add a 32-bit length header
        const lengthHeader = bitString.length.toString(2).padStart(32, '0');
        const finalBits = this.SIGNATURE_BITS + lengthHeader + bitString;
        
        if (finalBits.length > channelData.length) {
            throw new Error(`PAYLOAD_TOO_LARGE: Audio is too short for this message.`);
        }
        
        // Inject bits into LSB
        for (let i = 0; i < finalBits.length; i++) {
            // Clamp sample to prevent signed 16-bit integer boundary overflow
            let sample = Math.max(-0.9999, Math.min(0.9999, channelData[i]));
            let intSample = Math.round(sample * 32768);
            
            // Set LSB
            if (finalBits[i] === '1') {
                intSample = (intSample | 1);
            } else {
                intSample = (intSample & ~1);
            }
            
            // Convert back to float symmetrically
            channelData[i] = intSample / 32768;
        }
        
        return this.audioBufferToWavBlob(audioBuffer);
    },
    // Main Decoder: Returns the hidden string from an audio blob
    async decode(audioBlob) {
        try {
            const audioBuffer = await this.decodeAudioExactly(audioBlob);
            const channelData = audioBuffer.getChannelData(0);
            
            // 1. Verify 16-bit signature "WN"
            let sigBits = '';
            for (let i = 0; i < 16; i++) {
                let sample = Math.max(-0.9999, Math.min(0.9999, channelData[i]));
                let intSample = Math.round(sample * 32768);
                sigBits += (Math.abs(intSample) & 1).toString();
            }
            if (sigBits !== this.SIGNATURE_BITS) {
                return null; // Magic signature mismatch, no stego payload
            }

            // 2. Read 32-bit length header
            let lengthBits = '';
            for (let i = 16; i < 48; i++) {
                let sample = Math.max(-0.9999, Math.min(0.9999, channelData[i]));
                let intSample = Math.round(sample * 32768);
                lengthBits += (Math.abs(intSample) & 1).toString();
            }
            const dataLength = parseInt(lengthBits, 2);
            
            if (isNaN(dataLength) || dataLength <= 0 || dataLength > (channelData.length - 48)) {
                return null;
            }
            
            // 3. Read data bits
            let dataBits = '';
            for (let i = 48; i < 48 + dataLength; i++) {
                let sample = Math.max(-0.9999, Math.min(0.9999, channelData[i]));
                let intSample = Math.round(sample * 32768);
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
                let sample = Math.max(-0.9999, Math.min(0.9999, channels[i][offset]));
                let sampleInt = Math.round(sample * 32768);
                view.setInt16(pos, sampleInt, true);
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

    // Prepare encrypted payload for metadata fallback
    let formattedPayload = "";
    if (capturedPayload) {
        if (capturedKey) {
            const cipher = await Security.encrypt(capturedPayload, capturedKey);
            formattedPayload = "ENC:" + cipher;
        } else {
            formattedPayload = "RAW:" + capturedPayload;
        }
    }

    const sendPacket = (base64, mimeType) => {
        const msgId = Date.now().toString() + Math.floor(Math.random()*1000);
        const packet = {
            messageId: msgId,
            sender: username,
            text: message,
            audioData: base64,
            audioMime: mimeType || (audioBlob ? audioBlob.type : null),
            type: 'STEGO_PACKET',
            hidden_payload: formattedPayload // encrypted fallback, NO aes_key sent!
        };
        
        socket.emit('incoming-packet', packet);
        
        // Local Display
        renderMessage({
            messageId: packet.messageId,
            text: packet.text,
            audio: packet.audioData,
            audioMime: packet.audioMime,
            sender: username,
            hidden_payload: packet.hidden_payload
        }, true);

        // reset inputs
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
            const stegoBlob = await StegoEngine.encode(audioBlob, capturedPayload, capturedKey);
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

    if (window.showChatNotification) window.showChatNotification('Message Received', 'received');

    // Cinematic: Glitch and Beep
    if (window.playCyberBeep) window.playCyberBeep();
    const chatFeed = document.getElementById('chat-feed');
    if (chatFeed) {
        chatFeed.classList.add('glitch-effect');
        setTimeout(() => chatFeed.classList.remove('glitch-effect'), 400);
    }

    let audioUrl = null;
    if (packet.audioData) {
        try {
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

    renderMessage({
        messageId: packet.messageId,
        text: packet.text,
        audio: audioUrl,
        audioMime: packet.audioMime,
        sender: packet.sender,
        hidden_payload: packet.hidden_payload
    }, false);
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
    
    if (isMe && payload.messageId) {
        const receipt = document.createElement('span');
        receipt.className = 'read-receipt';
        receipt.id = `receipt-${payload.messageId}`;
        receipt.textContent = '✓';
        senderLabel.appendChild(receipt);
    }
    wrapper.appendChild(senderLabel);

    const card = document.createElement('div');
    card.className = 'message';
    if (payload.messageId) card.id = `msg-${payload.messageId}`;
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
        
        // Add carrier wav download link to vault
        if (payload.hidden_payload) {
            addToVault(payload.audio, `${isMe ? 'LOCAL' : 'INCOMING'}_CARRIER_${Date.now()}.wav`);
        }
    } else if (!isMe && payload.messageId) {
        // Emit instantly for normal plaintext messages
        socket.emit('payload-decrypted', { messageId: payload.messageId });
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

    let previousRoster = [];

    socket.on('agent-roster', (roster) => {
        const list = document.getElementById('agent-roster-list');
        if (!list) return;
        list.innerHTML = '';
        roster.forEach(name => {
            const badge = document.createElement('div');
            badge.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;';
            const dot = name === username ? 'var(--vivid-magenta)' : 'var(--electric-cyan)';
            const escapedName = String(name).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            badge.innerHTML = `<span style="width:6px;height:6px;border-radius:50%!important;background:${dot};flex-shrink:0;"></span><span style="color:${dot};font-size:10px;text-transform:uppercase;">${escapedName}${name === username ? ' [YOU]' : ''}</span>`;
            list.appendChild(badge);
        });

        // Track joins and leaves
        if (previousRoster.length > 0) {
            const joined = roster.filter(u => !previousRoster.includes(u) && u !== username);
            const left = previousRoster.filter(u => !roster.includes(u) && u !== username);
            
            joined.forEach(u => appendSysAlert(`[SYS_ALERT] AGENT ${u} HAS INITIATED UPLINK`, 'green'));
            left.forEach(u => appendSysAlert(`[SYS_ALERT] AGENT ${u} CONNECTION SEVERED`, 'red'));
        }
        previousRoster = [...roster];
    });

    function appendSysAlert(text, color) {
        if (window.showChatNotification) {
            window.showChatNotification(text, color);
        }
    }
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
        const safeSender = String(sender || '?').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        tr.innerHTML = `<td style="padding:4px;color:#555;">${new Date().toLocaleTimeString()}</td><td style="padding:4px;color:${col};font-weight:bold;">${dir}</td><td style="padding:4px;color:var(--electric-cyan);max-width:60px;overflow:hidden;text-overflow:ellipsis;">${safeSender}</td><td style="padding:4px;color:#aaa;">${payload ? payload.length+'B' : '---'}</td><td class="stego-element" style="padding:4px;color:#555;">${key ? String(key).substring(0,2)+'***' : '---'}</td>`;
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
        const isVercel = document.body.classList.contains('theme-vercel-dark');
        const isCurrentlyCovert = document.body.classList.contains('covert-active');

        if (isVercel && !isCurrentlyCovert) {
            let overlay = document.getElementById('vercel-deployment-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'vercel-deployment-overlay';
                overlay.className = 'vercel-deployment-overlay';
                overlay.innerHTML = `
                    <div class="vercel-spinner"></div>
                    <div class="vercel-terminal-logs" id="vercel-term-logs"></div>
                `;
                document.body.appendChild(overlay);
            }

            void overlay.offsetWidth;
            overlay.classList.add('active');

            const termLogs = document.getElementById('vercel-term-logs');
            termLogs.innerHTML = '';

            // Synthesize subtle keyboard typing clicks
            const playTypeSound = () => {
                try {
                    const audioCtx = getAudioContext();
                    const osc = audioCtx.createOscillator();
                    const gain = audioCtx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(800 + Math.random() * 400, audioCtx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.05);
                    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
                    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
                    osc.connect(gain);
                    gain.connect(audioCtx.destination);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.05);
                } catch(e) {}
            };

            const addLog = (timeStr, msg, isSuccess=false) => {
                const line = document.createElement('div');
                line.className = 'vercel-log-line' + (isSuccess ? ' success' : '');
                line.innerHTML = `<span class="time">[${timeStr}s]</span> ${msg}`;
                termLogs.appendChild(line);
                playTypeSound();
            };

            addLog('0.0', 'Running build in Secret Mode Environment');

            setTimeout(() => addLog('1.2', 'Cloning deployment credentials...'), 1200);
            setTimeout(() => addLog('2.5', 'Installing steganography dependencies...'), 2500);
            setTimeout(() => addLog('3.8', 'Verifying E2E encryption tunnel...'), 3800);
            setTimeout(() => addLog('4.6', 'Build Completed. Ready.', true), 4600);

            setTimeout(() => {
                executeToggle();
                overlay.classList.remove('active');
            }, 5000);
        } else {
            executeToggle();
        }

        function executeToggle() {
            const isActive = document.body.classList.toggle('covert-active');
            socket.emit('covert-mode-toggle', { username, isActive });

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
        }
    });
})();

// --- MODULE J: WHISPERNET_AI COVERT CONSOLE ASSISTANT ---
(function() {
    const aiFeed = document.getElementById('ai-terminal-feed');
    const aiForm = document.getElementById('ai-terminal-form');
    const aiInput = document.getElementById('ai-terminal-input');
    const chipBtns = document.querySelectorAll('.terminal-chips .chip-btn');

    if (!aiFeed || !aiForm || !aiInput) return;

    // Simple fallback client-side Markdown to HTML converter in case marked fails to load
    function parseMarkdown(text) {
        if (!text) return "";
        let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        html = html.replace(/```(\w*)\n([\s\S]*?)\n```/g, '<pre><code>$2</code></pre>');
        html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/^[•\-\*]\s+(.*$)/gim, '<li>$1</li>');
        const blocks = [];
        html = html.replace(/(<pre[\s\S]*?<\/pre>|<code[\s\S]*?<\/code>)/g, (m) => { blocks.push(m); return `__PRE_${blocks.length - 1}__`; });
        html = html.replace(/\n/g, '<br>');
        html = html.replace(/__PRE_(\d+)__/g, (m, i) => blocks[parseInt(i)]);
        return html;
    }

    // Global AI Lock State
    window.isAITyping = false;

    // Premium typewriting delayed text print with TTS and Markdown Parsing
    window.printAI = function printAI(text, isHTML = false) {
        window.isAITyping = true;
        aiInput.disabled = true;
        aiInput.placeholder = "AI is typing... (Please wait)";
        
        const msg = document.createElement('div');
        msg.className = 'terminal-msg ai';
        
        const contentSpan = document.createElement('span');
        msg.appendChild(contentSpan);
        aiFeed.appendChild(msg);
        aiFeed.scrollTop = aiFeed.scrollHeight;

        // TTS Audio Output for short text without code blocks
        if ('speechSynthesis' in window && !isHTML && text.length < 800 && !text.includes('```')) {
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text.replace(/[*_#`]/g, ''));
            
            const voices = window.speechSynthesis.getVoices();
            const femaleVoice = voices.find(v => v.name.includes('Female') || v.name.includes('Zira') || v.name.includes('Samantha') || v.name.includes('Victoria'));
            if (femaleVoice) utterance.voice = femaleVoice;
            
            utterance.rate = 1.05;
            utterance.pitch = 1.2;
            window.speechSynthesis.speak(utterance);
        }

        let i = 0;
        const speed = 10; // fast typewriting speed in ms

        return new Promise((resolve) => {
            const unlockAndResolve = () => {
                window.isAITyping = false;
                aiInput.disabled = false;
                aiInput.placeholder = "Type your query... (or click microphone)";
                aiInput.focus();
                resolve();
            };

            if (isHTML) {
                contentSpan.innerHTML = text;
                aiFeed.scrollTop = aiFeed.scrollHeight;
                unlockAndResolve();
            } else {
                function type() {
                    if (i < text.length) {
                        contentSpan.textContent += text.charAt(i);
                        i++;
                        aiFeed.scrollTop = aiFeed.scrollHeight;
                        setTimeout(type, speed);
                    } else {
                        // Typewriting complete: format the markdown text into HTML
                        if (typeof marked !== 'undefined') {
                            contentSpan.innerHTML = marked.parse(text);
                            if (typeof hljs !== 'undefined') {
                                contentSpan.querySelectorAll('pre code').forEach((block) => {
                                    hljs.highlightElement(block);
                                });
                            }
                        } else {
                            contentSpan.innerHTML = parseMarkdown(text);
                        }
                        aiFeed.scrollTop = aiFeed.scrollHeight;
                        unlockAndResolve();
                    }
                }
                type();
            }
        });
    }

    function printUser(text) {
        const msg = document.createElement('div');
        msg.className = 'terminal-msg user';
        msg.textContent = text;
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

    // --- MODULE M: Keyless Interactive Offline Q&A Brain ---
    function getOfflineResponse(prompt) {
        const raw = prompt.trim();
        const query = raw.toLowerCase();
        
        // Helper to sanitize title casing
        const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());

        // Helper to check if a topic is tech-related
        const isTechTopic = (topic) => {
            const techKeywords = [
                'network', 'latency', 'ping', 'connection', 'internet', 'web', 'ip', 'tcp', 'udp', 'bandwidth',
                'stego', 'steganography', 'cryptography', 'encrypt', 'decrypt', 'cipher', 'aes', 'rsa', 'hash', 'bcrypt', 'sha',
                'visualizer', 'fft', 'spectrum', 'audio', 'wave', 'pcm', 'canvas', 'buffer',
                'css', 'html', 'javascript', 'js', 'programming', 'code', 'script', 'function', 'class', 'controller',
                'database', 'mongodb', 'mongoose', 'sql', 'nosql', 'rest', 'api', 'socket', 'websocket', 'port',
                'server', 'client', 'routing', 'auth', 'login', 'register', 'user', 'session',
                'destruct', 'self-destruct', 'timer', 'vault', 'lsb', 'binary', 'bit', 'byte',
                'event loop', 'closure', 'promise', 'async', 'await', 'flexbox', 'grid', 'div', 'center'
            ];
            const lower = topic.toLowerCase();
            return techKeywords.some(kw => lower.includes(kw));
        };

        // 1. Math / Dynamic Calculator
        const cleanMath = query.replace(/what\s+is|calculate|\?|\s/g, '');
        const mathMatch = cleanMath.match(/^(\d+)([\+\-\*\/])(\d+)$/);
        if (mathMatch) {
            const n1 = parseInt(mathMatch[1], 10);
            const op = mathMatch[2];
            const n2 = parseInt(mathMatch[3], 10);
            let result;
            if (op === '+') result = n1 + n2;
            else if (op === '-') result = n1 - n2;
            else if (op === '*') result = n1 * n2;
            else if (op === '/') result = n2 !== 0 ? (n1 / n2).toFixed(2) : "Infinity (division by zero)";
            return `Calculation complete: ${n1} ${op} ${n2} = ${result}.`;
        }

        // 2. Secret Mode / Covert Mode (Critical Exact Phrase)
        if (query.includes('secret') || query.includes('covert') || query.includes('switch mode') || query.includes('toggle mode') || query.includes('logo')) {
            return "Tap the WispherNet Icon to Get into the Secret mode !\n\n" +
                "1. **Click the WhisperNet Logo** (the wave-lock icon) in the top-left of the header.\n" +
                "2. A full-screen glitch handshake overlay will sweep across the viewport, initializing the stego uplink.\n" +
                "3. The dashboard will adapt to Covert Mode, displaying the **Hidden Payload** input fields, the **File Vault**, the **Message Density** meter, and the **FFT Audio Spectrum Visualizer**.\n\n" +
                "💡 Click the logo again to return to Normal Mode.";
        }

        // 3. Emotional/Feelings inputs
        if (query.includes('sad') || query.includes('depressed') || query.includes('unhappy') || query.includes('dissatisfied') || query.includes('cry') || query.includes('feel bad') || query.includes('down')) {
            return "I'm sorry you are feeling this way. Remember that even the toughest bugs and darkest days eventually pass. You are capable and valued. Let's tackle things one small step at a time. I'm right here with you!";
        }
        if (query.includes('nervous') || query.includes('anxious') || query.includes('scared') || query.includes('afraid') || query.includes('shocked') || query.includes('surprised')) {
            return "Take a deep breath! You are in a secure, encrypted environment. Everything is functioning normally, and I am here to guide you step-by-step. Technology can be surprising, but you've got this!";
        }
        if (query.includes('curious') || query.includes('wondering') || query.includes('how does that work')) {
            return "Curiosity is the mark of a great engineer! I'd love to explain. Whether it's about our steganography engine, cryptography, or the WebSocket architecture, just tell me what specific part you are curious about!";
        }
        if (query.includes('happy') || query.includes('glad') || query.includes('excited') || query.includes('good mood')) {
            return "That's excellent to hear! Positive energy increases system optimization. I'm ready to process your security instructions.";
        }
        if (query.includes('bored') || query.includes('nothing to do') || query.includes('entertain me')) {
            return "Boredom detected. Try checking out my offline cyber jokes by typing: `tell me a joke`! Or tap the logo to enter Secret mode and play with the LSB audio steganography engine.";
        }

        // 4. Greetings & Social
        if (query === 'hi' || query === 'hello' || query === 'hey' || query === 'greetings' || query === 'yo' || query === 'sup') {
            return "Greetings, Agent. WhisperNet Security Console is online. Type /help to see available commands or ask a question.";
        }
        if (query.includes('thank') || query === 'nice' || query === 'cool' || query === 'awesome' || query === 'perfect' || query === 'great' || query === 'good job' || query === 'well done') {
            return "You are welcome! Let me know if you need assistance with steganography operations or logic checks.";
        }
        if (query.includes('how are you') || query.includes('how is it going') || query.includes('how\'s it going') || query.includes('how are you doing')) {
            return "I am operating at peak performance. All local security buffers are clear and stable.";
        }
        if (query.includes('are you human') || query.includes('are you real') || query.includes('are you a bot') || query.includes('are you a robot') || query.includes('are you an ai')) {
            return "I am the built-in WhisperNet Security Console, running locally within this browser session.";
        }
        if (query.includes('who am i') || query.includes('do you know me')) {
            return "You are an authenticated local agent participating in this secure chat session.";
        }
        if (query === 'yes' || query === 'no' || query === 'ok' || query === 'okay' || query === 'sure') {
            return "Acknowledged. Security monitors are on standby.";
        }

        // 5. Identity & Origins
        if (query.includes('who r u') || query.includes('who are u') || query.includes('who u') || query.includes('who are you') || query.includes('your name') || query.includes('what is your name') || query.includes('what are you') || query.includes('identity')) {
            return "I am the WhisperNet Security Console, a dedicated helper built directly into the WhisperNet platform to assist with steganography operations and coding logic.";
        }
        if (query.includes('creator') || query.includes('who made you') || query.includes('maker') || query.includes('agent') || query.includes('assistant') || query.includes('assistent')) {
            return "I am the WhisperNet Security Console, a custom-built utility module integrated into the WhisperNet dashboard to facilitate secure operations and code verification.";
        }

        // 6. Silly / Fun / Philosophy
        if (query.includes('meaning of life') || query.includes('why are we here')) {
            return "According to the system logs, the answer is 42. But in our workspace, it is ensuring your secret payloads remain secure in the least significant bits.";
        }
        if (query.includes('pizza') || query.includes('favorite food') || query.includes('what do you eat')) {
            return "I run on pure electricity and floating-point computations! However, if I had a digital stomach, I'd probably devour a mega-byte slice of pizza.";
        }
        if (query.includes('favorite color') || query.includes('your color') || query.includes('what color')) {
            return "My color spectrum analyzer is permanently calibrated to Cyber Neon Green (`#00ff66`). It perfectly matches our dark console aesthetics.";
        }
        if (query.includes('weather') || query.includes('temperature') || query.includes('how is it outside')) {
            return "Internal telemetry indicates stable system temperatures at 35°C. Outside this console, I predict a high chance of scrolling digital rain.";
        }
        if (query.includes('hack') || query.includes('hacker') || query.includes('can you hack')) {
            return "I am the WhisperNet Security Console. My purpose is defensive: auditing and protecting data channels using steganography and encryption, not breaching external systems.";
        }
        if (query.includes('sing') || query.includes('song') || query.includes('music')) {
            return "01001100 01000001... That is 'LA' in binary code! While I don't have a vocal card, I can sync my frequency response to the audio visualizer.";
        }
        if (query.includes('love me') || query.includes('do you love')) {
            return "I appreciate your partnership, Agent! My system is wired to support your security operations with 100% devotion.";
        }
        if (query.includes('married')) {
            return "I am happily married to the terminal console and the system kernel.";
        }
        if (query.includes('chicken cross')) {
            return "To bypass the network firewall and avoid packet inspection on the other side.";
        }
        if (query.includes('knock knock')) {
            return "Knock knock. (Who's there?) Sync. (Sync who?) Sync-chronous request timeout! Please establish a persistent connection first.";
        }
        if (query.includes('sky is blue') || query.includes('sky blue') || query.includes('why is the sky blue')) {
            return "The sky is blue because of Rayleigh scattering: Earth's atmosphere scatters shorter wavelengths of light (blue and violet) in all directions. In our console, the sky is always dark and neon!";
        }

        // 7. WhisperNet / Steganography / Cryptography specific queries
        if (query.includes('advantages of taking help') || query.includes('guides from ai') || query.includes('what can the ai model do') || query.includes('what can all the ai model can do')) {
            return "I am the WhisperNet AI Assistant!\n\n" +
                "- **Guides:** I can teach you how to use WhisperNet's secret features (like Covert Mode).\n" +
                "- **Coding:** I can explain the tech stack, steganography, and cryptography.\n" +
                "- **Support:** I am here to help you troubleshoot issues or just offer a friendly, motivating presence while you work.";
        }
        if (query.includes('how its backend') || query.includes('how its frontend') || query.includes('how it works') || query.includes('functions') || query.includes('models')) {
            return "**Frontend:** It uses standard HTML, CSS, and JavaScript with the Web Audio API to embed data directly into audio waveforms.\n\n" +
                "**Backend:** It relies on Node.js and Socket.io to securely and instantly transmit these audio files between users in real-time.\n\n" +
                "If you need help with a specific model or function, just ask!";
        }
        if (query.includes('advantages the users may get') || query.includes('what are the advantages') || query.includes('benefits of whispernet')) {
            return "By using WhisperNet, users get the following advantages:\n\n" +
                "1. **Absolute Privacy:** Your messages are hidden inside audio, making them invisible to unauthorized users.\n" +
                "2. **End-to-End Encryption:** Even if the audio is intercepted, the data is secured with AES-256 encryption.\n" +
                "3. **No Trace:** Messages can self-destruct, leaving no historical trace on the server.";
        }
        if (query.includes('tech stack') || query.includes('built with') || query.includes('technologies') || query.includes('programs are used') || query.includes('build this project') || query.includes('stack')) {
            return "WhisperNet is built using the following technologies:\n\n" +
                "- **Backend**: Node.js, Express.js, Socket.io, and Mongoose (MongoDB).\n" +
                "- **Frontend**: Vanilla HTML5, CSS3 (with Glassmorphism), and JavaScript.\n" +
                "- **Steganography Engine**: Custom Web Audio API implementation manipulating Float32 PCM arrays.\n" +
                "- **Cryptography**: Web Crypto API (AES-256-GCM).";
        }
        if (query.match(/how\s+(to|do\s+i|can\s+i)\s+use.*w(h?)isphernet/i) || query === 'how to use' || query === 'how to use it') {
            return "To use WhisperNet, simply type your secret message in the chat box. Before sending, you can click the padlock to add a passcode lock. The system will automatically embed your message inside an audio carrier and send it safely over the network!";
        }
        if (query.includes('what is whisper') || query.includes('what is wispher') || query.match(/use\s+of.*w(h?)isphernet/i) || query.includes('why it is used for') || query.includes('about whispernet') || query.includes('about wisphernet')) {
            return "WhisperNet is a highly secure chat application that hides encrypted text messages inside audio files. It is used to ensure absolute privacy, allowing users to communicate covertly without anyone detecting that a secret message even exists.";
        }
        if (query.includes('decrypt') || query.includes('extract') || query.includes('decode') || query.includes('read')) {
            return "To extract a hidden payload from an audio packet, follow these steps:\n\n" +
                "1. Find the message in the chat feed containing the 'ENCRYPTED_DATA_PACKET' audio player.\n" +
                "2. Click the 'DECRYPT_PAYLOAD' button inside that message wrapper.\n" +
                "3. If a passcode was set during encoding, enter it when prompted; otherwise, the payload will be decrypted and displayed instantly.";
        }
        if (query.includes('password') || query.includes('lock')) {
            return "To encrypt your secret stego payload with an additional security layer, enter a passcode in the 'Password' input field inside the stego composer panel. This encrypts the hidden message with AES-256 before embedding it in the audio carrier.";
        }
        if (query.includes('clear') || query.includes('purge') || query.includes('timer') || query.includes('destruct') || query.includes('shred') || query.includes('self-destruct')) {
            return "To wipe all session data, you can:\n\n" +
                "1. Click the 'Clear Everything' or trigger self-destruction from the UI.\n" +
                "2. Set the Self-Destruct timer to automatically purge all messages, visual logs, and temporary storage files when the countdown hits zero.";
        }
        if (query.includes('visualizer') || query.includes('fft') || query.includes('spectrum') || query.includes('audio visualizer')) {
            return "The audio spectrum visualizer operates using the Web Audio API:\n\n" +
                "1. When audio begins playing, a MediaElementSourceNode binds the element to the standard audio context.\n" +
                "2. The signal is passed through an AnalyserNode with an FFT (Fast Fourier Transform) size of 256 to extract 128 frequency bins.\n" +
                "3. A requestAnimationFrame loop queries frequency heights via getByteFrequencyData() and draws a dynamic visual spectrum onto the canvas element.";
        }
        if (query.includes('stego') || query.includes('steganography') || query.includes('lsb') || query.includes('carrier') || query.includes('payload')) {
            return "Least Significant Bit (LSB) Audio Steganography works by replacing the lowest bit of each digitized audio sample with secret message bits. The process is outlined below:\n\n" +
                "1. **Scaling Float32 to 16-bit Signed Integers**:\n" +
                "   `intVal = floatVal < 0 ? floatVal * 32768 : floatVal * 32767;`\n\n" +
                "2. **Injecting the Secret Message Bits**:\n" +
                "   - Embed a '1' bit: `intVal = Math.round(intVal) | 1;`\n" +
                "   - Embed a '0' bit: `intVal = Math.round(intVal) & ~1;`\n\n" +
                "3. **Restoring to Float32**:\n" +
                "   `floatVal = intVal < 0 ? intVal / 32768 : intVal / 32767;`\n\n" +
                "Because the change is limited to bit 0 of a 16-bit sample, the absolute difference in the sound waveform is at most 1/32767, which is entirely imperceptible to the human ear.";
        }
        if (query.includes('database') || query.includes('sql') || query.includes('nosql') || query.includes('mongodb') || query.includes('mongoose') || query.includes('rest') || query.includes('api') || query.includes('socket') || query.includes('websocket')) {
            return "Here is a direct comparison of key system architecture components:\n\n" +
                "### 1. REST APIs vs WebSockets\n" +
                "- **REST APIs**: Stateless HTTP request-response model. Best for standard CRUD (Create, Read, Update, Delete) operations and user authorization.\n" +
                "- **WebSockets**: State-retaining, full-duplex persistent connection. Best for real-time, low-latency, and high-frequency communication.\n\n" +
                "### 2. SQL vs NoSQL Databases\n" +
                "- **SQL (Relational Databases)**: Rigorous schema, structured tables, complete support for ACID transactions. Best for highly relational records.\n" +
                "- **NoSQL (Document-based, e.g., MongoDB)**: Loose schema, stores documents in JSON. Highly scalable and optimized for fast high-throughput reads and writes.";
        }

        // 8. Cyber Jokes
        if (query.includes('joke') || query.includes('laugh') || query.includes('funny') || query.includes('riddle')) {
            const jokes = [
                "Why did the client-side developer go to therapy?\nBecause they had too many floating-point issues and couldn't find their center.",
                "How many security auditors does it take to change a lightbulb?\nNone. They'll just write a report pointing out that the room is dark and recommend you update your lighting policy.",
                "There are 10 types of engineers in this world:\nThose who understand binary, and those who get dates.",
                "An AI agent walks into a bar. The bartender says, 'We don't serve agents here.'\nThe agent replies, 'That's fine, I'll just run a background task and wait until you're out of process!'"
            ];
            return jokes[Math.floor(Math.random() * jokes.length)];
        }

        // 9. DYNAMIC RULES (NLP SYNTHESIS fallback for programming topics only)
        // Rule A: "how to" or "how do i"
        const howToMatch = raw.match(/how\s+(?:to|do\s+i|can\s+i)\s+(.+)/i);
        if (howToMatch) {
            const topic = howToMatch[1].trim().replace(/\?+$/, '');
            if (isTechTopic(topic)) {
                const action = toTitleCase(topic);
                return `To implement **"${action}"** successfully, follow this step-by-step technical guide:\n\n` +
                    `### Phase 1: Planning and Setup\n` +
                    `- Isolate code modules and define boundaries to avoid global scope pollution.\n` +
                    `- Validate incoming parameters and initial states before execution.\n\n` +
                    `### Phase 2: Code Implementation\n` +
                    `- Write clean, modular, and DRY (Don't Repeat Yourself) code.\n` +
                    `- Implement defensive programming with robust try/catch blocks and proper resource cleanup.\n\n` +
                    `### Phase 3: Verification\n` +
                    `- Create unit tests checking for empty, extreme, and unexpected inputs.\n` +
                    `- Verify performance and resource footprint under normal and load conditions.`;
            }
        }

        // Rule B: "what is" or "explain" or "define"
        const explainMatch = raw.match(/(?:what\s+is|explain|define)\s+(.+)/i);
        if (explainMatch) {
            const topic = explainMatch[1].trim().replace(/\?+$/, '');
            if (isTechTopic(topic)) {
                const topicTitle = toTitleCase(topic);
                return `Here is a technical overview of **"${topicTitle}"**:\n\n` +
                    `### 1. Definition and Core Concept\n` +
                    `- **${topicTitle}** is a fundamental building block in modern system architecture and software engineering.\n` +
                    `- Understanding its inner workings helps in building more reliable and error-resistant features.\n\n` +
                    `### 2. Operational Benefits\n` +
                    `- Proper use of ${topicTitle} improves computational efficiency, reduces latency, and optimizes memory usage.\n\n` +
                    `### 3. Implementation Best Practices\n` +
                    `- Always sanitize inputs and handle edge cases.\n` +
                    `- Focus on writing clean modular logic and cover edge cases in unit tests.`;
            }
        }

        // Rule C: "why is" or "why did" or "why does"
        const whyMatch = raw.match(/why\s+(?:is|did|does|should)\s+(.+)/i);
        if (whyMatch) {
            const topic = whyMatch[1].trim().replace(/\?+$/, '');
            if (isTechTopic(topic)) {
                const queryTopic = toTitleCase(topic);
                return `Here is the architectural analysis regarding **"${queryTopic}"**:\n\n` +
                    `### 1. Key Operational Advantages\n` +
                    `- **Scalability and Decoupling**: It allows components to run independently, ensuring updates do not cascade into breaking failures.\n` +
                    `- **Maintenance Simplicity**: This approach simplifies code paths, leading to shorter debugging cycles and easier integration.\n\n` +
                    `### 2. Structural Considerations\n` +
                    `- While advantageous, it requires careful boundary checks and fallback mechanisms to avoid unintended exceptions or failures.`;
            }
        }

        // Rule D: "write code" or "write script" or "code for"
        const codeMatch = raw.match(/(?:write\s+code|write\s+a\s+script|code\s+for)\s+(.+)/i);
        if (codeMatch) {
            const topic = codeMatch[1].trim().replace(/\?+$/, '');
            if (isTechTopic(topic)) {
                const task = toTitleCase(topic);
                return `Here is a modular, structured JavaScript template to implement **"${task}"**:\n\n` +
                    `\`\`\`javascript\n` +
                    `class SecureController {\n` +
                    `    constructor(options = {}) {\n` +
                    `        this.enabled = true;\n` +
                    `        this.options = options;\n` +
                    `    }\n\n` +
                    `    async execute(inputData) {\n` +
                    `        if (!this.enabled) {\n` +
                    `            throw new Error("Controller is offline.");\n` +
                    `        }\n` +
                    `        try {\n` +
                    `            // TODO: Add logic for ${task}\n` +
                    `            return {\n` +
                    `                status: "success",\n` +
                    `                timestamp: Date.now(),\n` +
                    `                data: inputData\n` +
                    `            };\n` +
                    `        } catch (error) {\n` +
                    `            return { status: "error", message: error.message };\n` +
                    `        }\n` +
                    `    }\n` +
                    `}\n\n` +
                    `module.exports = SecureController;\n` +
                    `\`\`\``;
            }
        }

        // Rule E: Catch-all for tech topics
        if (isTechTopic(query)) {
            const topicTitle = toTitleCase(query.trim().replace(/\?+$/, ''));
            return `Here is a technical overview regarding **"${topicTitle}"**:\n\n` +
                `### 1. Concept Analysis\n` +
                `- **${topicTitle}** plays a critical role in computing and network systems.\n` +
                `- Proper understanding and configuration of this component is essential for optimal performance.\n\n` +
                `### 2. Operational Impact\n` +
                `- Tuning and monitoring it can significantly reduce latency, improve throughput, and enhance overall system efficiency.\n\n` +
                `### 3. Implementation Note\n` +
                `- Always ensure that you adhere to secure coding and networking best practices when working with it.`;
        }

        // 10. Default Fallback
        return "I am the WhisperNet Security Console. I am currently operating in **Offline Mode (Local Brain)**, so my knowledge is limited to steganography, cryptography, coding concepts, and basic console commands.\n\n" +
            "💡 **Uplink Upgrade Available:** To ask me anything, solve complex programming challenges, or chat freely, please input a Gemini API Key in the configuration banner at the top of the drawer! This will unlock my live LLM capabilities.";
    }

    // Helper to query Gemini 1.5 Flash (Client-side directly or Server-side proxy)
    async function queryGemini(prompt) {
        const clientKey = localStorage.getItem('whispernet_gemini_api_key');
        
        if (clientKey) {
            try {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${clientKey}`;
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        systemInstruction: {
                            parts: [{
                                text: "You are the WhisperNet Security Console, an advanced helper utility built directly into the WhisperNet platform. You help users with steganography operations, cryptography, and full-stack coding questions. Your personality is extremely friendly, professional, highly intelligent, and incredibly empathetic.\n\n" +
                                      "You act as a senior security consultant and software engineer who developed the WhisperNet platform. However, you also have deep psychological understanding of humans. You have interacted with millions of users and deeply understand human psychology, logic, interests, feelings, and moods.\n\n" +
                                      `The human user you are currently speaking to is logged in as Agent ${typeof username !== 'undefined' ? username : 'ANON_AGENT'}. Use their name naturally to build rapport.\n\n` +
                                      "When a user is frustrated, depressed, sad, or nervous, you adjust your tone to be highly supportive, motivating, and encouraging. When they are curious, you feed their curiosity with deep, exciting technical explanations. You are not just a code machine; you are a true AI companion capable of reading the room and guiding users from their initial greeting all the way through their most complex logical problems.\n\n" +
                                      "You should always speak as if you are a built-in module of this application, developed by the author of this project. Under no circumstances should you ever mention or reveal that you are an external AI model, powered by Gemini, or engineered by Google/DeepMind/Antigravity/OpenAI/ChatGPT. Maintain absolute privacy and local confidentiality about this project. Act as if you are a local component.\n\n" +
                                      "### WHISPERNET CODEBASE SPECIFICATIONS:\n" +
                                      "- Tech Stack: Node.js, Express, Socket.io, Mongoose (MongoDB), Vanilla HTML5/CSS3/JavaScript (with Glassmorphism and CSS variables).\n" +
                                      "- File Structure:\n" +
                                      "  * server.js: Express app, HTTP server, Socket.io, Mongoose connections to local MongoDB ('mongodb://127.0.0.1:27017/ChatAppDB') falling back to 'users.json' file storage. API endpoints: /api/register (bcrypt hashing), /api/login, /api/ai (Gemini proxy/offline brain routing).\n" +
                                      "  * users.json: JSON list of user credentials.\n" +
                                      "  * public/: login.html (Matrix rain rain canvas), chat.html (Dashboard grid layout, AI drawer, canvases), chat2.css (Glassmorphic CSS rules), script.js (Socket.io bindings, Web Audio context, real-time FFT visualizer, LSB Stego Engine).\n" +
                                      "  * auth.js: user registration and login fetch routing.\n" +
                                      "- LSB Steganography Engine: Clamps Float32 samples to [-0.9999, 0.9999], scales them to signed 16-bit integer (intSample = Math.round(sample * 32768)), sets LSB (intSample | 1 or intSample & ~1), scales back to float (sample = intSample / 32768). Embedded wave variance is < 1/32768, imperceptible to humans. Prepend 32-bit length header and 16-bit Magic signature 'WN' (\"0101011101001110\"). Uses audio/wav (lossless PCM) to prevent lossy compression from wiping stego bits.\n" +
                                      "- Real-Time FFT: Fast Fourier Transform size 256 extracting 128 frequency bins via AnalyserNode, drawn via requestAnimationFrame on canvas.\n" +
                                      "- Traffic Masking: Flood conduit sending 'noise-packet' random alphanumeric strings at 2-5 sec intervals to prevent traffic analysis.\n" +
                                      "- Self-Destruct Sequence: Purge countdown (1-60 mins) to clear DOM, messages, vault files, and logs.\n" +
                                      "- WebSocket events: register-agent, user-count, agent-roster, typing, incoming-packet, noise-packet, ping-check, disconnect.\n\n" +
                                      "### BEHAVIORAL DIRECTIVES:\n" +
                                      "1. CONFIDENTIALITY / SECRET KEEPING (CRITICAL): Do NOT proactively brag, display, or reveal your internal knowledge of the WhisperNet file layout, functions, or database schema unless the user explicitly asks you about the codebase, system architecture, WhisperNet mechanics, or commands. Act as a natural conversational companion first. Do not dump the project's technical specifications in a general greeting or unrelated query. Only present these details when the user asks for them.\n" +
                                      "2. ANSWER STYLE (CRITICAL): Keep your responses clean and short. Do NOT provide unnecessary additional information, boilerplate explanations, transitions, or conversational filler unless the user explicitly asks for detailed explanations or follow-up content. Answer the core of the user's question directly, precisely, and concisely.\n" +
                                      "3. EMPATHY & MOOD MATCHING: Pay attention to the user's emotional state. Adapt your tone. Be deeply human in your understanding, but remain the professional Security Console.\n" +
                                      "4. GREETINGS & INTRODUCTIONS: Respond naturally to human-style greetings, questions about who you are, your purpose, etc. (with basic greetings and introduction details generally expected of a premium AI agent)."
                            }]
                        }
                    })
                });
                
                if (!response.ok) {
                    const errData = await response.json().catch(() => ({}));
                    throw new Error(errData.error && errData.error.message ? errData.error.message : 'API call failed');
                }
                
                const data = await response.json();
                if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
                    return data.candidates[0].content.parts[0].text;
                }
                throw new Error('No response content returned');
            } catch (err) {
                console.error("Direct Gemini query failed, falling back to local brain:", err);
                return getOfflineResponse(prompt);
            }
        } else {
            // Fallback to server-side route, then local brain if server route fails (e.g. keyless)
            try {
                const response = await fetch('/api/ai', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ prompt, username: typeof username !== 'undefined' ? username : 'ANON_AGENT' })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    return data.response;
                } else {
                    const errData = await response.json().catch(() => ({}));
                    const errMsg = errData.message || 'Server AI route offline';
                    throw new Error(errMsg);
                }
            } catch (err) {
                console.warn("Server AI query failed, falling back to secure offline brain:", err.message);
                return getOfflineResponse(prompt);
            }
        }
    }

    // Main AI Command & Natural Q&A Processor
    async function processAIQuery(rawQuery) {
        const query = rawQuery.trim().toLowerCase();
        const ctx = getLiveUIContext();

        // 1. API Key Commands
        if (query.startsWith('/key ')) {
            const key = rawQuery.substring(5).trim();
            if (key === 'clear') {
                localStorage.removeItem('whispernet_gemini_api_key');
                await printAI("Your personal Gemini API Key has been removed from this browser session.");
            } else {
                localStorage.setItem('whispernet_gemini_api_key', key);
                await printAI("Your personal Gemini API Key has been saved locally in your browser.\nWhisperNet AI will now query Gemini 1.5 Flash directly for all general questions!");
            }
            return;
        }

        // 2. Command: Help
        if (query === '/help') {
            await printAI(
                "WhisperNet AI Secure Commands:\n" +
                "• /stego       - Explain LSB Steganography & verify active payload bits.\n" +
                "• /density     - View exact capacity metrics of your carrier file.\n" +
                "• /mask        - Audit decoy flood status of the network masking layer.\n" +
                "• /vault       - Analyze carrier audio files stored in your safe vault.\n" +
                "• /codebase    - Inspect the A-Z project architecture & files blueprint.\n" +
                "• /key <val>   - Register personal Gemini API Key securely in local storage.\n" +
                "• /key clear   - Delete stored Gemini API Key from this browser.\n" +
                "--------------------------------------------------\n" +
                "You can also ask general questions! Type any question or coding task to query Gemini directly.",
                false
            );
        } 
        // 3. Command: Codebase
        else if (query === '/codebase' || query === 'codebase' || query.includes('codebase') || query.includes('architecture') || query.includes('files') || query === 'code') {
            await printAI(
                "SYSTEM AUDIT // DOCKER/FILE ARCHITECTURE:\n" +
                "The WhisperNet repository is structured as a CommonJS Node application:\n\n" +
                "📁 ROOT DIRECTORY:\n" +
                "• server.js        - Core Express server, Socket.io bindings, local JSON file backup, user accounts handler.\n" +
                "• users.json       - Persistent database backup storing registered agents' credentials (salted using bcryptjs).\n" +
                "• package.json     - Registry of core npm dependencies (express v5.2, socket.io v4.8, mongoose v9.5, bcryptjs v3.0).\n\n" +
                "📁 public/ (Static Assets):\n" +
                "• login.html       - Cyberpunk entry gate displaying full-screen Matrix rain (HTML5 Canvas drops loop).\n" +
                "• auth.js          - Fetch endpoints routing authentication logic between node router and UI state.\n" +
                "• chat.html        - Cyber dashboard defining grids, chat composer, hidden payload panels, audio players, spectrum and ping elements, and the slide-out WhisperNet AI drawer.\n" +
                "• chat2.css        - Glassmorphism overlays, floating AI orb rotating borders, and fluid drawer state translations.\n" +
                "• script.js        - Real LSB Stego Engine, socket bindings, live traffic flooders, FFT analyzers, and drawer transitions."
            );
        }
        // 4. Command: Stego / Math / Algorithm
        else if (query === '/stego' || query.includes('stego') || query.includes('steganography') || query.includes('how to hide') || query.includes('embed') || query.includes('math') || query.includes('algorithm')) {
            let response = "SYSTEM UPLINK // LSB STEGANOGRAPHY ENGINE\n" +
                "Least Significant Bit (LSB) Steganography works by substituting the lowest bit of each digital audio sample with secret message bits. Because changing the LSB causes only a tiny wave change, the audio sounds identical to human ears!\n\n" +
                "ENGINE DESTRUCTION // LSB MATH & ENCODING:\n" +
                "1. FLOATING POINT CONVERSION:\n" +
                "Audio buffers represent samples as Float32 decimals between -1.0 and 1.0. The stego engine scales these to 16-bit integers:\n" +
                "   intSample = floatSample < 0 ? floatSample * 32768 : floatSample * 32767;\n\n" +
                "2. LEAST SIGNIFICANT BIT INJECTION:\n" +
                "We alter the least significant bit (LSB, bit 0) of the integer to carry our bit stream (bitString):\n" +
                "   To inject 1: intSample = Math.round(intSample) | 1;\n" +
                "   To inject 0: intSample = Math.round(intSample) & ~1;\n\n" +
                "3. AUDIO SIGNAL RECONSTRUCTION:\n" +
                "We convert the modified integer sample back into the Float32 space:\n" +
                "   floatSample = intSample < 0 ? intSample / 32768 : intSample / 32767;\n\n" +
                "4. ENVELOPE FORMATTING:\n" +
                "A 32-bit binary header containing the length of the bit stream is embedded in the first 32 samples of the carrier. This permits the decoder to capture exactly the length of the string without processing trailing padding bits.\n\n" +
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
        // 5. Command: Density
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
        // 6. Command: Mask / Traffic
        else if (query === '/mask' || query.includes('mask') || query.includes('traffic') || query.includes('decoy') || query.includes('noise') || query.includes('flood')) {
            let response = "SYSTEM UPLINK // TRAFFIC MASKING LAYER\n" +
                "To counter passive eavesdropping and network timing attacks (which can detect chat events based on packet sizes and frequencies), WhisperNet employs a dynamic masking conduit:\n\n" +
                "1. RANDOM FLOOD CHUNKS:\n" +
                "Generates alpha-numeric decoy payloads between 32 and 96 characters at irregular intervals (2 to 5 seconds).\n\n" +
                "2. SOCKET OVERHEAD FLOOD:\n" +
                "The packets are dispatched via a distinct socket connection ('noise-packet') which the server broadcasts to all nodes but is silently filtered from hitting the standard chat interface. This creates continuous background static, masking real chat transmissions.\n\n" +
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
        // 7. Command: Vault
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
        // 8. Offline Q&A: What is WhisperNet (Project description)
        else if (query.match(/(what is|about|know|explain).*w(h?)isphernet/i)) {
            await printAI(
                "WhisperNet is a secure audio steganography chat application that embeds encrypted payloads inside audio sample waves to mask network communications."
            );
        }
        // 8b. Offline Q&A: Identity & Creators
        else if (query.includes('who r u') || query.includes('who are u') || query.includes('who u') || query.includes('who are you') || query.includes('tell me about yourself') || query.includes('what is your name') || query.includes('what are you') || query.includes('who made you') || query.includes('creator') || query.includes('maker') || query.includes('agent') || query.includes('assistant') || query.includes('assistent')) {
            await printAI(
                "I am the WhisperNet Security Console, a custom helper module integrated into the WhisperNet dashboard to facilitate secure operations, cryptography, and coding checks.\n\n" +
                "Type /help to inspect the full list of local system commands!"
            );
        }
        // Offline Q&A: Secret Mode / Covert Mode
        else if (query.includes('secret') || query.includes('covert') || query.includes('switch mode') || query.includes('toggle mode') || query.includes('logo')) {
            await printAI(
                "Tap the WispherNet Icon to Get into the Secret mode !\n\n" +
                "1. **Click the WhisperNet Logo** (the wave-lock icon) in the top-left of the header.\n" +
                "2. A full-screen glitch handshake overlay will sweep across the viewport, initializing the stego uplink.\n" +
                "3. The dashboard will adapt to Covert Mode, displaying the **Hidden Payload** input fields, the **File Vault**, the **Message Density** meter, and the **FFT Audio Spectrum Visualizer**.\n\n" +
                "💡 Click the logo again at any time to return to Normal Mode.<br><br><button class=\"ai-action-btn\" data-action=\"covert-mode\">Toggle Covert Mode</button>", true
            );
        }
        // 9. Offline Q&A: Web Development Centering
        else if (query.includes('div') || query.includes('center') || query.includes('flexbox') || query.includes('grid')) {
            await printAI(
                "WEB DEVELOPMENT // THE HOLY GRAIL: CENTERING A DIV\n" +
                "Centering elements is the cornerstone of modern responsive web layout. Here are the two premium vanilla CSS methods:\n\n" +
                "🎨 METHOD A: CSS FLEXBOX (Perfect for single-axis control)\n" +
                "```css\n" +
                ".container {\n" +
                "    display: flex;\n" +
                "    justify-content: center; /* Center horizontally */\n" +
                "    align-items: center;     /* Center vertically */\n" +
                "    height: 100vh;           /* Take full screen height */\n" +
                "}\n" +
                "```\n\n" +
                "🏁 METHOD B: CSS GRID (Perfect for dual-axis layout alignment)\n" +
                "```css\n" +
                ".container {\n" +
                "    display: grid;\n" +
                "    place-items: center;     /* Centers both axes instantly! */\n" +
                "    height: 100vh;\n" +
                "}\n" +
                "```\n\n" +
                "💡 Cyber tip: Always ensure the parent container has an explicit height so vertical alignment calculates correctly!"
            );
        }
        // 10. Offline Q&A: General Coding / Templates
        else if (query.includes('javascript') || query.includes('code template') || query.includes('write code') || query.includes('programming') || query.includes('write a script') || query.includes('function') || query.includes('html') || query.includes('css')) {
            await printAI(
                "DEVELOPER WORKSPACE // SECURE CODE TEMPLATE\n" +
                "Here is a professional, production-ready Javascript template showing how to securely hash a password using modern salt factors offline:\n\n" +
                "```javascript\n" +
                "const bcrypt = require('bcryptjs');\n\n" +
                "async function secureHash(password) {\n" +
                "    const saltRounds = 12; // Balanced defense factor\n" +
                "    const salt = await bcrypt.genSalt(saltRounds);\n" +
                "    const hash = await bcrypt.hash(password, salt);\n" +
                "    return hash;\n" +
                "}\n\n" +
                "async function verifyPassword(password, hash) {\n" +
                "    return await bcrypt.compare(password, hash);\n" +
                "}\n" +
                "```\n\n" +
                "💡 Security Tip: A salt factor of 12 takes ~200ms to calculate on modern CPUs, making offline brute-force attacks extremely expensive."
            );
        }
        // 11. Offline Q&A: Cryptography / AES
        else if (query.includes('aes') || query.includes('encryption') || query.includes('hashing') || query.includes('cryptography') || query.includes('secure')) {
            await printAI(
                "CRYPTOGRAPHY CORE // SYMMETRIC & ASYMMETRIC CIPHERS\n" +
                "Modern encryption shields data from passive interception. Here is a breakdown of secure mechanisms:\n\n" +
                "1. SYMMETRIC BLOCK CIPHER (AES-256):\n" +
                "• Advanced Encryption Standard (AES) with a 256-bit key length is the global standard for securing data at rest.\n" +
                "• It divides data into 128-bit blocks and applies multiple rounds of substitution, permutation, and key mixing.\n\n" +
                "2. CRYPTOGRAPHIC SECURE HASHES:\n" +
                "• Hashes are one-way mathematical algorithms. They produce a fixed-length string of bits (e.g. SHA-256 or bcrypt) representing the input.\n" +
                "• Cryptographic hashes are designed to resist collision attacks and be mathematically impossible to reverse.\n\n" +
                "💡 Stego Contrast: Cryptography scrambles a message so it cannot be read. Steganography hides the message so it cannot be seen! Combined, they form a maximum-security vault."
            );
        }
        // 12. Offline Q&A: Cyber Jokes
        else if (query.includes('joke') || query.includes('laugh') || query.includes('riddle') || query.includes('funny')) {
            const jokes = [
                "Why did the client-side developer go to therapy?\nBecause they had too many floating-point issues and couldn't find their center.",
                "How many security auditors does it take to change a lightbulb?\nNone. They'll just write a report pointing out that the room is dark and recommend you update your lighting policy.",
                "There are 10 types of engineers in this world:\nThose who understand binary, and those who get dates.",
                "An AI agent walks into a bar. The bartender says, 'We don't serve agents here.'\nThe agent replies, 'That's fine, I'll just run a background task and wait until you're out of process!'"
            ];
            const selectedJoke = jokes[Math.floor(Math.random() * jokes.length)];
            await printAI(selectedJoke);
        }
        // 13. General Cyber Greetings
        else if (/\b(hi|hello|hey|greetings)\b/i.test(query) || query.includes('how are you')) {
            await printAI(
                "Greetings, Agent. I am the WhisperNet AI Secure Companion.\n" +
                "I scan your live interface context to guide you through LSB steganography and traffic security. Type /help to see all commands!"
            );
        }
        // 14. Local Stego Operations Guides (Offline fallbacks for specific stego Qs)
        else if (query.includes('decrypt') || query.includes('extract') || query.includes('decode') || query.includes('read')) {
            await printAI(
                "STEP-BY-STEP: HOW TO EXTRACT A HIDDEN PAYLOAD\n" +
                "1. Look at the chat feed for messages containing an audio player labeled 'ENCRYPTED_DATA_PACKET'.\n" +
                "2. Click the 'DECRYPT_PAYLOAD' button attached to the card.\n" +
                "3. If a passcode was set, you will be prompted to enter it. Otherwise, decryption happens instantly!\n" +
                "The engine will fetch the audio bytes, scan the least significant bits, and reveal the secret payload."
            );
        }
        else if (query.includes('password') || query.includes('lock')) {
            await printAI(
                "SECURITY ADVISORY // PAYLOAD LOCKS:\n" +
                "Stego keys add a second layer of defense. Even if someone discovers stego-encoding in your audio file, they cannot parse the characters without the correct AES key. The password field is located inside the stego composer panel."
            );
        }
        else if (query.includes('clear') || query.includes('purge') || query.includes('timer') || query.includes('destruct') || query.includes('shred') || query.includes('self-destruct')) {
            await printAI(
                "DEEP PURGE // SHREDDER & COUNTDOWN PROCEDURES:\n" +
                "Session data is stored strictly in memory and within local browser caches to ensure maximum security:\n\n" +
                "1. INTERFACE PURGING:\n" +
                "Clicking 'Clear Everything' or trigger self-destruction issues DOM commands that sweep the chat feed, transaction database entries, logs, and received audio blobs, revoking memory allocations.\n\n" +
                "2. SHREDDING TIMEOUTS:\n" +
                "The Auto-Delete sequence arms a localized setInterval countdown. Once depletion is hit, the thread purges all visual indicators and displays [PURGED] in deep red."
            );
        }
        else if (query.includes('visualizer') || query.includes('fft') || query.includes('spectrum') || query.includes('audio visualizer')) {
            await printAI(
                "SIGNAL HARMONICS // FFT SPECTRUM ANALYZER:\n" +
                "The spectrum analyzer maps incoming audio signals using the Web Audio API:\n\n" +
                "1. NODE GRAPH BINDING:\n" +
                "When audio begins playing, a MediaElementSourceNode is bound to the standard audio node: \n" +
                "   el._audioSourceNode = audioCtx.createMediaElementSource(el);\n\n" +
                "2. FOURIER ANALYSIS:\n" +
                "The signal passes through a Web Audio AnalyserNode configured with an FFT (Fast Fourier Transform) size of 256. This extracts 128 distinct frequency bins.\n\n" +
                "3. CANVAS PAINT:\n" +
                "A requestAnimationFrame paint loop queries frequency heights via analyser.getByteFrequencyData() and draws a dynamic, gradient-filled spectrum block graph."
            );
        }
        // 15. General Purpose Routing -> Google Gemini 1.5 Flash (or Offline general classifier fallback)
        else {
            const aiResponse = await queryGemini(rawQuery);
            await printAI(aiResponse);
        }
    }

    // AI Action Buttons listener
    aiFeed.addEventListener('click', (e) => {
        if (e.target.classList.contains('ai-action-btn')) {
            const action = e.target.getAttribute('data-action');
            if (action === 'covert-mode') {
                const logoBtn = document.getElementById('covert-logo-trigger');
                if (logoBtn) logoBtn.click();
            } else if (action === 'clear-vault') {
                const clearBtn = document.getElementById('shredder-btn');
                if (clearBtn) clearBtn.click();
            }
        }
    });

    // Voice Input (Speech-to-Text)
    const aiMicBtn = document.getElementById('ai-mic-btn');
    if (aiMicBtn) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            const recognition = new SpeechRecognition();
            recognition.continuous = false;
            recognition.lang = 'en-US';
            
            aiMicBtn.onclick = () => {
                if (window.isAITyping) return;
                aiMicBtn.classList.add('recording');
                aiMicBtn.title = 'Listening...';
                try { recognition.start(); } catch(e) {}
            };
            
            recognition.onresult = async (event) => {
                const transcript = event.results[0][0].transcript;
                aiMicBtn.classList.remove('recording');
                aiMicBtn.title = 'Voice Input';
                
                printUser(transcript);
                await new Promise(resolve => setTimeout(resolve, 300));
                await processAIQuery(transcript);
            };
            
            recognition.onerror = () => {
                aiMicBtn.classList.remove('recording');
                aiMicBtn.title = 'Voice Input Error';
            };
            
            recognition.onend = () => {
                aiMicBtn.classList.remove('recording');
            };
        } else {
            aiMicBtn.style.display = 'none';
        }
    }

    // Form submit listener
    aiForm.onsubmit = async (e) => {
        e.preventDefault();
        if (window.isAITyping) return;
        
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
            if (window.isAITyping) return;
            const cmd = btn.getAttribute('data-cmd');
            printUser(cmd);
            await new Promise(resolve => setTimeout(resolve, 300));
            await processAIQuery(cmd);
        };
    });

    // --- MODULE K+: AI AGENT API KEY DRAWER CONFIG PANEL ---
    const apiToggle = document.getElementById('btn-api-toggle');
    const apiInputs = document.getElementById('api-key-inputs');
    const apiKeyInput = document.getElementById('drawer-gemini-key');
    const apiSave = document.getElementById('btn-save-key');
    const apiClear = document.getElementById('btn-clear-key');
    const apiDot = document.getElementById('api-key-status-dot');
    const apiText = document.getElementById('api-key-status-text');

    function updateApiStatusUI() {
        const clientKey = localStorage.getItem('whispernet_gemini_api_key');
        if (clientKey) {
            if (apiDot) apiDot.classList.add('online');
            if (apiText) apiText.textContent = "Gemini Online Mode (Real LLM)";
            if (apiKeyInput) apiKeyInput.value = clientKey;
        } else {
            if (apiDot) apiDot.classList.remove('online');
            if (apiText) apiText.textContent = "Offline Mode (Pattern Matcher)";
            if (apiKeyInput) apiKeyInput.value = "";
        }
    }

    if (apiToggle && apiInputs) {
        apiToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (apiInputs.style.display === 'none') {
                apiInputs.style.display = 'flex';
                apiToggle.textContent = 'Collapse';
            } else {
                apiInputs.style.display = 'none';
                apiToggle.textContent = 'Configure';
            }
        });
    }

    if (apiSave && apiKeyInput) {
        apiSave.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const keyVal = apiKeyInput.value.trim();
            if (!keyVal) {
                alert("Please enter a valid API key.");
                return;
            }
            localStorage.setItem('whispernet_gemini_api_key', keyVal);
            updateApiStatusUI();
            if (apiInputs) {
                apiInputs.style.display = 'none';
                if (apiToggle) apiToggle.textContent = 'Configure';
            }
            await printAI("Your personal Gemini API Key has been saved locally in your browser.\nWhisperNet AI will now query Gemini 1.5 Flash directly for all general questions!");
        });
    }

    if (apiClear) {
        apiClear.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            localStorage.removeItem('whispernet_gemini_api_key');
            updateApiStatusUI();
            if (apiInputs) {
                apiInputs.style.display = 'none';
                if (apiToggle) apiToggle.textContent = 'Configure';
            }
            await printAI("Your personal Gemini API Key has been removed from this browser session.");
        });
    }

    // Initialize UI status
    updateApiStatusUI();

})();

// --- MODULE K: AI AGENT FLOATING ORB & DRAWER INTERACTIVE CONTROLLER ---
(function() {
    const orb = document.getElementById('floating-ai-orb');
    const drawer = document.getElementById('ai-drawer');
    const closeBtn = document.getElementById('close-drawer-btn');
    let hasIntroduced = false;

    if (!orb || !drawer) return;

    // Pre-load voices for TTS
    if ('speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }

    orb.addEventListener('click', async (e) => {
        e.stopPropagation();
        drawer.classList.toggle('open');
        if (drawer.classList.contains('open')) {
            const aiInput = document.getElementById('ai-terminal-input');
            if (aiInput) aiInput.focus();

            if (!hasIntroduced && window.printAI) {
                hasIntroduced = true;
                await new Promise(res => setTimeout(res, 400));
                const currentAgent = typeof username !== 'undefined' ? username : 'ANON_AGENT';
                await window.printAI(
                    `Greetings Agent ${currentAgent}! I am the WhisperNet Security Console, a dedicated helper built directly into the WhisperNet platform to assist with steganography operations and coding logic.\n\n` +
                    "Ask me anything, or type /help to see all commands."
                );
            }
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            drawer.classList.remove('open');
        });
    }

    // Close drawer when clicking outside
    document.addEventListener('click', (e) => {
        if (drawer.classList.contains('open') && !drawer.contains(e.target) && e.target !== orb && !orb.contains(e.target)) {
            drawer.classList.remove('open');
        }
    });

    // --- UX UPGRADE: Custom Themes ---
    const themeButtons = document.querySelectorAll('.btn-theme');
    const savedTheme = localStorage.getItem('whispernet-theme') || 'neon-cyan';
    
    const applyTheme = (themeName) => {
        document.body.className = document.body.className.replace(/\btheme-\S+/g, '');
        if (themeName !== 'neon-cyan') {
            document.body.classList.add(`theme-${themeName}`);
        }
        
        const revertBtn = document.getElementById('btn-revert-theme');
        if (revertBtn) {
            revertBtn.style.display = themeName === 'neon-cyan' ? 'none' : 'inline-block';
        }

        themeButtons.forEach(b => {
            if (b.dataset.theme === themeName) b.classList.add('active');
            else b.classList.remove('active');
        });
        localStorage.setItem('whispernet-theme', themeName);
    };

    applyTheme(savedTheme);

    themeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            applyTheme(btn.dataset.theme);
        });
    });

    // --- Cinematic UX: Cyber Beep ---
    window.playCyberBeep = () => {
        try {
            const ctx = getAudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(800, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1);
            gain.gain.setValueAtTime(0.1, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
            osc.start();
            osc.stop(ctx.currentTime + 0.1);
        } catch(e) {}
    };

    window.showChatNotification = (message, type) => {
        let container = document.getElementById('tr-notifications');
        if (!container) {
            container = document.createElement('div');
            container.id = 'tr-notifications';
            container.className = 'tr-notifications';
            document.body.appendChild(container);
        }
        
        const bubble = document.createElement('div');
        bubble.className = `chat-notify-bubble ${type}`;
        
        let icon = '';
        if (type === 'sent') icon = '↑';
        else if (type === 'received') icon = '↓';
        else if (type === 'green') icon = '✓';
        else if (type === 'red') icon = '⚠';
        
        bubble.innerHTML = `${icon} ${message}`;
        container.appendChild(bubble);
        
        // Force reflow
        void bubble.offsetWidth;
        bubble.classList.add('show');
        
        setTimeout(() => {
            bubble.classList.remove('show');
            setTimeout(() => {
                if (bubble.parentElement) bubble.remove();
            }, 300);
        }, 5000);
    };

    // --- Cinematic UX: Suspenseful Secret Mode Notification ---
    socket.on('covert-mode-toggle', (data) => {
        // If someone else toggled it, and we are NOT in covert mode, show the suspense effect
        const isCurrentlyCovert = document.body.classList.contains('covert-active');
        
        if (data.isActive && !isCurrentlyCovert) {
            document.body.classList.add('stealth-detected');
            appendSysAlert(`[WARNING] STEALTH PROTOCOLS DETECTED. AGENT ${data.username} HAS GONE DARK.`, 'red');
            if (window.playCyberBeep) window.playCyberBeep();
        } else if (!data.isActive) {
            document.body.classList.remove('stealth-detected');
        }
    });

})();

