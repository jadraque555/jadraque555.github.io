/* Live call with Jayson's AI twin (call.html).
 * Hands-free: after "Join" the mic stays open, the AI answers out loud, then listens again.
 * Same brain as the on-page widget: POST AGENT_CONFIG.apiUrl (SSE), lite mode when offline.
 */
(function () {
  'use strict';

  var cfg = window.AGENT_CONFIG || {};
  var API = cfg.apiUrl || '';
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var params = new URLSearchParams(location.search);
  if (isLocal) API = params.get('agentApi') || API || 'http://localhost:8787/api/chat';   // local dev: use the local API by default

  var $ = function (id) { return document.getElementById(id); };
  var root = $('agent');
  var statusEl = $('agentStatus'), logEl = $('agentLog'), form = $('agentForm'), input = $('agentText'),
      sendBtn = $('agentSend'), micBtn = $('micBtn'), ccBtn = $('ccBtn'), chatBtn = $('chatBtn'),
      muteBtn = $('muteBtn'), endBtn = $('endBtn'), capAI = $('capAI'), capYou = $('capYou'),
      mainTile = $('mainTile'), selfTile = $('selfTile'), meter = $('meter');

  var GREETING = "Hey, thanks for calling! I'm the AI version of Jayson. What would you like to know about my work?";
  var history = [], busy = false, muted = false, micMuted = false, liteMode = !API, aborter = null;
  var speakQ = [], speakingNow = false, streaming = false, timers = [];
  var blocked = false, inCall = false, listening = false, recog = null, restartT = null, noSpeech = 0, litenoted = false;
  var stream = null, actx = null, analyser = null, levelBuf = null, startedAt = 0, tickT = null, rafId = 0;

  /* ---------- avatar (SVG now, 3D model when configured) ---------- */
  var svgAv = null, impl = null, lastState = 'idle', lastEmotion = 'happy';
  var av = {
    setState: function (s) { lastState = s; impl && impl.setState(s); },
    setEmotion: function (e) { lastEmotion = e; impl && impl.setEmotion(e); },
    pulse: function (x) { impl && impl.pulse(x); },
    setLevel: function (v) { impl && impl.setLevel(v); }
  };
  function buildAvatar() {
    var avatarEl = $('avatar');
    svgAv = window.createAvatar(avatarEl);
    impl = svgAv;
    impl.setEmotion(lastEmotion); impl.setState(lastState);
    var modelUrl = cfg.avatarModel || '';
    if (isLocal && params.get('agentModel')) modelUrl = params.get('agentModel');
    if (!modelUrl) return;
    var layer = document.createElement('div');
    layer.className = 'avatar3d';
    avatarEl.appendChild(layer);
    import('./avatar3d.js')
      .then(function (m) { return m.createAvatar3D(layer, { url: modelUrl, extent: cfg.avatarExtent, lookDown: cfg.avatarLookDown, rotateY: cfg.avatarRotateY }); })
      .then(function (a3) {
        svgAv.destroy(); impl = a3;
        avatarEl.classList.add('has3d'); layer.classList.add('on');
        impl.setEmotion(lastEmotion); impl.setState(lastState);
      })
      .catch(function (err) { layer.remove(); if (window.console) console.warn('3D avatar unavailable:', err && err.message); });
  }

  /* ---------- UI helpers ---------- */
  function setStatus(kind, text) { statusEl.setAttribute('data-state', kind); statusEl.querySelector('span').textContent = text; }
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + role; d.textContent = text;
    logEl.appendChild(d); logEl.scrollTop = logEl.scrollHeight;
    return d;
  }
  function note(text) { addMsg('note', text); }
  function setTalking(on) { mainTile.classList.toggle('talking', !!on); }
  function setYou(text) { capYou.textContent = text ? 'You: ' + text : ''; }

  /* ---------- speech out ---------- */
  var voice = null, synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  function pickVoice() {
    if (!synth) return;
    var en = synth.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    var prefer = [/Google UK English Male/i, /Daniel/i, /Aaron/i, /Alex/i, /Guy/i, /Fred/i, /Google US English/i, /Samantha/i];
    for (var i = 0; i < prefer.length; i++) {
      var f = en.filter(function (v) { return prefer[i].test(v.name); })[0];
      if (f) { voice = f; return; }
    }
    voice = en[0] || null;
  }
  if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }
  function clearTimers() { timers.forEach(clearInterval); timers.forEach(clearTimeout); timers = []; }

  function speakingUI(on) {
    if (on) { av.setState('speaking'); setStatus('speaking', 'Speaking'); setTalking(true); }
    else { setTalking(false); av.setState('idle'); }
  }
  function simulate(text, done) {
    var words = text.split(/\s+/).length, dur = Math.max(700, words * 320);
    var iv = setInterval(function () { av.pulse(0.85); }, 170);
    var to = setTimeout(function () { clearInterval(iv); done(); }, dur);
    timers.push(iv, to);
  }
  function pump() {
    if (speakingNow) return;
    var text = speakQ.shift();
    if (blocked) return;
    if (!text) { if (!streaming) { speakingUI(false); listenSoon(300); } return; }
    speakingNow = true; speakingUI(true); stopListening();
    var next = function () { speakingNow = false; pump(); };
    if (muted || !synth) return simulate(text, next);
    var u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = 1.03; u.pitch = 0.95;
    var gotBoundary = false, iv = null;
    u.onboundary = function () { gotBoundary = true; av.pulse(0.9); };
    u.onstart = function () {
      timers.push(setTimeout(function () { if (!gotBoundary) iv = setInterval(function () { av.pulse(0.8); }, 180); }, 450));
    };
    var end = function () { if (iv) clearInterval(iv); next(); };
    u.onend = end;
    u.onerror = function (e) {
      if (e && e.error === 'not-allowed') {                       // browser wants a tap before it plays sound
        if (iv) clearInterval(iv);
        speakQ.unshift(text); speakingNow = false; blocked = true;
        speakingUI(false); setStatus('idle', 'Tap to start sound'); $('tapStart').hidden = false;
        return;
      }
      end();
    };
    synth.speak(u);
  }
  function enqueue(text) { text = text.replace(/\s+/g, ' ').trim(); if (text) { speakQ.push(text); pump(); } }
  function stopSpeaking() {
    speakQ = []; speakingNow = false; clearTimers();
    if (synth) synth.cancel();
    av.setLevel(null); setTalking(false);
  }

  /* ---------- lite mode ---------- */
  var LITE = [
    [/\b(hi|hello|hey|kumusta|musta)\b/, 'happy', "Hey there! Ask me about my work, projects or skills."],
    [/nativecamp|japan|english platform/, 'excited', "NativeCamp is a live English platform for Japan. I'm a Solutions Architect there and contributed AI coaching features and real-time lesson infrastructure."],
    [/claude|llm|dify|n8n|chatbot|agent|prompt|ai\b/, 'happy', "I lead an AI team building production chatbots and automation with Dify, n8n and the Claude, OpenAI and Gemini APIs, and I use Claude Code every day."],
    [/project|build|built|portfolio|work on/, 'excited', "I built Tubag AI, a tool-calling chat agent, Jay, a local voice assistant, and Inkwell Studio, an AI video pipeline. Plus NativeCamp at work."],
    [/skill|stack|tech|language|python|typescript|react|node/, 'neutral', "Mostly TypeScript, Python and PHP, with Node, Next.js, NestJS, Laravel, PostgreSQL and Docker, plus AI tooling like Dify, n8n and Ollama."],
    [/experience|years|background|who are you|about/, 'neutral', "I have about seven years of experience, three of them leading an AI team as Solutions Architect at Forty Degrees Celsius in Cebu."],
    [/hire|available|contact|email|salary|rate|price|job|work with/, 'serious', "For hiring or pricing, please email me at jadraquejaysonl@gmail.com. I reply personally."],
    [/real|human|ai\??$|robot|are you/, 'neutral', "Ha, I'm the AI version of Jayson, built for this site. I can answer questions about my work."]
  ];
  function lite(t) {
    var s = t.toLowerCase();
    for (var i = 0; i < LITE.length; i++) if (LITE[i][0].test(s)) return { emotion: LITE[i][1], text: LITE[i][2] };
    return { emotion: 'thinking', text: "I'm in lite mode right now, so I only know the basics. Ask about my experience, projects or skills, or email me at jadraquejaysonl@gmail.com." };
  }

  /* ---------- chat ---------- */
  var TAGS = /\[(neutral|happy|thinking|excited|serious)\]/gi;
  function parseReply(full) {
    var m = full.match(/^\s*\[([a-z]+)\]\s*/i), emotion = null, body = full;
    if (m) { emotion = m[1].toLowerCase(); body = full.slice(m[0].length); }
    else if (/^\s*\[[a-z]*$/i.test(full)) return { wait: true };
    return { emotion: emotion, body: body.replace(TAGS, '').replace(/\*\*|__|`/g, '') };
  }
  function abortCurrent() { if (aborter) { aborter.abort(); aborter = null; } }
  function finishTurn(bubble, shown) {
    streaming = false; bubble.classList.remove('typing');
    if (shown) history.push({ role: 'assistant', content: shown });
    if (history.length > 20) history = history.slice(-20);
    busy = false; sendBtn.disabled = false; pump();
  }

  async function ask(text) {
    text = (text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text || busy) return;
    stopSpeaking(); abortCurrent(); stopListening();
    busy = true; sendBtn.disabled = true;
    addMsg('user', text); setYou(text); capAI.textContent = '';
    history.push({ role: 'user', content: text });
    input.value = '';
    av.setState('thinking'); setStatus('thinking', 'Thinking…');
    var bubble = addMsg('ai', ''); bubble.classList.add('typing');
    streaming = true;

    var full = '', spoken = 0, started = false;
    function onText() {
      var p = parseReply(full);
      if (p.wait) return;
      if (!started && p.body.trim()) { started = true; bubble.classList.remove('typing'); av.setEmotion(p.emotion || 'neutral'); speakingUI(true); setStatus('speaking', 'Speaking'); }
      bubble.textContent = p.body; capAI.textContent = p.body.slice(-220);
      logEl.scrollTop = logEl.scrollHeight;
      var rest = p.body.slice(spoken), m;
      while ((m = rest.match(/^[\s\S]*?[.!?…]+["')\]]*(?=\s)/))) { enqueue(m[0]); spoken += m[0].length; rest = p.body.slice(spoken); }
      if (rest.length > 170) { var cut = rest.lastIndexOf(','); if (cut > 60) { enqueue(rest.slice(0, cut + 1)); spoken += cut + 1; } }
    }
    try {
      if (!API) throw new Error('offline');
      aborter = new AbortController();
      var r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-10) }), signal: aborter.signal });
      if (!r.ok || !r.body) throw new Error(String(r.status));
      liteMode = false;
      var reader = r.body.getReader(), dec = new TextDecoder(), buf = '', done = false;
      while (!done) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n')) >= 0) {
          var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (line.indexOf('data:') !== 0) continue;
          var payload = line.slice(5).trim();
          if (payload === '[DONE]') { done = true; break; }
          try { var o = JSON.parse(payload); if (o.t) { full += o.t; onText(); } else if (o.error) throw new Error(o.error); } catch (e) { if (e.message === 'stream_interrupted') throw e; }
        }
      }
      if (!full.trim()) throw new Error('empty');
      var rem = parseReply(full), tail = (rem.body || '').slice(spoken).trim();
      if (tail) enqueue(tail);
      finishTurn(bubble, rem.body ? rem.body.trim() : '');
    } catch (err) {
      if (err && err.name === 'AbortError') { finishTurn(bubble, ''); return; }
      liteMode = true;
      var rate = err && String(err.message) === '429';
      stopSpeaking();
      var a = lite(text);
      bubble.classList.remove('typing'); bubble.textContent = a.text; capAI.textContent = a.text;
      av.setEmotion(a.emotion);
      if (!litenoted) {
        litenoted = true;
        note(rate ? 'Lots of visitors right now, so I am in lite mode for a bit.' : (API ? 'The AI server is offline, so I am answering in lite mode.' : 'Lite mode: answers are pre-written. The live AI is not connected yet.'));
      }
      streaming = true; speakQ = [];
      enqueue(a.text);
      history.push({ role: 'assistant', content: a.text });
      finishTurn(bubble, '');
    }
  }

  /* ---------- listening (hands-free loop) ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function canListen() { return inCall && SR && stream && !micMuted && !busy && !streaming && !speakingNow && !speakQ.length; }
  function listenSoon(ms) { clearTimeout(restartT); restartT = setTimeout(startListening, ms || 250); }
  function stopListening() {
    clearTimeout(restartT);
    if (recog) { var r = recog; recog = null; r.onend = null; r.onresult = null; r.onerror = null; try { r.abort(); } catch (e) {} }
    listening = false; micBtn.classList.remove('listening');
  }
  function startListening() {
    if (!canListen() || listening) return;
    var r = recog = new SR();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    var finalText = '', fatal = false;
    r.onstart = function () { listening = true; micBtn.classList.add('listening'); av.setState('listening'); setStatus('listening', 'Listening…'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) { var x = e.results[i]; if (x.isFinal) finalText += x[0].transcript; else interim += x[0].transcript; }
      setYou((finalText + ' ' + interim).trim()); noSpeech = 0;
    };
    r.onerror = function (e) {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { fatal = true; note('The microphone is blocked. Allow it in your browser, or type in the chat.'); micBtn.setAttribute('aria-pressed', 'true'); micMuted = true; }
      else if (e.error === 'no-speech') noSpeech++;
      else if (e.error === 'network') { fatal = true; note('Voice recognition lost its connection. Tap the mic to try again, or type in the chat.'); micMuted = true; micBtn.setAttribute('aria-pressed', 'true'); }
    };
    r.onend = function () {
      if (recog !== r) return;
      recog = null; listening = false; micBtn.classList.remove('listening');
      var t = finalText.trim();
      if (t) { ask(t); return; }
      setYou(''); av.setState('idle');
      if (!fatal && inCall) { if (!busy) setStatus('listening', 'Listening…'); listenSoon(noSpeech > 3 ? 1500 : 250); }
      else if (fatal) setStatus('idle', 'Mic off');
    };
    try { r.start(); } catch (e) { recog = null; listenSoon(800); }
  }

  /* ---------- mic level meter (also confirms the mic works) ---------- */
  function startMeter() {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      var src = actx.createMediaStreamSource(stream);
      analyser = actx.createAnalyser(); analyser.fftSize = 256; src.connect(analyser);
      levelBuf = new Uint8Array(analyser.frequencyBinCount);
    } catch (e) { analyser = null; return; }
    var ctx = meter.getContext('2d'), bars = 14;
    (function draw() {
      rafId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(levelBuf);
      var sum = 0; for (var i = 0; i < 40; i++) sum += levelBuf[i];
      var lvl = micMuted ? 0 : Math.min(1, sum / 40 / 110);
      selfTile.classList.toggle('talking', lvl > 0.25);
      ctx.clearRect(0, 0, meter.width, meter.height);
      ctx.fillStyle = micMuted ? '#586078' : '#6ee7a0';
      for (var b = 0; b < bars; b++) {
        var v = levelBuf[b * 2 + 1] / 255 * (micMuted ? 0 : 1), h = Math.max(3, v * meter.height);
        ctx.fillRect(b * 8.6 + 1, (meter.height - h) / 2, 5, h);
      }
    })();
  }

  /* ---------- call lifecycle ---------- */
  function fmt(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }
  async function join() {
    // The click that got us here unlocks audio output; also ask for the mic once.
    if (synth) { try { synth.cancel(); } catch (e) {} }
    var micOk = false;
    if (SR && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micOk = true;
      } catch (e) { stream = null; }
    }
    $('ended').hidden = true; $('callUI').hidden = false; root.dataset.phase = 'call';
    $('avatar').innerHTML = '';
    inCall = true; startedAt = Date.now(); busy = false;
    buildAvatar();
    logEl.innerHTML = ''; history = []; litenoted = false; capAI.textContent = ''; capYou.textContent = '';
    tickT = setInterval(function () { $('timer').textContent = fmt(Math.floor((Date.now() - startedAt) / 1000)); }, 1000);
    if (micOk) startMeter();
    else {
      micMuted = true; micBtn.setAttribute('aria-pressed', 'true'); selfTile.classList.add('muted');
      $('chatPanel').hidden = false; chatBtn.setAttribute('aria-pressed', 'true');
      note(!SR ? 'Voice input needs Chrome, Edge or Safari. Type your questions here.' : 'Microphone not available. Type your questions here, or allow the mic and rejoin.');
    }
    if (!API) { litenoted = true; note('Lite mode: answers are pre-written. The live AI is not connected yet.'); }
    setStatus('idle', 'Connected');
    // the AI greets first
    var b = addMsg('ai', GREETING);
    capAI.textContent = GREETING; av.setEmotion('happy');
    history.push({ role: 'assistant', content: GREETING });
    streaming = false; enqueue(GREETING);
  }
  function leave() {
    inCall = false; stopListening(); stopSpeaking(); abortCurrent();
    clearInterval(tickT); cancelAnimationFrame(rafId);
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (actx) { try { actx.close(); } catch (e) {} actx = null; }
    var secs = Math.floor((Date.now() - startedAt) / 1000);
    $('endedTime').textContent = 'Call length ' + fmt(secs) + '. Thanks for stopping by.';
    $('callUI').hidden = true; $('ended').hidden = false; root.dataset.phase = 'ended';
    $('avatar').innerHTML = '';
    streaming = false; busy = false; speakQ = []; speakingNow = false;
  }

  $('tapStart').addEventListener('click', function () {
    $('tapStart').hidden = true; blocked = false;
    if (synth) { try { synth.cancel(); } catch (e) {} }
    pump();
  });
  $('rejoinBtn').addEventListener('click', join);
  endBtn.addEventListener('click', leave);

  function toggleMic() {
    micMuted = !micMuted;
    micBtn.setAttribute('aria-pressed', micMuted ? 'true' : 'false');
    selfTile.classList.toggle('muted', micMuted);
    if (micMuted) { stopListening(); setYou(''); if (!busy && !speakingNow) setStatus('idle', 'Mic muted'); }
    else if (stream) listenSoon(100);
  }
  micBtn.addEventListener('click', toggleMic);
  ccBtn.addEventListener('click', function () {
    var on = ccBtn.classList.toggle('on'); ccBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    $('captions').classList.toggle('off', !on);
  });
  chatBtn.addEventListener('click', function () {
    var p = $('chatPanel'); p.hidden = !p.hidden;
    chatBtn.setAttribute('aria-pressed', p.hidden ? 'false' : 'true');
  });
  $('chatClose').addEventListener('click', function () { $('chatPanel').hidden = true; chatBtn.setAttribute('aria-pressed', 'false'); });
  muteBtn.addEventListener('click', function () {
    muted = !muted; muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    if (muted && synth) synth.cancel();
  });
  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });

  // tap the AI while it talks to interrupt it and speak
  mainTile.addEventListener('click', function () {
    if (!inCall || !(speakingNow || streaming)) return;
    abortCurrent(); stopSpeaking(); streaming = false; busy = false; sendBtn.disabled = false;
    av.setState('idle'); listenSoon(150);
  });

  document.addEventListener('keydown', function (e) {
    if (!inCall || /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey) return;
    var k = e.key.toLowerCase();
    if (k === 'm') toggleMic(); else if (k === 'c') ccBtn.click(); else if (k === 't') chatBtn.click();
  });
  join();                                                        // no lobby: the call starts as soon as the page opens
  window.addEventListener('pagehide', function () { stopSpeaking(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); });
})();
