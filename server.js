const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Increase maxHttpBufferSize to 10MB (1e7) to handle lossless WAV data
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('audio-data', (data) => {
        console.log("SERVER: Received audio from a client, broadcasting now...");
        // Broadcast the audio data to all other connected clients
        socket.broadcast.emit('audio-stream', data);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
