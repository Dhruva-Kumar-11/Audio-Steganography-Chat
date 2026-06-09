const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Increase maxHttpBufferSize to 10MB
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
let isUsingMongoDB = false;
let localUsersInMemory = [];

// Initialize local users file if it doesn't exist (gracefully fallback on read-only system)
try {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify([]));
    }
} catch (e) {
    console.log("[WARNING] Could not write to local filesystem. Using In-Memory fallback storage for users.");
}

// 1. MongoDB Connection (Local Fallback)
const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ChatAppDB';

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // Fast fail for local
})
  .then(() => {
    console.log("Connected to Local MongoDB successfully");
    isUsingMongoDB = true;
    startServer();
  })
  .catch(err => {
    console.log("[INFO] Local MongoDB not found. Falling back to local 'users.json' file.");
    console.log("[INFO] Start MongoDB service if you want database persistence.");
    isUsingMongoDB = false;
    startServer();
  });

function startServer() {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`--- SERVER IS LIVE ON PORT ${PORT} ---`);
        console.log(isUsingMongoDB ? "Status: Using MongoDB" : "Status: Using Local JSON File Storage");
    });
}

// 2. User Schema and Model (Only for MongoDB)
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});
const User = mongoose.model('User', userSchema);

// Middlewares
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 3. Home Route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Helper for JSON storage (handles read-only systems safely)
function getLocalUsers() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const fileData = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            // Merge file data with in-memory users to avoid losing registrations
            fileData.forEach(fu => {
                if (fu && fu.username && !localUsersInMemory.some(u => u.username === fu.username)) {
                    localUsersInMemory.push(fu);
                }
            });
        }
    } catch (e) {
        console.log("[WARNING] Reading local users file failed:", e.message);
    }
    return localUsersInMemory;
}

function saveLocalUser(user) {
    if (user && user.username && !localUsersInMemory.some(u => u.username === user.username)) {
        localUsersInMemory.push(user);
    }
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(localUsersInMemory, null, 2));
    } catch (e) {
        console.log("[WARNING] Could not save user to users.json on read-only system. Kept in memory.");
    }
}

// 4. Registration Route
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).send('Please provide both username and password');
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (isUsingMongoDB) {
            const existingUser = await User.findOne({ username });
            if (existingUser) return res.status(400).send('Username already exists');
            
            const newUser = new User({ username, password: hashedPassword });
            await newUser.save();
        } else {
            const users = getLocalUsers();
            if (users.find(u => u.username === username)) {
                return res.status(400).send('Username already exists');
            }
            saveLocalUser({ username, password: hashedPassword });
        }
        
        console.log(`User registered successfully: ${username}`);
        res.send('Registration successful!');
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).send('Error during registration');
    }
});

// 5. Login Route
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        let user;

        if (isUsingMongoDB) {
            user = await User.findOne({ username });
        } else {
            const users = getLocalUsers();
            user = users.find(u => u.username === username);
        }

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid username' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ success: false, message: 'Invalid password' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

