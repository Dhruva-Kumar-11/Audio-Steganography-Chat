// 1. GLOBAL SCOPE LOCKDOWN
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let isRecording = false;

// Enforce identity verification
const username = localStorage.getItem('username');
if (!username) {
    window.location.href = '/';
}

const socket = io();

// --- SYSTEM AUDIT LOG LOGIC ---
function addToAuditLog(action) {
    const log = document.getElementById('audit-log');
    if (!log) return;
    const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${timestamp}] > ${action.toUpperCase()}`;
    log.prepend(entry);
    
    // Keep only last 10 entries
    if (log.children.length > 10) {
        log.removeChild(log.lastChild);
    }
}

// --- NETWORK MONITOR LOGIC ---
setInterval(() => {
    const start = Date.now();
    socket.emit('ping', () => {
        const duration = Date.now() - start;
        const pingVal = document.getElementById('ping-val');
        if (pingVal) pingVal.textContent = `${duration}ms`;
    });
}, 5000);

socket.on('user-count', (count) => {
    const userCountVal = document.getElementById('user-count-val');
    if (userCountVal) userCountVal.textContent = count;
});

addToAuditLog("SYSTEM_INITIALIZED");
addToAuditLog("UPLINK_ESTABLISHED");

// --- SECURE VAULT LOGIC ---
function addToVault(audioUrl, fileName) {
    const vaultList = document.getElementById('vault-list');
    if (!vaultList) return;

    const entry = document.createElement('div');
    entry.className = 'vault-entry';
    
    const info = document.createElement('div');
    info.className = 'vault-info';
    info.textContent = fileName.toUpperCase();
    
    const controls = document.createElement('div');
    controls.className = 'vault-controls';
    
    const playBtn = document.createElement('button');
    playBtn.className = 'vault-btn';
    playBtn.textContent = 'PLAY';
    playBtn.onclick = () => {
        const audio = new Audio(audioUrl);
        audio.play();
        addToAuditLog(`VAULT_PLAYBACK: ${fileName}`);
    };
    
    const purgeBtn = document.createElement('button');
    purgeBtn.className = 'vault-btn purge';
    purgeBtn.textContent = 'PURGE';
    purgeBtn.onclick = () => {
        entry.remove();
        addToAuditLog(`VAULT_ITEM_PURGED: ${fileName}`);
    };
    
    controls.appendChild(playBtn);
    controls.appendChild(purgeBtn);
    entry.appendChild(info);
    entry.appendChild(controls);
    vaultList.prepend(entry);
    
    addToAuditLog(`VAULT_ITEM_STORED: ${fileName}`);
}

// DOM Elements
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const sendTextBtn = document.getElementById('send-text-btn');
const textInput = document.getElementById('text-input');
const secretInput = document.getElementById('secret-msg');
const keyInput = document.getElementById('enc-key');
const carrierUpload = document.getElementById('carrier-upload');
const chatFeed = document.getElementById('chat-feed');

// --- 2. GLOBAL RECORDING HANDLERS ---

window.startRecording = async () => {
    try {
        addToAuditLog("RECORD_SESSION_STARTED");
        console.log("RECORDER: Initializing...");
        audioChunks = [];
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(audioStream);
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = async () => {
            const blob = new Blob(audioChunks, { type: "audio/ogg; codecs=opus" });
            console.log("RECORDER: Blob Created");
            
            const secret = secretInput.value;
            const key = keyInput.value;

            const reader = new FileReader();
            reader.readAsDataURL(blob); 
            reader.onloadend = () => {
                const base64Audio = reader.result;
                const payload = {
                    type: 'audio',
                    audio: base64Audio,
                    sender: username,
                    hidden_payload: secret || "",
                    aes_key: key || ""
                };
                sendMessage(payload);
                addToVault(base64Audio, `VOICE_RECON_${Date.now()}.ogg`);
            };

            audioChunks = [];
            secretInput.value = '';
            keyInput.value = '';
        };

        mediaRecorder.start();
        isRecording = true;
        recordBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        stopBtn.classList.add('pulse-recording');
        const micAnim = document.getElementById('mic-animation');
        if (micAnim) micAnim.style.display = 'flex';
    } catch (err) {
        console.error("RECORDER: Start Failure", err);
    }
};

window.stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
    }
    isRecording = false;
    recordBtn.style.display = 'block';
    stopBtn.style.display = 'none';
    stopBtn.classList.remove('pulse-recording');
    const micAnim = document.getElementById('mic-animation');
    if (micAnim) micAnim.style.display = 'none';
};

window.forceStopRecording = (e) => {
    if(e) e.preventDefault();
    window.stopRecording();
};

// --- 3. GLOBAL CLICK LISTENER (THE DECODE WITH UI EFFECTS) ---

window.addEventListener("click", async (e) => {
    if (e.target.classList.contains('decode-btn')) {
        const card = e.target.closest('.message');
        const secretText = card.dataset.payload;
        const correctKey = card.dataset.key;

        if (!secretText) {
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
            addToAuditLog("UNAUTHORIZED_ACCESS_ATTEMPT");
            if(window.showToast) window.showToast("ACCESS_DENIED: UNAUTHORIZED_KEY", true);
        }
    }
});

// --- 4. MESSAGE HANDLING & SOCKETS ---

function sendMessage(payload) {
    addToAuditLog(`TRANSMITTING_${payload.type.toUpperCase()}_DATA`);
    renderMessage(payload, true);
    socket.emit('chat-message', payload);
}

socket.on('chat-message', (payload) => {
    addToAuditLog(`INCOMING_${payload.type.toUpperCase()}_RECEIVED`);
    renderMessage(payload, false);
});

// --- 5. UI RENDERING (THE RECEIVE) ---

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

    if (payload.type === 'text') {
        card.textContent = payload.content;
    } else {
        card.dataset.payload = payload.hidden_payload || "";
        card.dataset.key = payload.aes_key || "";

        const label = document.createElement('div');
        label.style.color = '#888';
        label.style.fontSize = '10px';
        label.style.fontWeight = '700';
        label.style.marginBottom = '8px';
        label.textContent = 'ENCRYPTED_DATA_PACKET';
        card.appendChild(label);

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = payload.audio;
        audio.style.width = '100%';
        audio.style.height = '32px';
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
        card.appendChild(decodeBtn);
    }

    wrapper.appendChild(card);
    chatFeed.appendChild(wrapper);
    chatFeed.scrollTop = chatFeed.scrollHeight;
}

// --- 6. INPUT HANDLERS ---

sendTextBtn.onclick = () => {
    const text = textInput.value;
    if (!text) return;
    sendMessage({ type: 'text', content: text, sender: username });
    textInput.value = '';
};

carrierUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            const base64Audio = reader.result;
            sendMessage({ 
                type: 'audio', 
                audio: base64Audio, 
                sender: username,
                hidden_payload: secretInput.value || "",
                aes_key: keyInput.value || ""
            });
            addToVault(base64Audio, file.name);
            secretInput.value = '';
            keyInput.value = '';
        };
    }
};
