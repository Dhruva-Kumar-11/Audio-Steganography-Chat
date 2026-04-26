const socket = io();
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// DOM Elements
const recordBtn = document.getElementById('record-btn');
const sendTextBtn = document.getElementById('send-text-btn');
const textInput = document.getElementById('text-input');
const secretInput = document.getElementById('secret-msg');
const keyInput = document.getElementById('enc-key');
const carrierUpload = document.getElementById('carrier-upload');
const messagesDiv = document.getElementById('messages');

const stagingArea = document.getElementById('staging-area');
const sendStagedBtn = document.getElementById('send-staged-btn');
const cancelStagedBtn = document.getElementById('cancel-staged-btn');

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let pendingAudioBlob = null;
let stagingWs = null;

// Configuration for Ultrasonic FSK
const FREQ_0 = 18500;
const FREQ_1 = 19000;
const BIT_DURATION = 0.05;

// --- 1. CORE LOGIC (FSK & AES) ---

function encrypt(text, password) {
    return CryptoJS.AES.encrypt(text, password).toString();
}

function decrypt(ciphertext, password) {
    try {
        const bytes = CryptoJS.AES.decrypt(ciphertext, password);
        return bytes.toString(CryptoJS.enc.Utf8) || null;
    } catch (e) { return null; }
}

async function injectData(audioBlob, dataString) {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    const bits = [];
    for (let i = 0; i < dataString.length; i++) {
        const charCode = dataString.charCodeAt(i);
        for (let j = 7; j >= 0; j--) bits.push((charCode >> j) & 1);
    }

    const offlineCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length + (bits.length * BIT_DURATION * audioBuffer.sampleRate),
        audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    let startTime = 0;
    bits.forEach(bit => {
        const osc = offlineCtx.createOscillator();
        const gain = offlineCtx.createGain();
        osc.frequency.value = bit === 1 ? FREQ_1 : FREQ_0;
        gain.gain.setValueAtTime(0.1, startTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, startTime + BIT_DURATION);
        osc.connect(gain);
        gain.connect(offlineCtx.destination);
        osc.start(startTime);
        osc.stop(startTime + BIT_DURATION);
        startTime += BIT_DURATION;
    });

    const renderedBuffer = await offlineCtx.startRendering();
    return bufferToWavBlob(renderedBuffer);
}

async function extractData(audioBlob) {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    const data = audioBuffer.getChannelData(0);
    const sampleRate = audioBuffer.sampleRate;
    const bits = [];
    const samplesPerBit = BIT_DURATION * sampleRate;
    
    for (let i = 0; i < data.length; i += samplesPerBit) {
        const chunk = data.slice(i, i + samplesPerBit);
        if (chunk.length < samplesPerBit) break;
        const power0 = getFrequencyPower(chunk, FREQ_0, sampleRate);
        const power1 = getFrequencyPower(chunk, FREQ_1, sampleRate);
        if (power0 > 0.001 || power1 > 0.001) bits.push(power1 > power0 ? 1 : 0);
    }

    let result = "";
    for (let i = 0; i < bits.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
        if (byte === 0) break;
        result += String.fromCharCode(byte);
    }
    return result;
}

function getFrequencyPower(buffer, targetFreq, sampleRate) {
    let real = 0, imag = 0;
    for (let n = 0; n < buffer.length; n++) {
        const angle = (2 * Math.PI * targetFreq * n) / sampleRate;
        real += buffer[n] * Math.cos(angle);
        imag += buffer[n] * Math.sin(angle);
    }
    return Math.sqrt(real * real + imag * imag) / buffer.length;
}

function bufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels,
        length = buffer.length * numOfChan * 2 + 44,
        bufferArr = new ArrayBuffer(length),
        view = new DataView(bufferArr),
        channels = [];
    let i, sample, offset = 0, pos = 0;

    const setUint16 = d => { view.setUint16(pos, d, true); pos += 2; };
    const setUint32 = d => { view.setUint32(pos, d, true); pos += 4; };

    setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
    setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
    setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

    for(i = 0; i < numOfChan; i++) channels.push(buffer.getChannelData(i));
    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {
            sample = Math.max(-1, Math.min(1, channels[i][offset]));
            sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0;
            view.setInt16(pos, sample, true); pos += 2;
        }
        offset++;
    }
    return new Blob([bufferArr], { type: "audio/wav" });
}

// --- 2. HYBRID MESSAGING ---

sendTextBtn.onclick = () => {
    const text = textInput.value;
    if (!text) return;
    const payload = { type: 'text', content: text };
    socket.emit('audio-data', payload);
    renderMessage(payload, true);
    textInput.value = '';
};

