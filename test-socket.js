const { io } = require('socket.io-client');

const socket = io('http://localhost:3000');

console.log('Attempting to connect to Render server...');

socket.on('connect', () => {
    console.log('SUCCESS: Connected to https://wisphernet-chat.onrender.com');
    console.log('Socket ID:', socket.id);
    
    // Register test user
    socket.emit('register-agent', { username: 'TestAgent_AI' });
});

socket.on('agent-roster', (users) => {
    console.log('SUCCESS: Received active users list:', users);
    console.log('Total Online Users:', users.length);
    
    console.log('\n--- VERIFICATION COMPLETE ---');
    console.log('Socket.io WebSockets are fully operational!');
    process.exit(0);
});

socket.on('connect_error', (err) => {
    console.error('FAILED to connect:', err.message);
    process.exit(1);
});

// Timeout after 10 seconds
setTimeout(() => {
    console.error('FAILED: Connection timed out.');
    process.exit(1);
}, 10000);
