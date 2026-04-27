async function registerUser() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    if (!usernameInput || !passwordInput) {
        alert('Please enter both username and password.');
        return;
    }

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        const text = await response.text();
        alert(text);
    } catch (error) {
        console.error('Registration error:', error);
        alert('Registration failed. See console for details.');
    }
}

async function loginUser() {
    const usernameInput = document.getElementById('username').value;
    const passwordInput = document.getElementById('password').value;

    if (!usernameInput || !passwordInput) {
        alert('Please enter both username and password.');
        return;
    }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        const data = await response.json();
        
        if (data.success) {
            // Store the username in localStorage
            localStorage.setItem('username', usernameInput);
            // Redirect to the chat page
            window.location.href = '/chat.html';
        } else {
            alert('Login failed: ' + (data.message || 'Invalid credentials.'));
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('Login failed. See console for details.');
    }
}
