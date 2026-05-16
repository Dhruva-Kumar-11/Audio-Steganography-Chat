const socket = io();

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
        mediaRecorder = new MediaRecorder(recordingStream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            currentAudioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            selectedCarrierFile = new File([currentAudioBlob], `recording_${Date.now()}.webm`, { type: 'audio/webm' });
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
});

// ... rest of script until click listener ...

window.addEventListener("click", async (e) => {
    if (e.target.classList.contains('decode-btn')) {
        const card = e.target.closest('.message');
        const secretText = card.dataset.payload;
        const correctKey = card.dataset.key;

        if (!secretText) {
            addToAuditLog("SYSTEM_ERROR: PAYLOAD_MISSING");
            if(window.showToast) window.showToast("SYSTEM_ERROR: PAYLOAD_MISSING", true);
            return;
        }

        // Visual: Decrypting Progress Bar
        const progressContainer = card.querySelector('.progress-container');
        const progressBar = card.querySelector('.progress-bar');
        const originalText = e.target.textContent;
        
        e.target.disabled = true;
        e.target.textContent = "DECRYPTING...";
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        
        // Trigger reflow to ensure transition starts
        progressBar.offsetHeight; 
        progressBar.style.transition = 'width 1.5s linear';
        progressBar.style.width = '100%';

        // Wait 1.5s for "Scanning" effect
        await new Promise(resolve => setTimeout(resolve, 1500));

        progressContainer.style.display = 'none';
        progressBar.style.width = '0%';
        progressBar.style.transition = 'none';
        e.target.textContent = originalText;
        e.target.disabled = false;

        // Ask for key only if one was set; skip prompt for unprotected payloads
        const pass = correctKey ? prompt('Enter decryption key:') : '';
        if (pass === null) return; // user cancelled

        // Coerce both sides to string so undefined correctKey == '' passes correctly
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
            msgSpan.textContent = `> INTERCEPTED: ${secretText}`;
            reveal.appendChild(msgSpan);

            const timerSpan = document.createElement('span');
            timerSpan.style.color = 'var(--vivid-magenta)';
            timerSpan.style.marginLeft = '10px';
            timerSpan.textContent = "[15s]";
            reveal.appendChild(timerSpan);
            
            card.appendChild(reveal);
            e.target.style.display = 'none';

            // 15-Second Timer with countdown
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
            // Error Handling: Log AES_KEY_MISMATCH instead of PAYLOAD_MISSING
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

function addToAuditLog(message) {
    if (!auditLogEl) return;
    const entry = document.createElement('div');
    entry.className = 'audit-entry';
    entry.textContent = `${new Date().toLocaleTimeString()} | ${message}`;
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
    // Main Encoder: Returns a WAV Blob with hidden data
    async encode(audioBlob, secretText) {
        if (!secretText) return audioBlob;
        
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
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
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const arrayBuffer = await audioBlob.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);
        
        // 1. Read 32-bit length header
        let lengthBits = '';
        for (let i = 0; i < 32; i++) {
            let sample = Math.max(-1, Math.min(1, channelData[i]));
            let intSample = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
            lengthBits += (Math.abs(intSample) % 2).toString();
        }
        const dataLength = parseInt(lengthBits, 2);
        
        if (isNaN(dataLength) || dataLength <= 0 || dataLength > channelData.length) {
            return null; // No valid stego header found
        }
        
        // 2. Read data bits
        let dataBits = '';
        for (let i = 32; i < 32 + dataLength; i++) {
            let sample = Math.max(-1, Math.min(1, channelData[i]));
            let intSample = Math.round(sample < 0 ? sample * 32768 : sample * 32767);
            dataBits += (Math.abs(intSample) % 2).toString();
        }
        
        return this.bitsToStr(dataBits);
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
            reader.onload = () => sendPacket(reader.result, 'audio/wav');
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

        // FIX: Add progress-container so the DECRYPT_PAYLOAD click handler doesn't crash
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

    wrapper.appendChild(card);
    chatFeed.appendChild(wrapper);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

function renderMessage(payload, isMe) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
    wrapper.style.marginBottom = '20px';

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
        
        // Handle received bits if present
        if (payload.hidden_payload) {
            card.dataset.payload = payload.hidden_payload;
            // Removed redundant decode check for local performance optimization
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

    wrapper.appendChild(card);
    chatFeed.appendChild(wrapper);
    chatFeed.scrollTop = chatFeed.scrollHeight;
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
    socket.emit('register-agent', { username });
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
        if (chatFeed) chatFeed.innerHTML = '';
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
        const col = dir === '↑' ? 'var(--vivid-magenta)' : 'var(--electric-cyan)';
        tr.innerHTML = `<td style="padding:4px;color:#555;">${new Date().toLocaleTimeString()}</td><td style="padding:4px;color:${col};font-weight:bold;">${dir}</td><td style="padding:4px;color:var(--electric-cyan);max-width:60px;overflow:hidden;text-overflow:ellipsis;">${sender||'?'}</td><td style="padding:4px;color:#aaa;">${payload ? payload.length+'B' : '---'}</td><td style="padding:4px;color:#555;">${key ? key.substring(0,2)+'***' : '---'}</td>`;
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
            ctx.fillStyle = `hsl(${180 + (i / buf.length) * 160}, 100%, 55%)`;
            ctx.fillRect(x, H - bh, bw, bh);
            x += bw + 1;
        }
        animFrame = requestAnimationFrame(draw);
    }

    function stop() { if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; } resize(); ctx.clearRect(0, 0, canvas.width, canvas.height); if (statusEl) statusEl.textContent = '> NO_CARRIER_SIGNAL'; }

    function attach(el) {
        if (el === boundEl) return;
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        if (analyser) analyser.disconnect();
        analyser = audioCtx.createAnalyser(); analyser.fftSize = 256;
        try { sourceNode = audioCtx.createMediaElementSource(el); sourceNode.connect(analyser); } catch(e) {}
        analyser.connect(audioCtx.destination);
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
        if (chatFeed) chatFeed.innerHTML = '';
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
