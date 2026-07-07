document.addEventListener('DOMContentLoaded', async () => {
  try {
    const r = await fetch('/api/me');
    const d = await r.json();
    if (!d.loggedIn) { location.href = '/'; return; }
    window._me = d.user;
  } catch (e) { location.href = '/'; return; }

  const ME = window._me;
  const $msgs = document.getElementById('chatMessages');
  const $input = document.getElementById('messageInput');
  const $send = document.getElementById('sendBtn');
  const $voice = document.getElementById('voiceBtn');
  const $logout = document.getElementById('logoutBtn');
  const $imgBtn = document.getElementById('imageBtn');
  const $attBtn = document.getElementById('attachBtn');
  const $imgIn = document.getElementById('imageInput');
  const $fileIn = document.getElementById('fileInput');
  const $online = document.getElementById('onlineStatus');
  const $typing = document.getElementById('typingIndicator');
  const $replyPrev = document.getElementById('replyPreview');
  const $rpCancel = document.getElementById('replyCancelBtn');
  const $rpName = $replyPrev.querySelector('.reply-preview-name');
  const $rpMsg = $replyPrev.querySelector('.reply-preview-msg');
  const $modal = document.getElementById('imageModal');
  const $modalImg = document.getElementById('modalImage');
  const $modalClose = document.getElementById('modalClose');
  const $ctx = document.getElementById('contextMenu');
  const $ctxOv = document.getElementById('contextOverlay');
  const $ctxDel = document.getElementById('contextDeleteBtn');
  const $ctxReply = document.getElementById('contextReplyBtn');
  const $ctxReact = document.getElementById('contextReactions');
  const $voiceBar = document.getElementById('voiceRecordingBar');
  const $voiceCancel = document.getElementById('voiceCancelBtn');
  const $voiceSend = document.getElementById('voiceSendBtn');
  const $voiceTimer = document.getElementById('voiceTimer');
  const $inputArea = document.getElementById('chatInputArea');

  let replyTo = null, selMsg = null, typTimer = null, isTyp = false;
  let recorder = null, audioChunks = [], vInterval = null, vSec = 0, vStream = null;

  // Seen tracking
  const unseenMsgIds = new Set(); // msg IDs that I haven't seen yet
  const myMsgIds = new Set(); // my sent message IDs

  // Notif sound
  let notifCtx = null;
  function playNotif() {
    try {
      if (!notifCtx) notifCtx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = notifCtx.createBuffer(1, notifCtx.sampleRate * 0.15, notifCtx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(2 * Math.PI * 800 * i / notifCtx.sampleRate) * Math.exp(-3 * i / ch.length);
      const src = notifCtx.createBufferSource();
      src.buffer = buf; src.connect(notifCtx.destination); src.start();
    } catch (e) {}
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
  }

  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  function showNotif(sender, text) {
    if (sender === ME) return;
    playNotif();
    if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
      try { new Notification('Just for You', { body: `${sender}: ${text || '📎'}`, tag: 'jfy', renotify: true, silent: true }); } catch (e) {}
    }
  }

  const socket = io();

  function updBtns() {
    const has = $input.value.trim().length > 0;
    $send.style.display = has ? 'flex' : 'none';
    $voice.style.display = has ? 'none' : 'flex';
  }
  $input.addEventListener('input', updBtns);
  updBtns();

  socket.on('onlineUsers', (u) => {
    if (u.length <= 1) { $online.textContent = 'Only you here'; $online.classList.remove('active'); }
    else { $online.textContent = u.filter(x => x !== ME).join(', ') + ' online'; $online.classList.add('active'); }
  });

  socket.on('newMessage', (msg) => {
    const w = $msgs.querySelector('.welcome-msg'); if (w) w.remove();
    appendMsg(msg);
    scrollBot();
    showNotif(msg.sender, msg.text || (msg.voice ? '🎤 Voice' : ''));

    // If msg is from others, track as unseen then check visibility
    if (msg.sender !== ME) {
      unseenMsgIds.add(msg.id);
      checkSeenMessages();
    }
  });

  socket.on('messageDeleted', (d) => {
    let el = document.querySelector(`[data-mid="${d.id}"]`);
    if (el) {
      el.style.pointerEvents = 'none';
      el.classList.add('fade-out-left');
      const removeEl = () => { if (el && el.parentNode) el.parentNode.removeChild(el); };
      el.addEventListener('animationend', removeEl);
      setTimeout(removeEl, 600);
    }
    unseenMsgIds.delete(d.id);
    myMsgIds.delete(d.id);
  });

  socket.on('messageReaction', (d) => {
    const c = document.querySelector(`[data-rf="${d.msgId}"]`); if (!c) return;
    let b = c.querySelector(`[data-re="${d.emoji}"]`);
    if (d.action === 'add') {
      if (b) { const cn = b.querySelector('.rc'); cn.textContent = (parseInt(cn.textContent) || 1) + 1; if (d.user === ME) b.classList.add('reacted'); }
      else { b = document.createElement('div'); b.className = 'reaction-badge' + (d.user === ME ? ' reacted' : ''); b.dataset.re = d.emoji; b.innerHTML = `${d.emoji}<span class="rc">1</span>`; b.onclick = () => socket.emit('reactMessage', { msgId: d.msgId, emoji: d.emoji }); c.appendChild(b); }
    } else if (d.action === 'remove' && b) {
      const cn = b.querySelector('.rc'); const n = (parseInt(cn.textContent) || 1) - 1;
      if (n <= 0) b.remove(); else { cn.textContent = n; if (d.user === ME) b.classList.remove('reacted'); }
    }
  });

  // ===== SEEN EVENT FROM SERVER =====
  socket.on('messagesSeen', (data) => {
    // data = { seenBy: username, msgIds: [...] }
    if (data.seenBy === ME) return; // ignore own seen events

    data.msgIds.forEach(id => {
      if (myMsgIds.has(id)) {
        // Update status to "seen"
        const statusEl = document.querySelector(`[data-status-for="${id}"]`);
        if (statusEl) {
          statusEl.textContent = 'Seen ✓✓';
          statusEl.classList.add('seen');
          statusEl.classList.remove('sent');
        }
      }
    });
  });

  socket.on('userTyping', (u) => { $typing.querySelector('.typing-name').textContent = u; $typing.style.display = 'flex'; });
  socket.on('userStopTyping', () => $typing.style.display = 'none');

  function sendMsg() {
    const t = $input.value.trim(); if (!t) return;
    socket.emit('sendMessage', { text: t, replyTo: replyTo });
    $input.value = ''; cancelReply(); stopTyp(); updBtns();
  }
  $send.onclick = sendMsg;
  $input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } };

  $input.addEventListener('input', () => {
    if (!isTyp) { isTyp = true; socket.emit('typing'); }
    clearTimeout(typTimer); typTimer = setTimeout(stopTyp, 2000);
  });
  function stopTyp() { isTyp = false; socket.emit('stopTyping'); clearTimeout(typTimer); }

  $imgBtn.onclick = () => $imgIn.click();
  $imgIn.onchange = async () => { if ($imgIn.files[0]) { await upFile($imgIn.files[0]); $imgIn.value = ''; } };
  $attBtn.onclick = () => $fileIn.click();
  $fileIn.onchange = async () => { if ($fileIn.files[0]) { await upFile($fileIn.files[0]); $fileIn.value = ''; } };

  async function upFile(f) {
    const fd = new FormData(); fd.append('file', f);
    try {
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      const d = await r.json();
      if (d.success) { socket.emit('sendMessage', { text: '', replyTo: replyTo, file: d.file }); cancelReply(); }
    } catch (e) {}
  }

  // Voice
  $voice.onclick = startVoice;
  $voiceCancel.onclick = cancelVoice;
  $voiceSend.onclick = sendVoice;

  async function startVoice() {
    try {
      vStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(vStream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
      audioChunks = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
      recorder.start(100);
      $inputArea.style.display = 'none'; $voiceBar.style.display = 'flex';
      vSec = 0; $voiceTimer.textContent = '0:00';
      vInterval = setInterval(() => { vSec++; $voiceTimer.textContent = `${Math.floor(vSec / 60)}:${(vSec % 60).toString().padStart(2, '0')}`; }, 1000);
    } catch (e) { alert('Microphone access needed!'); }
  }
  function cancelVoice() { if (recorder && recorder.state !== 'inactive') recorder.stop(); cleanVoice(); }
  function sendVoice() {
    if (!recorder || recorder.state === 'inactive') return;
    recorder.onstop = () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const reader = new FileReader();
      reader.onloadend = () => { socket.emit('sendVoice', { audioData: reader.result, duration: vSec, replyTo: replyTo }); cancelReply(); };
      reader.readAsDataURL(blob);
      cleanVoice();
    };
    recorder.stop();
  }
  function cleanVoice() {
    clearInterval(vInterval); $voiceBar.style.display = 'none'; $inputArea.style.display = 'block';
    audioChunks = []; if (vStream) { vStream.getTracks().forEach(t => t.stop()); vStream = null; } recorder = null;
  }

  // ===== APPEND MESSAGE =====
  function appendMsg(msg) {
    const isSent = msg.sender === ME;
    const wr = document.createElement('div');
    wr.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
    wr.dataset.mid = msg.id;

    // Track my messages for seen status
    if (isSent) myMsgIds.add(msg.id);

    let h = '';
    if (!isSent) h += `<span class="message-sender">${esc(msg.sender)}</span>`;
    h += `<div class="swipe-arrow">↩️</div>`;
    h += `<div class="message-bubble">`;

    if (msg.replyTo) {
      h += `<div class="reply-quote" data-rid="${msg.replyTo.id}"><span class="rqn">${esc(msg.replyTo.sender)}</span><span class="rqt">${esc(msg.replyTo.text || '📎')}</span></div>`;
    }
    if (msg.voice) {
      const dur = msg.voice.duration || 0;
      let bars = '';
      for (let i = 0; i < 22; i++) bars += `<div class="vb" style="height:${5 + Math.floor(Math.random() * 18)}px"></div>`;
      h += `<div class="voice-msg" data-va="${msg.voice.data}" data-vd="${dur}"><button class="vplay"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg></button><div class="vwave">${bars}</div><span class="vdur">${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}</span></div>`;
    }
    if (msg.file) {
      if (msg.file.mimeType && msg.file.mimeType.startsWith('image/'))
        h += `<img class="message-image" src="${msg.file.url}" loading="lazy">`;
      else
        h += `<a class="message-file" href="${msg.file.url}" download="${esc(msg.file.originalName)}" target="_blank"><span class="fi">${fIcon(msg.file.originalName)}</span><div class="finfo"><span class="fn">${esc(msg.file.originalName)}</span><span class="fs">${fSize(msg.file.size)}</span></div><span class="fd">⬇️</span></a>`;
    }
    if (msg.text) h += `<span class="message-text">${esc(msg.text)}</span>`;
    h += `</div>`;
    h += `<div class="message-reactions" data-rf="${msg.id}"></div>`;

    // Time + Status
    if (isSent) {
      h += `<div class="message-meta sent-meta">`;
h += `<span class="message-time">${formatTime(msg.timestamp)}</span>`;      h += `<span class="message-status sent" data-status-for="${msg.id}">Sent ✓</span>`;
      h += `</div>`;
    } else {
h += `<span class="message-time">${formatTime(msg.timestamp)}</span>`;    }

    wr.innerHTML = h;
    $msgs.appendChild(wr);

    const bubble = wr.querySelector('.message-bubble');
    const arrow = wr.querySelector('.swipe-arrow');

    // Image
    const img = wr.querySelector('.message-image');
    if (img) img.onclick = (e) => { e.stopPropagation(); $modalImg.src = img.src; $modal.style.display = 'flex'; };

    // Reply quote
    const rq = wr.querySelector('.reply-quote');
    if (rq) rq.onclick = (e) => {
      e.stopPropagation();
      const o = document.querySelector(`[data-mid="${rq.dataset.rid}"]`);
      if (o) { o.scrollIntoView({ behavior: 'smooth', block: 'center' }); const ob = o.querySelector('.message-bubble'); ob.style.boxShadow = '0 0 0 2px #7c5cfc'; setTimeout(() => ob.style.boxShadow = '', 1500); }
    };

    // Voice
    const vel = wr.querySelector('.voice-msg');
    if (vel) setupVoicePlayer(vel);

    // Swipe + Long press
    setupInteraction(bubble, arrow, msg, isSent);

    // Desktop right click
    bubble.addEventListener('contextmenu', (e) => { e.preventDefault(); openCtx(msg, e.clientX, e.clientY); });
  }

  // ===== SEEN DETECTION using IntersectionObserver =====
  const seenObserver = new IntersectionObserver((entries) => {
    const newlySeen = [];

    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const mid = entry.target.dataset.mid;
        if (mid && unseenMsgIds.has(mid)) {
          unseenMsgIds.delete(mid);
          newlySeen.push(mid);
          seenObserver.unobserve(entry.target);
        }
      }
    });

    if (newlySeen.length > 0) {
      socket.emit('seenMessages', { msgIds: newlySeen });
    }
  }, {
    root: $msgs,
    threshold: 0.5 // 50% visible = seen
  });

  function checkSeenMessages() {
    // Observe all unseen messages
    unseenMsgIds.forEach(id => {
      const el = document.querySelector(`[data-mid="${id}"]`);
      if (el) seenObserver.observe(el);
    });
  }

  // Also check when user scrolls
  $msgs.addEventListener('scroll', () => {
    checkSeenMessages();
  });

  // Also check when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkSeenMessages();
    }
  });

  // ===== SWIPE + LONG PRESS =====
  function setupInteraction(bubble, arrow, msg, isSent) {
    const THRESHOLD = 65;
    let startX = 0, startY = 0;
    let dragging = false;
    let moveAmount = 0;
    let longTimer = null;
    let longFired = false;
    let decided = false;
    let isTouch = false;

    function onStart(x, y, touch) {
      startX = x; startY = y;
      dragging = false; moveAmount = 0;
      longFired = false; decided = false; isTouch = touch;

      bubble.style.transition = 'none';
      bubble.style.transform = '';
      arrow.style.opacity = '0';
      arrow.style.transform = 'translateY(-50%) scale(.5)';

      longTimer = setTimeout(() => {
        if (!dragging) {
          longFired = true;
          if (navigator.vibrate) navigator.vibrate(30);
          openCtx(msg, startX, startY);
        }
      }, 600);
    }

    function onMove(x, y) {
      if (longFired) return;
      const dx = x - startX, dy = y - startY;
      const adx = Math.abs(dx), ady = Math.abs(dy);

      if (isTouch && !decided) {
        if (adx < 8 && ady < 8) return;
        decided = true; clearTimeout(longTimer);
        if (ady > adx * 1.2) { dragging = false; return; }
      }
      if (!isTouch && adx < 5 && ady < 5) return;
      if (!isTouch) clearTimeout(longTimer);
      if (isSent && dx > 0) return;
      if (!isSent && dx < 0) return;
      if (adx < 5) return;

      dragging = true;
      const raw = adx, max = THRESHOLD + 40;
      const damp = raw > max ? max + (raw - max) * 0.1 : raw;
      const px = isSent ? -damp : damp;
      moveAmount = px;
      bubble.style.transform = `translateX(${px}px)`;

      const prog = raw / THRESHOLD;
      if (prog > 0.25) {
        arrow.style.opacity = Math.min(1, prog).toString();
        arrow.style.transform = prog >= 1 ? 'translateY(-50%) scale(1.3)' : `translateY(-50%) scale(${0.5 + prog * 0.5})`;
      } else { arrow.style.opacity = '0'; }
    }

    function onEnd() {
      clearTimeout(longTimer);
      if (dragging) {
        bubble.style.transition = 'transform .25s cubic-bezier(.25,.46,.45,.94)';
        bubble.style.transform = '';
        arrow.style.opacity = '0';
        arrow.style.transform = 'translateY(-50%) scale(.5)';
        if (Math.abs(moveAmount) >= THRESHOLD) {
          setReply(msg);
          if (navigator.vibrate) navigator.vibrate(20);
        }
      }
      dragging = false; moveAmount = 0; longFired = false; decided = false;
    }

    // Mouse
    bubble.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      onStart(e.clientX, e.clientY, false);
      function mm(e) { onMove(e.clientX, e.clientY); }
      function mu() { onEnd(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });

    // Touch
    bubble.addEventListener('touchstart', (e) => { const t = e.touches[0]; onStart(t.clientX, t.clientY, true); }, { passive: true });
    bubble.addEventListener('touchmove', (e) => {
      if (longFired) return;
      const t = e.touches[0];
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (!decided) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        decided = true; clearTimeout(longTimer);
        if (Math.abs(dy) > Math.abs(dx) * 1.2) return;
        if (isSent && dx > 0) return;
        if (!isSent && dx < 0) return;
      }
      e.preventDefault();
      onMove(t.clientX, t.clientY);
    }, { passive: false });
    bubble.addEventListener('touchend', () => onEnd(), { passive: true });
    bubble.addEventListener('touchcancel', () => {
      clearTimeout(longTimer);
      bubble.style.transition = 'transform .2s ease'; bubble.style.transform = '';
      arrow.style.opacity = '0'; dragging = false; moveAmount = 0; longFired = false; decided = false;
    }, { passive: true });
  }

  // Voice player
  function setupVoicePlayer(vel) {
    const pb = vel.querySelector('.vplay');
    const bars = vel.querySelectorAll('.vb');
    let audio = null, playing = false;
    pb.addEventListener('click', (e) => {
      e.stopPropagation();
      if (playing && audio) { audio.pause(); audio.currentTime = 0; playing = false; pb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'; bars.forEach(b => b.classList.remove('on')); return; }
      audio = new Audio(vel.dataset.va); audio.play(); playing = true;
      pb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
      audio.ontimeupdate = () => { const p = audio.currentTime / audio.duration; bars.forEach((b, i) => { if (i <= p * bars.length) b.classList.add('on'); else b.classList.remove('on'); }); };
      audio.onended = () => { playing = false; pb.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'; bars.forEach(b => b.classList.remove('on')); };
    });
  }

  // ===== CONTEXT MENU =====
  let _savedMsgId = null;
  let _savedMsgData = null;

  function openCtx(msg, x, y) {
    _savedMsgId = msg.id;
    _savedMsgData = msg;
    selMsg = msg;
    $ctxOv.style.display = 'block';
    $ctx.style.display = 'block';
    $ctx.style.left = ''; $ctx.style.top = ''; $ctx.style.right = '';

    requestAnimationFrame(() => {
      const gap = 10, mW = $ctx.offsetWidth, mH = $ctx.offsetHeight;
      const vw = window.innerWidth, vh = window.innerHeight;
      if (vw <= 480) {
        $ctx.style.left = '8px'; $ctx.style.right = '8px';
        let top = vh - mH - gap; if (top < gap) top = gap;
        $ctx.style.top = top + 'px'; return;
      }
      let left = x - mW / 2, top = y - mH - 14;
      if (left < gap) left = gap;
      if (left + mW > vw - gap) left = vw - mW - gap;
      if (top < gap) top = y + 14;
      if (top + mH > vh - gap) top = Math.max(gap, vh - mH - gap);
      $ctx.style.left = left + 'px'; $ctx.style.top = top + 'px';
    });
  }

  function closeCtx() {
    $ctx.style.display = 'none';
    $ctxOv.style.display = 'none';
  }

  $ctx.addEventListener('mousedown', (e) => e.stopPropagation());
  $ctx.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  $ctx.addEventListener('click', (e) => e.stopPropagation());

  $ctxOv.addEventListener('mousedown', (e) => { e.stopPropagation(); _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx(); });
  $ctxOv.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx(); });

  // Delete
  $ctxDel.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  $ctxDel.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const id = _savedMsgId; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx();
    if (id) socket.emit('deleteMessage', id);
  });
  $ctxDel.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    const id = _savedMsgId; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx();
    if (id) socket.emit('deleteMessage', id);
  });

  // Reply
  $ctxReply.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  $ctxReply.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const md = _savedMsgData; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx();
    if (md) setReply(md);
  });
  $ctxReply.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    const md = _savedMsgData; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx();
    if (md) setReply(md);
  });

  // React
  $ctxReact.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  $ctxReact.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest('.cr');
    if (b && _savedMsgId) { const id = _savedMsgId, em = b.dataset.emoji; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx(); socket.emit('reactMessage', { msgId: id, emoji: em }); }
    else closeCtx();
  });
  $ctxReact.addEventListener('touchend', (e) => {
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest('.cr');
    if (b && _savedMsgId) { const id = _savedMsgId, em = b.dataset.emoji; _savedMsgId = null; _savedMsgData = null; selMsg = null; closeCtx(); socket.emit('reactMessage', { msgId: id, emoji: em }); }
    else closeCtx();
  });

  // Reply
  function setReply(m) {
    replyTo = { id: m.id, sender: m.sender, text: m.text || (m.voice ? '🎤 Voice' : (m.file ? '📎 ' + m.file.originalName : '📎')) };
    $rpName.textContent = m.sender; $rpMsg.textContent = replyTo.text;
    $replyPrev.style.display = 'flex'; $input.focus();
  }
  function cancelReply() { replyTo = null; $replyPrev.style.display = 'none'; }
  $rpCancel.onclick = cancelReply;

  $modalClose.onclick = () => $modal.style.display = 'none';
  $modal.querySelector('.modal-overlay').onclick = () => $modal.style.display = 'none';
  $logout.onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/'; };

  function scrollBot() { requestAnimationFrame(() => $msgs.scrollTop = $msgs.scrollHeight); }
  function formatTime(ts) {
  const date = new Date(ts);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  return `${hours}:${minutes} ${ampm}`;
}
  function esc(t) { if (!t) return ''; const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function fIcon(n) { if (!n) return '📎'; const e = n.split('.').pop().toLowerCase(); return { pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',zip:'📦',rar:'📦',mp3:'🎵',mp4:'🎬',txt:'📃',apk:'📱' }[e] || '📎'; }
  function fSize(b) { if (!b) return ''; if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'KB'; return (b / 1048576).toFixed(1) + 'MB'; }

  setTimeout(() => $input.focus(), 300);
});