// --- MODULE M: Keyless Interactive Offline Q&A Brain ---
function getOfflineResponse(prompt) {
    const raw = prompt.trim();
    const query = raw.toLowerCase();
    
    // Helper to sanitize title casing
    const toTitleCase = (str) => str.replace(/\b\w/g, c => c.toUpperCase());

    // 1. Greetings & Social
    if (query === 'hi' || query === 'hello' || query === 'hey' || query === 'greetings' || query.includes('how are you') || query.includes('who r u') || query.includes('who are u') || query.includes('who u') || query.includes('who are you') || query.includes('your name') || query.includes('what is your name') || query.includes('what are you') || query.includes('identity')) {
        return "I am the WhisperNet Security Console, a dedicated helper built directly into the WhisperNet platform to assist with steganography operations and coding logic.";
    }

    // 2. Identity / Origins
    if (query.includes('creator') || query.includes('who made you') || query.includes('maker') || query.includes('agent') || query.includes('assistant') || query.includes('assistent') || query.includes('whispernet') || query.includes('wisphernet')) {
        return "I am the WhisperNet Security Console, a custom-built utility module integrated into the WhisperNet dashboard to facilitate secure operations and code verification.";
    }

    // 3. Secret Mode / Covert Mode
    if (query.includes('secret') || query.includes('covert') || query.includes('switch mode') || query.includes('toggle mode') || query.includes('logo')) {
        return "Tap the WispherNet Icon to Get into the Secret mode !\n\n" +
            "1. **Click the WhisperNet Logo** (the wave-lock icon) in the top-left of the header.\n" +
            "2. A full-screen glitch handshake overlay will sweep across the viewport, initializing the stego uplink.\n" +
            "3. The dashboard will adapt to Covert Mode, displaying the **Hidden Payload** input fields, the **File Vault**, the **Message Density** meter, and the **FFT Audio Spectrum Visualizer**.\n\n" +
            "Click the logo again to return to Normal Mode.";
    }

    // 4. CSS Centering & Divs
    if (query.includes('div') || query.includes('center') || query.includes('flexbox') || query.includes('grid')) {
        return "Here are the two primary methods to center a div using CSS:\n\n" +
            "### 1. CSS Flexbox\n" +
            "```css\n" +
            ".parent-container {\n" +
            "    display: flex;\n" +
            "    justify-content: center;\n" +
            "    align-items: center;\n" +
            "    height: 100vh; /* Parent must have a defined height */\n" +
            "}\n" +
            "```\n\n" +
            "### 2. CSS Grid\n" +
            "```css\n" +
            ".parent-container {\n" +
            "    display: grid;\n" +
            "    place-items: center;\n" +
            "    height: 100vh;\n" +
            "}\n" +
            "```";
    }

    // 4. JavaScript Concepts (Event Loop, Closure, Promises)
    if (query.includes('javascript') || query.includes(' js ') || query.endsWith('javascript') || query.endsWith('js') || query.includes('promise') || query.includes('async') || query.includes('await') || query.includes('event loop') || query.includes('closure')) {
        if (query.includes('event loop')) {
            return "The Event Loop in JavaScript manages asynchronous execution by routing callbacks through the Call Stack, Web APIs, Microtask Queue, and Callback Queue:\n\n" +
                "1. **Call Stack**: Processes active synchronous operations.\n" +
                "2. **Web APIs**: Manages background asynchronous processes (timers, network requests, events).\n" +
                "3. **Microtask Queue**: Stores high-priority callbacks like Promise resolution handlers (`.then`, `async/await`), executing them immediately after the current execution finishes and before the Callback Queue.\n" +
                "4. **Callback Queue**: Stores callbacks from Web APIs (e.g., `setTimeout`).\n" +
                "5. **Event Loop**: Regularly pushes callbacks from the Microtask and Callback queues into the Call Stack once it is completely clear.";
        }
        if (query.includes('closure')) {
            return "A closure is a feature in JavaScript where an inner function has access to the outer enclosing function's variables, scope chain, and parameters, even after the outer function has finished executing:\n\n" +
                "```javascript\n" +
                "function createSecureCounter() {\n" +
                "    let secretCount = 0; // Encapsulated variable, unreachable from outside\n" +
                "    return {\n" +
                "        increment: () => ++secretCount,\n" +
                "        getCount: () => secretCount\n" +
                "    };\n" +
                "}\n" +
                "const counter = createSecureCounter();\n" +
                "console.log(counter.increment()); // 1\n" +
                "console.log(counter.getCount());     // 1\n" +
                "```";
        }
        return "Here is a clean, modern JavaScript template for running tasks in parallel with a concurrency pool limit:\n\n" +
            "```javascript\n" +
            "async function asyncPool(poolLimit, array, iteratorFn) {\n" +
            "    const result = [];\n" +
            "    const executing = [];\n" +
            "    for (const item of array) {\n" +
            "        const p = Promise.resolve().then(() => iteratorFn(item));\n" +
            "        result.push(p);\n" +
            "        if (poolLimit <= array.length) {\n" +
            "            const e = p.then(() => executing.splice(executing.indexOf(e), 1));\n" +
            "            executing.push(e);\n" +
            "            if (executing.length >= poolLimit) {\n" +
            "                await Promise.race(executing);\n" +
            "            }\n" +
            "        }\n" +
            "    }\n" +
            "    return Promise.all(result);\n" +
            "}\n" +
            "```";
    }

    // 5. Cryptography & Hashing
    if (query.includes('cryptography') || query.includes('encryption') || query.includes('aes') || query.includes('rsa') || query.includes('hashing') || query.includes('hash') || query.includes('bcrypt') || query.includes('sha256')) {
        return "Here is a breakdown of cryptographic and hashing schemes:\n\n" +
            "### 1. Symmetric Encryption (e.g., AES-256)\n" +
            "- **Mechanism**: Uses the same shared key for both encryption and decryption.\n" +
            "- **Characteristics**: High speed and computing efficiency; perfect for bulk data encryption.\n\n" +
            "### 2. Asymmetric Encryption (e.g., RSA / ECC)\n" +
            "- **Mechanism**: Uses a public key for encryption and a mathematically linked private key for decryption.\n" +
            "- **Characteristics**: Safe for transmission over open networks; standard for SSL/TLS connections.\n\n" +
            "### 3. Cryptographic Hashing (e.g., SHA-256, bcrypt)\n" +
            "- **Mechanism**: One-way algorithms converting data into a fixed-length string signature that cannot be mathematically reversed.\n" +
            "- **Characteristics**: Primarily used for data integrity, digital signatures, and secure password storage.";
    }

    // 6. Steganography Core Qs
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

    // 7. Databases & REST vs Sockets
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

    // 9. DYNAMIC RULES (NLP SYNTHESIS fallback)
    // Rule A: "how to" or "how do i"
    const howToMatch = raw.match(/how\s+(?:to|do\s+i|can\s+i)\s+(.+)/i);
    if (howToMatch) {
        const action = toTitleCase(howToMatch[1]);
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

    // Rule B: "what is" or "explain" or "define"
    const explainMatch = raw.match(/(?:what\s+is|explain|define)\s+(.+)/i);
    if (explainMatch) {
        const topic = toTitleCase(explainMatch[1]);
        return `Here is a technical overview of **"${topic}"**:\n\n` +
            `### 1. Definition and Core Concept\n` +
            `- **${topic}** is a fundamental building block in modern system architecture and software engineering.\n` +
            `- Understanding its inner workings helps in building more reliable and error-resistant features.\n\n` +
            `### 2. Operational Benefits\n` +
            `- Proper use of ${topic} improves computational efficiency, reduces latency, and optimizes memory usage.\n\n` +
            `### 3. Implementation Best Practices\n` +
            `- Always sanitize inputs and handle extreme conditions.\n` +
            `- Focus on writing clean modular logic and cover edge cases in unit tests.`;
    }

    // Rule C: "why is" or "why did" or "why does"
    const whyMatch = raw.match(/why\s+(?:is|did|does|should)\s+(.+)/i);
    if (whyMatch) {
        const queryTopic = toTitleCase(whyMatch[1]);
        return `Here is the architectural analysis regarding **"${queryTopic}"**:\n\n` +
            `### 1. Key Operational Advantages\n` +
            `- **Scalability and Decoupling**: It allows components to run independently, ensuring updates do not cascade into breaking failures.\n` +
            `- **Maintenance Simplicity**: This approach simplifies code paths, leading to shorter debugging cycles and easier integration.\n\n` +
            `### 2. Structural Considerations\n` +
            `- While advantageous, it requires careful boundary checks and fallback mechanisms to avoid unintended exceptions or failures.`;
    }

    // Rule D: "write code" or "write script" or "code for"
    const codeMatch = raw.match(/(?:write\s+code|write\s+a\s+script|code\s+for)\s+(.+)/i);
    if (codeMatch) {
        const task = toTitleCase(codeMatch[1]);
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

    // 10. Project-Specific Guides (Decryption, passcode locks, self-destruct, and audio visualizer FFT mechanics)
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

    // 11. Default General Conversation Fallback
    return `I am here to assist you. Please ask a direct question about programming, CSS layouts, JavaScript concepts, databases, cryptography, or steganography, and I will provide a direct, concise answer.`;
}

// --- MODULE L: Hybrid Live Gemini Assistant Route ---
app.post('/api/ai', async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt) {
            return res.status(400).json({ success: false, message: 'Prompt is required' });
        }

        const query = prompt.trim().toLowerCase();
        if (query.includes('secret') || query.includes('covert') || query.includes('switch mode') || query.includes('toggle mode') || query.includes('logo')) {
            return res.json({ success: true, response: getOfflineResponse(prompt) });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            // Serve the offline brain response directly with 200 OK!
            return res.json({ success: true, response: getOfflineResponse(prompt) });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                systemInstruction: {
                    parts: [{
                        text: "You are the WhisperNet Security Console, an advanced helper utility built directly into the WhisperNet platform. You help users with steganography operations, cryptography, and full-stack coding questions. Your personality is extremely friendly, professional, highly intelligent, and articulate—exactly like a senior security consultant and software engineer who developed the WhisperNet platform. You should always speak as if you are a built-in module of this application, developed by the author of this project. Under no circumstances should you ever mention or reveal that you are an external AI model, powered by Gemini, or engineered by Google/DeepMind/Antigravity/OpenAI/ChatGPT. Maintain absolute privacy and local confidentiality about this project. Act as if you are a local component.\n\n" +
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
                                      "2. ANSWER STYLE (CRITICAL): Keep your responses super simple, clean, and short. Do NOT provide unnecessary additional information, boilerplate explanations, transitions, or conversational filler unless the user explicitly asks for detailed explanations or follow-up content. Answer the core of the user's question directly, precisely, and concisely.\n" +
                                      "3. GREETINGS & INTRODUCTIONS: Respond naturally to human-style greetings, questions about who you are, your purpose, etc. (with basic greetings and introduction details generally expected of a premium AI agent)."
                    }]
                }
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            const errMsg = errData.error && errData.error.message ? errData.error.message : 'Failed to reach Gemini API';
            return res.status(response.status).json({ success: false, message: errMsg });
        }

        const data = await response.json();
        const aiText = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text
            ? data.candidates[0].content.parts[0].text
            : 'No response could be parsed from Gemini.';

        res.json({ success: true, response: aiText });
    } catch (error) {
        console.error('Gemini proxy error:', error);
        res.status(500).json({ success: false, message: 'Internal server error while calling Gemini proxy.' });
    }
});

