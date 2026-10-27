/* "Talk to my AI" — voice + text chat with an animated avatar.
 * Voice in : browser SpeechRecognition (Chrome/Edge/Safari). Voice out: browser SpeechSynthesis.
 * Brain    : POST AGENT_CONFIG.apiUrl (serverless proxy, key stays server-side). Streams SSE.
 * Fallback : a small built-in "lite mode" if the server is offline, rate-limited or not configured.
 */
(function () {
  'use strict';

  var cfg = window.AGENT_CONFIG || {};
  var API = cfg.apiUrl || '';
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {          // local testing only
    var q = new URLSearchParams(location.search).get('agentApi');
    if (q) API = q;
  }

  var root = document.getElementById('agent');
  if (!root || typeof window.createAvatar !== 'function') return;

  var el = function (id) { return document.getElementById(id); };
  var av = window.createAvatar(el('avatar'));
  var statusEl = el('agentStatus'), logEl = el('agentLog'), form = el('agentForm'),
      input = el('agentText'), micBtn = el('agentMic'), muteBtn = el('agentMute'),
      chips = el('agentChips'), sendBtn = el('agentSend');

  var GREETING = "Hi! I'm Jayson's AI twin. Ask me about my work, projects or skills, by voice or text.";
  var history = [];
  var busy = false, muted = false, liteMode = !API, aborter = null;
  var speakQ = [], speakingNow = false, streaming = false, timers = [];
  var recog = null, listening = false, litenoted = false;

  /* ---------- UI helpers ---------- */
  function setStatus(kind, text) {
    statusEl.setAttribute('data-state', kind);
    statusEl.querySelector('span').textContent = text;
  }
  function idleStatus() {
    setStatus('idle', liteMode ? 'Lite mode' : 'Ready');
  }
  function addMsg(role, text) {
    var d = document.createElement('div');
    d.className = 'msg ' + role;
    d.textContent = text;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
    return d;
  }
  function note(text) {
    var d = document.createElement('div');
    d.className = 'msg note';
    d.textContent = text;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------- speech out ---------- */
  var voice = null;
  var synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
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
    if (on) { av.setState('speaking'); setStatus('speaking', 'Speaking'); }
    else { av.setState('idle'); idleStatus(); }
  }

  function simulate(text, done) {                                    // muted or no TTS: still animate the mouth
    var words = text.split(/\s+/).length, dur = Math.max(700, words * 320);
    var iv = setInterval(function () { av.pulse(0.85); }, 170);
    var to = setTimeout(function () { clearInterval(iv); done(); }, dur);
    timers.push(iv, to);
  }

  function pump() {
    if (speakingNow) return;
    var text = speakQ.shift();
    if (!text) { if (!streaming) speakingUI(false); return; }
    speakingNow = true;
    speakingUI(true);
    var next = function () { speakingNow = false; pump(); };
    if (muted || !synth) return simulate(text, next);
    var u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = 1.03; u.pitch = 0.95;
    var gotBoundary = false, iv = null;
    u.onboundary = function () { gotBoundary = true; av.pulse(0.9); };
    u.onstart = function () {
      var to = setTimeout(function () {                              // some voices never fire word events
        if (!gotBoundary) iv = setInterval(function () { av.pulse(0.8); }, 180);
      }, 450);
      timers.push(to);
    };
    var end = function () { if (iv) clearInterval(iv); next(); };
    u.onend = end; u.onerror = end;
    synth.speak(u);
  }
  function enqueue(text) {
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    speakQ.push(text);
    pump();
  }
  function stopSpeaking() {
    speakQ = []; speakingNow = false; clearTimers();
    if (synth) synth.cancel();
    av.setLevel(null);
  }

  /* ---------- lite mode (no server) ---------- */
  var LITE = [
    [/\b(hi|hello|hey|kumusta|musta)\b/, 'happy', "Hi there! I'm Jayson's AI twin. Ask me about my work, projects or skills."],
    [/nativecamp|japan|english platform/, 'excited', "NativeCamp is a live English platform for Japan. I'm a Solutions Architect there and contributed AI coaching features and real-time lesson infrastructure."],
    [/claude|llm|dify|n8n|chatbot|agent|prompt|ai\b/, 'happy', "I lead an AI team building production chatbots and automation with Dify, n8n and the Claude, OpenAI and Gemini APIs, and I use Claude Code every day."],
    [/project|build|built|portfolio|work on/, 'excited', "I built Tubag AI, a tool-calling chat agent, Jay, a local voice assistant, and Inkwell Studio, an AI video pipeline. Plus NativeCamp at work."],
    [/skill|stack|tech|language|python|typescript|react|node/, 'neutral', "Mostly TypeScript, Python and PHP, with Node, Next.js, NestJS, Laravel, PostgreSQL and Docker, plus AI tooling like Dify, n8n and Ollama."],
    [/experience|years|background|who are you|about/, 'neutral', "I have about seven years of experience, three of them leading an AI team as Solutions Architect at Forty Degrees Celsius in Cebu."],
    [/hire|available|contact|email|salary|rate|price|job|work with/, 'serious', "For hiring or pricing, please email me at jadraquejaysonl@gmail.com. I reply personally."],
    [/real|human|ai\??$|robot|are you/, 'neutral', "I'm Jayson's AI twin, built for this site. I can answer questions about my work."]
  ];
  function lite(textIn) {
    var s = textIn.toLowerCase();
    for (var i = 0; i < LITE.length; i++) if (LITE[i][0].test(s)) return { emotion: LITE[i][1], text: LITE[i][2] };
    return { emotion: 'thinking', text: "I'm in lite mode right now, so I only know the basics. Ask about my experience, projects or skills, or email me at jadraquejaysonl@gmail.com." };
  }

  /* ---------- chat ---------- */
  var TAGS = /\[(neutral|happy|thinking|excited|serious)\]/gi;
  function parseReply(full) {
    var m = full.match(/^\s*\[([a-z]+)\]\s*/i);
    var emotion = null, body = full;
    if (m) { emotion = m[1].toLowerCase(); body = full.slice(m[0].length); }
    else if (/^\s*\[[a-z]*$/i.test(full)) return { wait: true };           // tag still arriving
    body = body.replace(TAGS, '').replace(/\*\*|__|`/g, '');
    return { emotion: emotion, body: body };
  }

  function abortCurrent() { if (aborter) { aborter.abort(); aborter = null; } }

  function finishTurn(bubble, shown) {
    streaming = false;
    bubble.classList.remove('typing');
    if (shown) history.push({ role: 'assistant', content: shown });
    if (history.length > 20) history = history.slice(-20);
    busy = false;
    sendBtn.disabled = false;
    pump();
  }

  async function ask(text) {
    text = (text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!text || busy) return;
    stopSpeaking(); abortCurrent();
    busy = true; sendBtn.disabled = true;
    addMsg('user', text);
    history.push({ role: 'user', content: text });
    input.value = '';
    av.setState('thinking'); setStatus('thinking', 'Thinking…');
    var bubble = addMsg('ai', ''); bubble.classList.add('typing');
    streaming = true;

    var full = '', spoken = 0, shownFinal = '', started = false;
    function onText() {
      var p = parseReply(full);
      if (p.wait) return;
      shownFinal = p.body;
      if (!started && p.body.trim()) {
        started = true;
        bubble.classList.remove('typing');
        av.setEmotion(p.emotion || 'neutral');
        speakingUI(true);
      }
      bubble.textContent = p.body;
      logEl.scrollTop = logEl.scrollHeight;
      var rest = p.body.slice(spoken), m;
      while ((m = rest.match(/^[\s\S]*?[.!?…]+["')\]]*(?=\s)/))) {          // finished sentences
        enqueue(m[0]); spoken += m[0].length; rest = p.body.slice(spoken);
      }
      if (rest.length > 170) {                                           // very long run: cut at a comma
        var cut = rest.lastIndexOf(',');
        if (cut > 60) { enqueue(rest.slice(0, cut + 1)); spoken += cut + 1; }
      }
    }

    try {
      if (!API) throw new Error('offline');
      aborter = new AbortController();
      var r = await fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-10) }), signal: aborter.signal
      });
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
      var rem = parseReply(full);
      var tail = (rem.body || '').slice(spoken).trim();
      if (tail) enqueue(tail);
      finishTurn(bubble, rem.body ? rem.body.trim() : '');
    } catch (err) {
      if (err && err.name === 'AbortError') { finishTurn(bubble, ''); return; }
      // fall back to lite mode
      var wasLive = !liteMode;
      liteMode = true;
      var rate = err && String(err.message) === '429';
      if (!started) { /* nothing shown yet */ }
      stopSpeaking();
      var a = lite(text);
      bubble.classList.remove('typing');
      bubble.textContent = a.text;
      av.setEmotion(a.emotion);
      if (!litenoted) {
        litenoted = true;
        note(rate ? 'Lots of visitors right now, so I am in lite mode for a bit.'
                  : (wasLive || API ? 'The AI server is offline, so I am answering in lite mode.' : 'Lite mode: answers are pre-written. The live AI is not connected yet.'));
      }
      streaming = true; speakQ = [];
      enqueue(a.text);
      history.push({ role: 'assistant', content: a.text });
      finishTurn(bubble, '');
    }
  }

  /* ---------- speech in ---------- */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function stopListening() { if (recog) { try { recog.stop(); } catch (e) {} } }
  function startListening() {
    if (!SR) return;
    stopSpeaking(); abortCurrent();
    recog = new SR();
    recog.lang = 'en-US'; recog.interimResults = true; recog.continuous = false; recog.maxAlternatives = 1;
    var finalText = '', failed = false;
    recog.onstart = function () {
      listening = true; micBtn.classList.add('on'); micBtn.setAttribute('aria-pressed', 'true');
      av.setState('listening'); setStatus('listening', 'Listening…'); input.placeholder = 'Listening…';
    };
    recog.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      input.value = (finalText + ' ' + interim).trim();
    };
    recog.onerror = function (e) {
      failed = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') note('Microphone access is blocked. You can allow it in your browser, or type your question.');
      else if (e.error === 'no-speech') note("I didn't hear anything. Tap the mic and try again.");
      else if (e.error !== 'aborted') note('Voice input had a problem. You can type your question instead.');
    };
    recog.onend = function () {
      listening = false; micBtn.classList.remove('on'); micBtn.setAttribute('aria-pressed', 'false');
      input.placeholder = 'Type a question…';
      var t = (finalText || input.value).trim();
      if (t && !failed) ask(t); else { input.value = ''; av.setState('idle'); idleStatus(); }
    };
    try { recog.start(); } catch (e) { /* already started */ }
  }

  micBtn.addEventListener('click', function () {
    if (listening) stopListening(); else startListening();            // tapping while it talks interrupts it
  });
  if (!SR) {
    micBtn.disabled = true;
    micBtn.title = 'Voice input needs Chrome, Edge or Safari. You can type instead.';
    micBtn.classList.add('off');
  }

  muteBtn.addEventListener('click', function () {
    muted = !muted;
    muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    muteBtn.classList.toggle('off', muted);
    muteBtn.title = muted ? 'Voice off' : 'Voice on';
    if (muted && synth) synth.cancel();
  });

  form.addEventListener('submit', function (e) { e.preventDefault(); ask(input.value); });
  chips.addEventListener('click', function (e) {
    var b = e.target.closest('button[data-q]');
    if (b) ask(b.getAttribute('data-q'));
  });

  /* ---------- start ---------- */
  addMsg('ai', GREETING);
  av.setEmotion('happy');
  idleStatus();
  if (!API) { litenoted = true; note('Lite mode: answers are pre-written. The live AI is not connected yet.'); }

  // pause the animation while the section is off-screen
  if ('IntersectionObserver' in window && av.pause) {
    new IntersectionObserver(function (es) { es[0].isIntersecting ? av.resume() : av.pause(); }, { threshold: 0.05 }).observe(root);
  }
  window.addEventListener('pagehide', function () { stopSpeaking(); });
})();
