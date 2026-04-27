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
            };

            audioChunks = [];
            secretInput.value = '';
            keyInput.value = '';
        };

        mediaRecorder.start();
        isRecording = true;
        recordBtn.style.display = 'none';
        stopBtn.style.display = 'block';
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
        progressBar.style.animation = 'progress 1.5s linear forwards';

        // Wait 1.5s for "Scanning" effect
        await new Promise(resolve => setTimeout(resolve, 1500));

        progressContainer.style.display = 'none';
        progressBar.style.animation = 'none';
        e.target.textContent = originalText;
        e.target.disabled = false;

        const pass = prompt("ENTER DECRYPTION KEY:");
        if (!pass) return;

        if (pass === correctKey) {
            const reveal = document.createElement('div');
            reveal.style.color = 'var(--neon-cyan)';
            reveal.style.textShadow = '0 0 15px var(--neon-cyan)';
            reveal.style.marginTop = '15px';
            reveal.style.padding = '12px';
            reveal.style.background = 'rgba(0, 255, 255, 0.1)';
            reveal.style.border = '1px solid var(--neon-cyan)';
            reveal.style.fontFamily = 'Share Tech Mono, monospace';
            reveal.style.fontWeight = 'bold';
            reveal.style.position = 'relative';
            
            const msgSpan = document.createElement('span');
            msgSpan.textContent = `> INTERCEPTED: ${secretText}`;
            reveal.appendChild(msgSpan);

            const timerSpan = document.createElement('span');
            timerSpan.className = 'timer-display';
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
                reveal.style.textShadow = "none";
                reveal.style.borderColor = "#333";
                timerSpan.remove();
                setTimeout(() => reveal.remove(), 2000);
            }, 15000);
        } else {
            if(window.showToast) window.showToast("ACCESS_DENIED: UNAUTHORIZED_KEY", true);
        }
    }
});

// --- 4. MESSAGE HANDLING & SOCKETS ---

function sendMessage(payload) {
    renderMessage(payload, true);
    socket.emit('chat-message', payload);
}

socket.on('chat-message', (payload) => {
    renderMessage(payload, false);
});

// --- 5. UI RENDERING (THE RECEIVE) ---

function renderMessage(payload, isMe) {
    const wrapper = document.createElement('div');
    wrapper.className = 'message-wrapper';
    wrapper.style.alignSelf = isMe ? 'flex-end' : 'flex-start';
    wrapper.style.marginBottom = '25px';

    const senderLabel = document.createElement('div');
    senderLabel.className = 'sender-tag';
    senderLabel.textContent = isMe ? 'YOU' : (payload.sender || 'UNKNOWN');
    wrapper.appendChild(senderLabel);

    const card = document.createElement('div');
    card.className = `message ${payload.type}`;
    card.style.border = isMe ? '1px solid var(--neon-cyan)' : '1px solid var(--neon-pink)';
    card.style.padding = '18px';
    card.style.background = 'rgba(10, 10, 10, 0.95)';

    if (payload.type === 'text') {
        card.textContent = payload.content;
    } else {
        card.dataset.payload = payload.hidden_payload || "";
        card.dataset.key = payload.aes_key || "";

        const label = document.createElement('div');
        label.style.color = isMe ? 'var(--neon-cyan)' : 'var(--neon-pink)';
        label.style.fontSize = '12px';
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '12px';
        label.textContent = '> ENCRYPTED AUDIO PAYLOAD';
        card.appendChild(label);

        const audio = document.createElement('audio');
        audio.controls = true;
        audio.src = payload.audio;
        audio.style.width = '100%';
        card.appendChild(audio);

        // Progress Bar for Decrypting animation
        const progContainer = document.createElement('div');
        progContainer.className = 'progress-container';
        const progBar = document.createElement('div');
        progBar.className = 'progress-bar';
        progContainer.appendChild(progBar);
        card.appendChild(progContainer);

        const decodeBtn = document.createElement('button');
        decodeBtn.className = 'decode-btn';
        decodeBtn.textContent = 'DECODE_PAYLOAD';
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
            sendMessage({ 
                type: 'audio', 
                audio: reader.result, 
                sender: username,
                hidden_payload: secretInput.value || "",
                aes_key: keyInput.value || ""
            });
            secretInput.value = '';
            keyInput.value = '';
        };
    }
};
