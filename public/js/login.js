// Login logic
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const errorMsg = document.getElementById('errorMsg');
  const togglePass = document.getElementById('togglePass');
  const loginBtn = document.getElementById('loginBtn');

  // Toggle password visibility
  togglePass.addEventListener('click', () => {
    if (passwordInput.type === 'password') {
      passwordInput.type = 'text';
      togglePass.textContent = '🙈';
    } else {
      passwordInput.type = 'password';
      togglePass.textContent = '👁️';
    }
  });

  // Handle login
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = usernameInput.value.trim().toLowerCase();
    const password = passwordInput.value.trim();

    if (!username || !password) {
      showError('Please fill in all fields!');
      return;
    }

    // Show loading
    loginBtn.querySelector('.btn-text').style.display = 'none';
    loginBtn.querySelector('.btn-loader').style.display = 'inline';
    loginBtn.disabled = true;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (data.success) {
        // Success animation
        document.querySelector('.login-box').style.animation = 'fadeOut 0.5s ease forwards';
        setTimeout(() => {
          window.location.href = '/chat';
        }, 500);
      } else {
        showError(data.message || 'Login failed!');
        shakeForm();
      }
    } catch (err) {
      showError('Connection error!');
    } finally {
      loginBtn.querySelector('.btn-text').style.display = 'inline';
      loginBtn.querySelector('.btn-loader').style.display = 'none';
      loginBtn.disabled = false;
    }
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    setTimeout(() => {
      errorMsg.textContent = '';
    }, 3000);
  }

  function shakeForm() {
    const box = document.querySelector('.login-box');
    box.style.animation = 'shake 0.5s ease';
    setTimeout(() => {
      box.style.animation = '';
    }, 500);
  }

  // Add shake animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20% { transform: translateX(-10px); }
      40% { transform: translateX(10px); }
      60% { transform: translateX(-10px); }
      80% { transform: translateX(10px); }
    }
    @keyframes fadeOut {
      to { opacity: 0; transform: scale(0.95); }
    }
  `;
  document.head.appendChild(style);
});