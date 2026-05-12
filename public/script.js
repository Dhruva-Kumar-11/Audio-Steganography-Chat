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
        recordBtn.textContent = '🎤 RECORD_VOICE';
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

        const pass = prompt("ENTER DECRYPTION KEY:");
        if (!pass) return;

        if (pass === correctKey) {
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

// --- 4. MESSAGE HANDLING & SOCKETS ---

async function transmit(message, audioBlob) {
    if (!audioBlob && !message) return;

    // FIX: Capture form values SYNCHRONOUSLY before any async operation.
    // FileReader is async — by the time its callback fires, the inputs
    // may already have been cleared by the caller, losing the payload.
    const capturedPayload = secretInput.value || "";
    const capturedKey = keyInput.value || "";

    const sendPacket = (base64) => {
        const packet = {
            sender: username,
            text: message,
            audioData: base64,
            audioMime: audioBlob ? (audioBlob.type || 'audio/webm') : null,
            type: 'STEGO_PACKET',
            hidden_payload: capturedPayload,
            aes_key: capturedKey
        };
        
        socket.emit('incoming-packet', packet);
        
        // Local Display
        renderMessage({
            text: packet.text,
            audio: packet.audioData,
            sender: username,
            hidden_payload: packet.hidden_payload,
            aes_key: packet.aes_key
        }, true);

        // FIX: Reset inputs INSIDE the async callback so they are cleared
        // only after the packet is fully built (not before FileReader fires)
        secretInput.value = '';
        keyInput.value = '';
        currentAudioBlob = null;
        selectedCarrierFile = null;
        if (previewPlayer) {
            previewPlayer.src = '';
            const previewContainerEl = document.getElementById('preview-container');
            if (previewContainerEl) previewContainerEl.style.display = 'none';
        }
        
        addToAuditLog('SENDING_PACKET...');
    };

    if (audioBlob) {
        const reader = new FileReader();
        reader.onload = () => sendPacket(reader.result);
        reader.readAsDataURL(audioBlob);
    } else {
        sendPacket(null);
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
        
        // FIX: Decode button was hidden behind oncanplaythrough — show it immediately
        // so secret messages are always accessible regardless of audio load state
        if (payload.hidden_payload) {
            card.dataset.payload = payload.hidden_payload;
        }
        if (payload.aes_key) {
            card.dataset.key = payload.aes_key;
        }
        
        card.appendChild(decodeBtn);
        
        // FIX: Add sent audio to vault too (not just incoming)
        if (payload.hidden_payload) {
            addToVault(payload.audio, `${isMe ? 'LOCAL' : 'INCOMING'}_CARRIER_${Date.now()}.webm`);
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

        // AUTO-SEND: Transmit automatically as soon as carrier is ready
        const text = textInput.value;
        textInput.value = '';
        transmit(text, currentAudioBlob);
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