// Modified: This now handles the STAGED emission
sendStagedBtn.onclick = async () => {
    if (!pendingAudioBlob) return;

    const secret = secretInput.value;
    const key = keyInput.value;
    let finalBlob = pendingAudioBlob;

    if (secret && key) {
        sendStagedBtn.disabled = true;
        sendStagedBtn.textContent = '🔒 MODULATING...';
        const encrypted = encrypt(secret, key);
        finalBlob = await injectData(pendingAudioBlob, encrypted);
    }

    const buffer = await finalBlob.arrayBuffer();
    const payload = { type: 'stego', audio: buffer };
    socket.emit('audio-data', payload);
    renderMessage(payload, true);
    
    clearStaging();
};

cancelStagedBtn.onclick = () => {
    clearStaging();
};

function clearStaging() {
    pendingAudioBlob = null;
    stagingArea.style.display = 'none';
    if (stagingWs) {
        stagingWs.destroy();
        stagingWs = null;
    }
    secretInput.value = '';
    keyInput.value = '';
    sendStagedBtn.disabled = false;
    sendStagedBtn.textContent = '🚀 HIDE & SEND SECURE PAYLOAD';
}

function stageAudio(blob) {
    pendingAudioBlob = blob;
    stagingArea.style.display = 'flex';
    
    if (stagingWs) stagingWs.destroy();
    
    stagingWs = WaveSurfer.create({
        container: '#staging-waveform',
        waveColor: '#00ff41',
        progressColor: '#fff',
        height: 60,
    });
    
    const url = URL.createObjectURL(blob);
    stagingWs.load(url);
}

// --- 3. UI RENDERING (WAVESURFER & SELF-DESTRUCT) ---

function renderMessage(payload, isMe) {
    const div = document.createElement('div');
    div.className = `message ${payload.type}`;
    div.style.alignSelf = isMe ? 'flex-end' : 'flex-start';

    if (payload.type === 'text') {
        div.textContent = payload.content;
    } else {
        const wavesContainer = document.createElement('div');
        wavesContainer.id = 'ws-' + Math.random().toString(36).substr(2, 9);
        div.appendChild(wavesContainer);

        const indicator = document.createElement('span');
        indicator.className = 'stego-indicator';
        indicator.textContent = '🔒';
        div.appendChild(indicator);

        const audioBlob = new Blob([payload.audio], { type: 'audio/wav' });
        const url = URL.createObjectURL(audioBlob);

        setTimeout(() => {
            const ws = WaveSurfer.create({
                container: '#' + wavesContainer.id,
                waveColor: isMe ? '#00ff41' : '#ff4444',
                progressColor: '#fff',
                height: 50,
            });
            ws.load(url);
            div.onclick = () => ws.playPause();
            div.ondblclick = () => handleSelfDestruct(audioBlob, div);
        }, 0);
    }

    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

let pendingCipherBlob = null;
let pendingDiv = null;

async function handleSelfDestruct(blob, div) {
    const hiddenData = await extractData(blob);
    if (!hiddenData) {
        alert("No hidden sequence detected.");
        return;
    }
    
    pendingCipherBlob = blob;
    pendingDiv = div;
    document.getElementById('decrypt-modal').style.display = 'block';
    document.getElementById('modal-overlay').style.display = 'block';
}

document.getElementById('submit-decrypt').onclick = () => {
    const pass = document.getElementById('modal-pass').value;

    extractData(pendingCipherBlob).then(cipher => {
        const clear = decrypt(cipher, pass);
        if (clear) {
            const p = document.createElement('div');
            p.className = 'destruct-text';
            p.textContent = `[DECRYPTED]: ${clear}`;
            pendingDiv.prepend(p);
            closeModal();
            
            setTimeout(() => {
                p.textContent = "[MESSAGE DESTROYED]";
                p.style.color = "#444";
                setTimeout(() => p.remove(), 2000);
            }, 10000);
        } else {
            alert("ACCESS DENIED: INCORRECT AES KEY");
        }
    });
    document.getElementById('modal-pass').value = '';
};

// --- 4. INPUT HANDLERS ---

carrierUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        stageAudio(blob);
    }
};

async function initRecorder() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.onstop = () => {
            const blob = new Blob(audioChunks, { type: 'audio/wav' });
            audioChunks = [];
            stageAudio(blob);
        };
        recordBtn.disabled = false;
    } catch (err) { recordBtn.textContent = 'MIC ERROR'; }
}

initRecorder();

recordBtn.onclick = () => {
    if (!mediaRecorder) return;
    if (!isRecording) {
        audioChunks = [];
        mediaRecorder.start();
        isRecording = true;
        recordBtn.textContent = '🛑 STOP';
        recordBtn.style.background = '#ff4444';
    } else {
        mediaRecorder.stop();
        isRecording = false;
        recordBtn.textContent = '🎤 RECORD';
        recordBtn.style.background = '';
    }
};

socket.on('audio-stream', (payload) => {
    renderMessage(payload, false);
});
