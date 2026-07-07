const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 50 * 1024 * 1024 });

const PORT = 3000;

const USERS = {
  'anonymous': 'why',
  'zarin': 'zarin34',
  'arif': 'arif123',
  'tania': 'tania123'
};

const sessionMiddleware = session({
  secret: 'justforyou-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
io.engine.use(sessionMiddleware);

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(path.join(__dirname, 'public', 'icons'))) fs.mkdirSync(path.join(__dirname, 'public', 'icons'), { recursive: true });
if (!fs.existsSync(path.join(__dirname, 'public', 'sounds'))) fs.mkdirSync(path.join(__dirname, 'public', 'sounds'), { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// Generate notification sound if not exists
const soundPath = path.join(__dirname, 'public', 'sounds', 'notify.mp3');
if (!fs.existsSync(soundPath)) {
  // Create a simple beep sound as a base64 wav
  // We'll generate it client-side instead
}

// Generate simple PNG icons if not exist
function createSimpleIcon(size, filepath) {
  if (fs.existsSync(filepath)) return;
  // Create a minimal valid PNG (1x1 purple pixel, browser will scale)
  // For production, replace with real icons
  const { createCanvas } = (() => {
    try { return require('canvas'); } catch (e) { return { createCanvas: null }; }
  })();

  if (createCanvas) {
    const c = createCanvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7c5cfc';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${size * 0.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('JFY', size / 2, size / 2);
    fs.writeFileSync(filepath, c.toBuffer('image/png'));
  }
}

app.use('/uploads', express.static('uploads'));
app.use(express.static('public'));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/chat');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/chat', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (USERS[username] && USERS[username] === password) {
    req.session.user = username;
    return res.json({ success: true, user: username });
  }
  res.json({ success: false, message: 'Wrong username or password!' });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) return res.json({ loggedIn: true, user: req.session.user });
  res.json({ loggedIn: false });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.post('/api/upload', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({
      success: true,
      file: {
        url: '/uploads/' + req.file.filename,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size
      }
    });
  });
});

// Socket.IO
const onlineUsers = new Map();
const reactions = new Map();

io.on('connection', (socket) => {
  const sess = socket.request.session;
  if (!sess || !sess.user) { socket.disconnect(); return; }

  const username = sess.user;
  onlineUsers.set(socket.id, username);
  io.emit('onlineUsers', [...new Set(onlineUsers.values())]);

  socket.on('sendMessage', (data) => {
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      sender: username,
      text: data.text || '',
      replyTo: data.replyTo || null,
      file: data.file || null,
      voice: data.voice || null,
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    };
    io.emit('newMessage', msg);
  });

  socket.on('sendVoice', (data) => {
    const msg = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      sender: username,
      text: '',
      replyTo: data.replyTo || null,
      file: null,
      voice: { data: data.audioData, duration: data.duration || 0 },
      timestamp: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
    };
    io.emit('newMessage', msg);
  });

  socket.on('deleteMessage', (msgId) => {
    io.emit('messageDeleted', { id: msgId, deletedBy: username });
    reactions.delete(msgId);
  });

  socket.on('reactMessage', (data) => {
    const { msgId, emoji } = data;
    if (!msgId || !emoji) return;
    if (!reactions.has(msgId)) reactions.set(msgId, {});
    const mr = reactions.get(msgId);
    if (!mr[emoji]) mr[emoji] = new Set();
    let action;
    if (mr[emoji].has(username)) {
      mr[emoji].delete(username);
      action = 'remove';
      if (mr[emoji].size === 0) delete mr[emoji];
    } else {
      mr[emoji].add(username);
      action = 'add';
    }
    io.emit('messageReaction', { msgId, emoji, user: username, action });
  });

  socket.on('typing', () => socket.broadcast.emit('userTyping', username));
  socket.on('stopTyping', () => socket.broadcast.emit('userStopTyping', username));

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    io.emit('onlineUsers', [...new Set(onlineUsers.values())]);
  });
});

setInterval(() => {
  if (fs.existsSync(uploadsDir)) {
    fs.readdirSync(uploadsDir).forEach(f => {
      const fp = path.join(uploadsDir, f);
      try { if (Date.now() - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp); } catch (e) {}
    });
  }
}, 1800000);

server.listen(PORT, () => console.log(`✨ Just for You running at http://localhost:${PORT}`));