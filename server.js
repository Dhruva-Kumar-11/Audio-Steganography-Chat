const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');

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
const LOCAL_MONGO_URI = 'mongodb://127.0.0.1:27017/ChatAppDB';

mongoose.connect(LOCAL_MONGO_URI, {
    serverSelectionTimeoutMS: 5000 // Fast fail for local
})
  .then(() => {
    console.log("Connected to Local MongoDB successfully");
    isUsingMongoDB = true;
    startServer();
  })
  .catch(err => {
    console.warn("Local MongoDB not found. Falling back to local 'users.json' file.");
    console.log("Check if MongoDB service is running on your machine.");
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
app.post('/register', async (req, res) => {
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
io.on('connection', (socket) => {
    socket.on('audio-data', (data) => {
        socket.broadcast.emit('audio-stream', data);
    });

    socket.on('chat-message', (data) => {
        socket.broadcast.emit('chat-message', data);
    });
});