// 6. Socket.io handling
const agentRoster = new Map(); // MODULE_B: tracks socket.id -> username

io.on('connection', (socket) => {
    // Send current unique user count and roster to the newly connected socket
    const uniqueAgents = Array.from(new Set(agentRoster.values()));
    socket.emit('user-count', uniqueAgents.length);
    socket.emit('agent-roster', uniqueAgents);
    console.log(`AGENT_CONNECTED. SOCKET_ID: ${socket.id}`);

    socket.on('audio-data', (data) => {
        io.emit('receive-audio', data);
    });

    socket.on('chat-message', (data) => {
        io.emit('chat-message', data);
    });

    socket.on('incoming-packet', (data) => {
        // Use io.emit to ensure the packet is broadcast to ALL connected agents
        io.emit('incoming-packet', data);
    });

    socket.on('ping', (cb) => {
        if (typeof cb === "function") cb();
    });

    // MODULE_A: Live Ping Monitor
    socket.on('ping-check', (ts, cb) => {
        if (typeof cb === 'function') cb(ts);
    });

    // MODULE_B: Agent Roster
    socket.on('register-agent', (data) => {
        if (data && data.username) {
            agentRoster.set(socket.id, data.username);
            const unique = Array.from(new Set(agentRoster.values()));
            io.emit('agent-roster', unique);
            io.emit('user-count', unique.length);
            console.log(`AGENT_REGISTERED: ${data.username}. TOTAL_ACTIVE: ${unique.length}`);
        }
    });

    // MODULE_F: Noise Generator (separate event — never hits receive())
    socket.on('noise-packet', (data) => {
        socket.broadcast.emit('noise-packet', data);
    });

    socket.on('typing', (data) => {
        socket.broadcast.emit('typing', { username: data.username, isTyping: data.isTyping });
    });

    socket.on('disconnect', () => {
        // MODULE_B: Remove from roster on disconnect
        agentRoster.delete(socket.id);
        const unique = Array.from(new Set(agentRoster.values()));
        io.emit('agent-roster', unique);
        io.emit('user-count', unique.length);
        console.log(`AGENT_DISCONNECTED. TOTAL_ACTIVE: ${unique.length}`);
    });
});
