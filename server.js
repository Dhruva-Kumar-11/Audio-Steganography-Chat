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

// Initialize local users file if it doesn't exist
if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([]));
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

// Helper for JSON storage
function getLocalUsers() {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveLocalUser(user) {
    const users = getLocalUsers();
    users.push(user);
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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

// 6. Socket.io handling
const agentRoster = new Map(); // MODULE_B: tracks socket.id -> username

io.on('connection', (socket) => {
    // Update user count for all clients immediately upon connection
    io.emit('user-count', io.engine.clientsCount);
    console.log(`AGENT_CONNECTED. TOTAL_ACTIVE: ${io.engine.clientsCount}`);

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
            io.emit('agent-roster', Array.from(agentRoster.values()));
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
        io.emit('user-count', io.engine.clientsCount);
        console.log(`AGENT_DISCONNECTED. TOTAL_ACTIVE: ${io.engine.clientsCount}`);
        // MODULE_B: Remove from roster on disconnect
        agentRoster.delete(socket.id);
        io.emit('agent-roster', Array.from(agentRoster.values()));
    });
});
