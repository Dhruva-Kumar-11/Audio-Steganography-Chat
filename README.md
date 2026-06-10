<div align="center">
  <img src="https://raw.githubusercontent.com/Dhruva-Kumar-11/Audio-Steganography-Chat/main/public/whispernet_logo_wave_lock_1778614213458.png" alt="WhisperNet Logo" width="200"/>
  <h1>WhisperNet</h1>
  <p><strong>Military-Grade Audio Steganography & Secure Chat Platform</strong></p>
</div>

---

## 🔒 About The Project
WhisperNet is a highly advanced, end-to-end encrypted chat application that leverages **Audio Steganography** to hide secret communications. Instead of sending raw text, WhisperNet encrypts your messages using **AES-256-GCM** and mathematically embeds the cipher directly into the Least Significant Bits (LSB) of an audio file's sound waves. 

To anyone intercepting the network traffic, it sounds like normal audio recordings. Only the intended recipient with the correct passcode can extract and decrypt the hidden payload.

### 🌟 Key Features
- **Covert Steganography Engine**: Embed text payloads into lossless `.wav` audio structures using precise LSB manipulation without altering the audible frequency.
- **End-to-End Encryption (E2EE)**: All hidden payloads are locked using the Web Crypto API (AES-256-GCM).
- **Traffic Masking (Decoy Flood)**: Thwart network surveillance by flooding the connection with random noise packets, masking true communication patterns.
- **Real-Time FFT Visualizer**: Live audio spectrum visualization natively rendered on HTML5 canvas via the Web Audio API.
- **Self-Destruct Sequence**: Automated timed purges to shred your local DOM, history, and File Vault without leaving a trace.
- **Built-in AI Security Console (Dual-Brain)**: 
  - *Live Brain:* Powered by Gemini 1.5 Flash, an unrestricted AI assistant that knows the codebase, understands human psychology, and can answer any general or technical question via Text-to-Speech voice output.
  - *Offline Brain:* A secure fallback pattern matcher that continues to assist with system commands even if the internet goes down.

## 🛠️ Technology Stack
- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism & Cyberpunk aesthetics), JavaScript.
- **Backend**: Node.js, Express.js.
- **Real-time Networking**: Socket.io.
- **Database**: Mongoose (MongoDB) with a fallback to local `users.json` for total offline capabilities.
- **Cryptography & Audio**: Web Crypto API, Web Audio API, Web Speech API (Voice interaction).

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/en/) installed on your local machine.
- (Optional) MongoDB installed and running for database persistence.

### Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Dhruva-Kumar-11/Audio-Steganography-Chat.git
   cd Audio-Steganography-Chat
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the local server:**
   ```bash
   npm start
   ```

4. **Access the application:**
   Open your browser and navigate to `http://localhost:3000`.

## 🕵️ How to use Covert Mode
When you first log in, you will see the standard chat interface. 
1. Click the **WhisperNet Logo** in the top left corner of the header.
2. A glitch animation will trigger, transitioning the UI into **Covert Mode**.
3. In Covert Mode, you will gain access to the Stego Composer, the File Vault, the Message Density meter, and the Audio FFT Visualizer.

## 🤖 Interacting with the AI
WhisperNet features a built-in AI Security Console. 
- Click the glowing AI Orb in the bottom right corner to open the drawer.
- You can type commands, or click the **Microphone (🎙️)** button to speak directly to the AI.
- By default, it operates offline. To unlock its full intelligence, click **Configure** at the top of the AI drawer and input a Gemini API Key.

---
*Developed for absolute privacy and secure communications.*
