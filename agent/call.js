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
  var IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var DEBUG = /[?&]debug=1/.test(location.search);
  var dbgEl = null;
  function dbg(msg) {                                               // on-screen log for phones: open the page with ?debug=1 and screenshot it
    if (!DEBUG) return;
    if (!dbgEl) {
      dbgEl = document.createElement('div');
      dbgEl.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:34vh;overflow:auto;z-index:99;background:#000c;color:#9fe;font:10px/1.3 monospace;padding:4px 6px;pointer-events:none;white-space:pre-wrap';
      document.body.appendChild(dbgEl);
      dbgEl.textContent = (IOS ? 'iOS ' : '') + navigator.userAgent.slice(0, 120) + '\n';
    }
    dbgEl.textContent += ((performance.now() / 1000).toFixed(1) + 's ' + msg + '\n');
    dbgEl.scrollTop = dbgEl.scrollHeight;
  }
  window.addEventListener('error', function (e) { dbg('ERROR ' + e.message); });
  var root = $('agent');
  var statusEl = $('agentStatus'), logEl = $('agentLog'), form = $('agentForm'), input = $('agentText'),
      sendBtn = $('agentSend'), micBtn = $('micBtn'), ccBtn = $('ccBtn'), chatBtn = $('chatBtn'),
      muteBtn = $('muteBtn'), endBtn = $('endBtn'), capAI = $('capAI'), capYou = $('capYou'),
      mainTile = $('mainTile'), selfTile = $('selfTile'), meter = $('meter');

  var GREETING = "Hey, thanks for calling! I'm the AI version of Jayson. What would you like to know about my work?";
  var history = [], busy = false, muted = false, micMuted = false, liteMode = !API, aborter = null;
  var speakQ = [], speakingNow = false, streaming = false, timers = [];
  var micGranted = false, srFails = 0, blocked = false, inCall = false, listening = false, recog = null, restartT = null, noSpeech = 0, litenoted = false;
  var stream = null, actx = null, analyser = null, levelBuf = null, startedAt = 0, tickT = null, rafId = 0;

  /* ---------- avatar (SVG now, 3D model when configured) ---------- */
  var svgAv = null, impl = null, lastState = 'idle', lastEmotion = 'happy';
  var av = {
    setState: function (s) { lastState = s; impl && impl.setState(s); },
    setEmotion: function (e) { lastEmotion = e; impl && impl.setEmotion(e); },
    pulse: function (x) { impl && impl.pulse(x); },
    setLevel: function (v) { impl && impl.setLevel(v); }
  };
  /* ----- which avatar: animated photo or 3D model (the viewer can switch; the choice is remembered) ----- */
  var AV_KEY = 'jaysonAvatarMode', buildId = 0;
  var modelUrl = cfg.avatarModel || '';
  if (isLocal && params.get('agentModel')) modelUrl = params.get('agentModel');
  var photoUrl = cfg.avatarPhoto || '';
  var avatarMode = (function () {
    var q = params.get('avatar');
    if (q === 'photo' || q === '3d' || q === 'svg') return q === '3d' && !modelUrl ? 'photo' : q;
    try { var saved = localStorage.getItem(AV_KEY); if (saved === 'photo' || (saved === '3d' && modelUrl)) return saved; } catch (e) {}
    return cfg.avatarDefault === '3d' && modelUrl ? '3d' : (photoUrl ? 'photo' : (modelUrl ? '3d' : 'svg'));
  })();

  function syncAvatar() { if (impl) { impl.setEmotion(lastEmotion); impl.setState(lastState); } }
  function destroyAvatar() {
    buildId++;                                                      // any build still loading is now stale and will discard itself
    if (impl && impl.destroy) impl.destroy();
    impl = null; svgAv = null;
    $('avatar').innerHTML = ''; $('avatar').classList.remove('has3d');
    mainTile.classList.remove('photo', 'model3d', 'loading3d');
  }
  function buildSvg() { svgAv = window.createAvatar($('avatar')); impl = svgAv; syncAvatar(); }
  function buildPhoto(id) {
    var noBg = isLocal && params.get('bg') === 'off';
    window.createPhotoAvatar($('avatar'), { url: photoUrl, bg: noBg ? '' : cfg.avatarBg, matte: noBg ? '' : cfg.avatarMatte })
      .then(function (pa) { if (id !== buildId) { pa.destroy(); return; } impl = pa; mainTile.classList.add('photo'); syncAvatar(); })
      .catch(function (err) { if (id !== buildId) return; if (window.console) console.warn('Portrait avatar unavailable:', err && err.message); photoUrl = ''; updateAvToggle(); buildSvg(); });
  }
  function build3D(id) {
    var layer = document.createElement('div');
    layer.className = 'avatar3d fill on';
    $('avatar').appendChild(layer);
    mainTile.classList.add('model3d', 'loading3d');
    import('./avatar3d.js')
      .then(function (m) { return m.createAvatar3D(layer, { url: modelUrl, extent: isLocal && params.get('extent') ? +params.get('extent') : cfg.avatarExtent, lookDown: isLocal && params.get('lookDown') ? +params.get('lookDown') : cfg.avatarLookDown, rotateY: cfg.avatarRotateY, armDrop: isLocal && params.get('armDrop') ? +params.get('armDrop') : cfg.avatarArmDrop, armAxis: isLocal && params.get('armAxis') || cfg.avatarArmAxis }); })
      .then(function (a3) {
        if (id !== buildId) { a3.destroy(); return; }
        mainTile.classList.remove('loading3d'); impl = a3; if (isLocal) window.__avatar3d = a3; syncAvatar();
      })
      .catch(function (err) {                                       // WebGL missing or the model failed: fall back to the photo
        if (id !== buildId) return;
        if (window.console) console.warn('3D avatar unavailable:', err && err.message);
        modelUrl = ''; avatarMode = photoUrl ? 'photo' : 'svg'; destroyAvatar(); updateAvToggle(); buildAvatar();
      });
  }
  function buildAvatar() {
    var id = buildId;
    if (avatarMode === '3d' && modelUrl) return build3D(id);
    if (avatarMode !== 'svg' && photoUrl && window.createPhotoAvatar) return buildPhoto(id);
    buildSvg();
  }
  function updateAvToggle() {
    var btn = $('avBtn');
    if (!btn) return;
    btn.hidden = !(modelUrl && photoUrl) || avatarMode === 'svg';
    var is3d = avatarMode === '3d';
    btn.setAttribute('aria-pressed', is3d ? 'true' : 'false');
    btn.classList.toggle('on', is3d);
    $('avLabel').textContent = is3d ? '3D' : 'Photo';
    btn.title = is3d ? 'Using the 3D avatar. Click for the photo avatar.' : 'Using the photo avatar. Click for the 3D avatar.';
  }
  function switchAvatar(mode) {
    if (mode === avatarMode) return;
    avatarMode = mode;
    try { localStorage.setItem(AV_KEY, mode); } catch (e) {}
    destroyAvatar(); updateAvToggle(); buildAvatar();
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
  /* ----- natural voice: Gemini speech streamed from /api/tts, played with Web Audio (browser voice is the fallback) ----- */
  var TTS = cfg.ttsUrl || (API ? API.replace(/\/api\/chat\/?$/, '/api/tts') : '');
  if (isLocal && params.get('tts') === 'off') TTS = '';
  var TTS_VOICE = cfg.ttsVoice || (isLocal && params.get('voice')) || '';
  var ttsFails = 0, ttsOffUntil = 0, outCtx = null, outAn = null, outBuf = null, playHead = 0, liveSrc = [], levelRaf = 0;

  function ensureOut() {
    if (outCtx) return outCtx;
    try {
      outCtx = new (window.AudioContext || window.webkitAudioContext)();
      outAn = outCtx.createAnalyser(); outAn.fftSize = 512;
      outAn.connect(outCtx.destination);
      outCtx.onstatechange = function () { dbg('audio ' + (outCtx && outCtx.state)); };
      outBuf = new Uint8Array(outAn.fftSize);
    } catch (e) { outCtx = null; }
    return outCtx;
  }
  function wakeAudio() { if (outCtx && outCtx.state !== 'running') { try { outCtx.resume().catch(function () {}); } catch (e) {} } }
  ['touchend', 'click'].forEach(function (ev) { document.addEventListener(ev, wakeAudio, { passive: true }); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wakeAudio(); });
  function ttsOn() { return TTS && Date.now() >= ttsOffUntil && !muted && ensureOut(); }   // after repeated failures the browser voice covers for ~20s, then the natural voice is tried again

  function fetchSpeech(text) {                                      // starts downloading right away, so it's ready when its turn comes
    var job = { chunks: [], done: false, failed: false, wake: null, ctrl: new AbortController(), got: false };
    var ping = function () { if (job.wake) { var w = job.wake; job.wake = null; w(); } };
    var timer = setTimeout(function () { if (!job.got) { job.failed = true; job.ctrl.abort(); ping(); } }, 8000);
    fetch(TTS, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: job.ctrl.signal,
                 body: JSON.stringify({ text: text, voice: TTS_VOICE || undefined }) })
      .then(function (r) {
        if (!r.ok || !r.body) throw new Error(String(r.status));
        var reader = r.body.getReader(), left = null;
        function step() {
          return reader.read().then(function (x) {
            if (x.done) { job.done = true; ping(); return; }
            var u8 = x.value;
            if (left !== null) { var m = new Uint8Array(u8.length + 1); m[0] = left; m.set(u8, 1); u8 = m; left = null; }
            if (u8.length % 2) { left = u8[u8.length - 1]; u8 = u8.subarray(0, u8.length - 1); }
            var n = u8.length >> 1, f = new Float32Array(n), dv = new DataView(u8.buffer, u8.byteOffset, u8.length);
            for (var i = 0; i < n; i++) f[i] = dv.getInt16(i * 2, true) / 32768;
            if (n) { if (!job.got) ttsFails = 0; job.got = true; clearTimeout(timer); job.chunks.push(f); ping(); }
            return step();
          });
        }
        return step();
      })
      .catch(function () { if (!job.got) job.failed = true; job.done = true; ping(); })
      .then(function () { clearTimeout(timer); });
    return job;
  }

  /* ----- recorded answers in Jayson's own voice (cloned offline): agent/clips/clips.json + one .m4a per answer ----- */
  var CLIPS = {};
  var clipsReady = fetch('agent/clips/clips.json').then(function (r) { return r.ok ? r.json() : []; })
    .then(function (list) { list.forEach(function (c) { CLIPS[c.id] = c; }); }).catch(function () {});

  function fetchClip(id) {
    var job = { chunks: [], done: false, failed: false, wake: null, ctrl: new AbortController(), got: false, rate: 44100 };
    var ping = function () { if (job.wake) { var w = job.wake; job.wake = null; w(); } };
    fetch('agent/clips/' + id + '.m4a', { signal: job.ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(function (buf) { return ensureOut().decodeAudioData(buf); })
      .then(function (ab) { job.rate = ab.sampleRate; job.chunks.push(ab.getChannelData(0)); job.got = true; job.done = true; ping(); })
      .catch(function () { job.failed = true; job.done = true; ping(); });
    return job;
  }
  function enqueueClip(id) {                                        // if the recording cannot load, the same words are spoken by the normal voice
    var c = CLIPS[id];
    if (!c) return false;
    speakQ.push({ text: c.text, job: !muted && ensureOut() ? fetchClip(id) : null });
    pump();
    return true;
  }

  function fetchStatic(url) {                                       // a pre-recorded clip (the greeting): no API call, no quota
    var job = { chunks: [], done: false, failed: false, wake: null, ctrl: new AbortController(), got: false };
    var ping = function () { if (job.wake) { var w = job.wake; job.wake = null; w(); } };
    fetch(url, { signal: job.ctrl.signal })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then(function (buf) {
        var n = (buf.byteLength - 44) >> 1, f = new Float32Array(n), dv = new DataView(buf, 44);   // 44-byte WAV header, 16-bit mono 24 kHz
        for (var i = 0; i < n; i++) f[i] = dv.getInt16(i * 2, true) / 32768;
        job.chunks.push(f); job.got = true; job.done = true; ping();
      })
      .catch(function () { job.failed = true; job.done = true; ping(); });
    return job;
  }

  function levelLoop() {
    if (levelRaf) return;
    (function tick() {
      if (!outCtx || outCtx.currentTime > playHead + 0.15) { levelRaf = 0; av.setLevel(ttsOn() ? 0 : null); return; }   // under the natural voice the mouth stays shut until audio drives it
      outAn.getByteTimeDomainData(outBuf);
      var sum = 0; for (var i = 0; i < outBuf.length; i++) { var v = (outBuf[i] - 128) / 128; sum += v * v; }
      av.setLevel(Math.min(1, Math.sqrt(sum / outBuf.length) * 5));
      levelRaf = requestAnimationFrame(tick);
    })();
  }
  function audioLeftMs() { return outCtx ? Math.max(0, (playHead - outCtx.currentTime) * 1000) : 0; }

  async function playJob(item, next) {                              // schedule streamed chunks back to back, gapless
    var job = item.job, ctx = outCtx, idx = 0, scheduled = false;
    if (ctx.state !== 'running') { try { await Promise.race([ctx.resume(), new Promise(function (r) { setTimeout(r, 250); })]); } catch (e) {} }
    if (ctx.state !== 'running') { dbg('audio blocked: ' + ctx.state); return soundBlocked(item); }
    for (;;) {
      if (job.ctrl.signal.aborted && !job.got) break;
      while (idx < job.chunks.length) {
        var f = job.chunks[idx++], buf = ctx.createBuffer(1, f.length, job.rate || 24000);
        buf.copyToChannel(f, 0);
        var src = ctx.createBufferSource(); src.buffer = buf; src.connect(outAn);
        var at = Math.max(ctx.currentTime + 0.04, playHead);
        if (!scheduled) speakingUI(true);                             // audio is really starting now: face, status and border follow
        src.start(at); playHead = at + buf.duration; scheduled = true;
        liveSrc.push(src); src.onended = function () { var k = liveSrc.indexOf(this); if (k >= 0) liveSrc.splice(k, 1); };
        levelLoop();
      }
      if (job.done) break;
      await new Promise(function (r) { job.wake = r; });
    }
    if (!scheduled) {                                               // TTS failed before any audio: use the browser voice for this sentence
      if (++ttsFails >= 2) ttsOffUntil = Date.now() + 20000;
      return speakWhenQuiet(item.text, next);
    }
    next();                                                         // everything is queued on the audio clock; the next sentence follows seamlessly
  }

  function soundBlocked(item) {
    speakQ.unshift(item); speakingNow = false; blocked = true;
    speakingUI(false); setStatus('idle', 'Tap to start sound'); $('tapStart').hidden = false;
  }

  // Natural-voice sentences are queued on the audio clock and the queue moves on early, so an earlier sentence can still be
  // playing. The browser voice must never start on top of it (that was the 'two voices at once' bug): wait until it ends.
  function speakWhenQuiet(text, next) {
    var left = audioLeftMs();
    if (left > 30) { timers.push(setTimeout(function () { speakWhenQuiet(text, next); }, left + 25)); return; }
    speakBrowser(text, next);
  }

  function speakBrowser(text, next) {
    speakingUI(true);
    if (muted || !synth) return simulate(text, next);
    var u = new SpeechSynthesisUtterance(text);
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-US';
    u.rate = 1.03; u.pitch = 0.95;
    var gotBoundary = false, iv = null;
    u.onboundary = function () { gotBoundary = true; av.pulse(0.9); };
    u.onstart = function () {
      timers.push(setTimeout(function () { if (!gotBoundary) iv = setInterval(function () { av.pulse(0.8); }, 180); }, 450));
    };
    var finished = false, wd = null;
    var end = function () { if (finished) return; finished = true; clearTimeout(wd); if (iv) clearInterval(iv); dbg('speech end'); next(); };
    u.onend = end;
    u.onerror = function (e) {
      dbg('speech error ' + (e && e.error));
      if (e && e.error === 'not-allowed') { finished = true; clearTimeout(wd); if (iv) clearInterval(iv); soundBlocked({ text: text, job: null }); return; }
      end();
    };
    wd = setTimeout(function () { dbg('speech watchdog: no end event'); try { synth.cancel(); } catch (e) {} end(); }, Math.max(3500, text.length * 110 + 2500));   // iOS Safari can drop the end event
    timers.push(wd);
    dbg('speak ' + text.length + ' chars');
    synth.speak(u);
  }

  function pump() {
    if (speakingNow || blocked) return;
    var item = speakQ.shift();
    if (!item) {
      if (streaming) return;
      var left = audioLeftMs();
      if (left > 30) { speakingNow = true; timers.push(setTimeout(function () { speakingNow = false; pump(); }, left)); return; }   // let the audio finish
      speakingUI(false); listenSoon(300); return;
    }
    speakingNow = true; if (!item.job) speakingUI(true); stopListening();
    var next = function () { speakingNow = false; pump(); };
    if (item.job) playJob(item, next); else speakWhenQuiet(item.text, next);
  }
  function enqueue(text) {
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    var job = null;
    if (text === GREETING && !muted && ensureOut()) job = CLIPS.greeting ? fetchClip('greeting') : fetchStatic('agent/greeting.wav');
    else if (ttsOn()) job = fetchSpeech(text);
    speakQ.push({ text: text, job: job });
    pump();
  }
  function stopSpeaking() {
    speakQ.forEach(function (i) { if (i.job) { i.job.ctrl.abort(); i.job.done = true; if (i.job.wake) i.job.wake(); } });
    speakQ = []; speakingNow = false; clearTimers();
    liveSrc.forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} }); liveSrc = [];
    if (outCtx) playHead = 0;
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

    var full = '', spoken = 0, started = false, clipId = null;
    function onText() {
      var p = parseReply(full);
      if (p.wait) return;
      if (!clipId) {                                                 // "[clip:intro]" means: play my recorded answer instead of speaking generated text
        var cm = p.body.match(/^\s*\[clip:([a-z0-9_]+)\]/i);
        if (cm && CLIPS[cm[1].toLowerCase()] && cm[1].toLowerCase() !== 'greeting') {
          clipId = cm[1].toLowerCase();
          started = true; bubble.classList.remove('typing'); av.setEmotion(p.emotion || 'neutral');
          bubble.textContent = CLIPS[clipId].text; capAI.textContent = CLIPS[clipId].text; logEl.scrollTop = logEl.scrollHeight;
          enqueueClip(clipId);
          return;
        }
        if (/^\s*\[(c|cl|cli|clip|clip:[a-z0-9_]*)$/i.test(p.body)) return;   // tag still arriving
      }
      if (clipId) return;                                            // the rest of the stream (if any) is ignored
      if (!started && p.body.trim()) { started = true; bubble.classList.remove('typing'); av.setEmotion(p.emotion || 'neutral'); if (!ttsOn()) speakingUI(true); }   // with the natural voice, 'speaking' starts when the audio does
      bubble.textContent = p.body; capAI.textContent = p.body.slice(-220);
      logEl.scrollTop = logEl.scrollHeight;
      var rest = p.body.slice(spoken), m;
      while ((m = rest.match(/^[\s\S]*?[.!?…]+["')\]]*(?=\s)/))) { enqueue(m[0]); spoken += m[0].length; rest = p.body.slice(spoken); }
      if (!spoken && rest.length > 45) {                                // first words out fast: speak the first clause
        var c1 = rest.slice(25).search(/[,;:\u2014-]\s/);
        if (c1 >= 0) { enqueue(rest.slice(0, 25 + c1 + 1)); spoken += 25 + c1 + 1; rest = p.body.slice(spoken); }
      }
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
      if (clipId) { finishTurn(bubble, CLIPS[clipId].text); return; }
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
  function canListen() { return inCall && SR && (stream || micGranted) && !micMuted && !busy && !streaming && !speakingNow && !speakQ.length; }
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
    var finalText = '', fatal = false, endT = null;
    r.onstart = function () { dbg('recognition started'); clearTimeout(startWd); listening = true; micBtn.classList.add('listening'); av.setState('listening'); setStatus('listening', 'Listening…'); };
    r.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) { var x = e.results[i]; if (x.isFinal) finalText += x[0].transcript; else interim += x[0].transcript; }
      setYou((finalText + ' ' + interim).trim()); noSpeech = 0;
      clearTimeout(endT);                                              // no new words for ~0.9s: they're done talking
      endT = setTimeout(function () { if (recog === r) { try { r.stop(); } catch (e) {} } }, 900);
    };
    r.onerror = function (e) {
      dbg('recognition error: ' + e.error);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { fatal = true; note('The microphone is blocked. Allow it in your browser, or type in the chat.'); micBtn.setAttribute('aria-pressed', 'true'); micMuted = true; }
      else if (e.error === 'no-speech') noSpeech++;
      else if (e.error === 'network') { fatal = true; note('Voice recognition lost its connection. Tap the mic to try again, or type in the chat.'); micMuted = true; micBtn.setAttribute('aria-pressed', 'true'); }
      else if (e.error !== 'aborted') srFails++;                       // audio-capture and friends: the browser could not hear the mic this time
    };
    r.onend = function () {
      if (recog !== r) return;
      clearTimeout(endT); clearTimeout(startWd);
      recog = null; listening = false; micBtn.classList.remove('listening');
      var t = (finalText || '').trim();
      dbg('recognition end, heard: ' + (t ? '"' + t.slice(0, 40) + '"' : 'nothing'));
      if (t) { srFails = 0; ask(t); return; }
      setYou(''); av.setState('idle');
      if (srFails >= 2) { setStatus('idle', 'Tap to talk'); return; }   // automatic listening keeps failing here: wait for the Tap to talk button instead of looping
      if (!fatal && inCall) { if (!busy) setStatus('listening', 'Listening…'); listenSoon(IOS ? 900 : (noSpeech > 3 ? 1500 : 250)); }
      else if (fatal) setStatus('idle', 'Mic off');
    };
    var startWd = setTimeout(function () {                              // iOS sometimes accepts start() and then never starts or ends
      if (recog === r && !listening) { dbg('recognition never started'); srFails++; stopListening(); if (srFails < 2) listenSoon(900); else setStatus('idle', 'Tap to talk'); }
    }, 3500);
    try { dbg('recognition start'); r.start(); } catch (e) { dbg('start threw: ' + e.message); recog = null; srFails++; clearTimeout(startWd); if (srFails < 2) listenSoon(900); else setStatus('idle', 'Tap to talk'); }
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
    if (IOS && synth) { try { var u0 = new SpeechSynthesisUtterance(' '); u0.volume = 0; synth.speak(u0); } catch (e) {} }   // iOS only allows speech after one spoken in a tap
    ttsFails = 0; srFails = 0; ensureOut(); wakeAudio();
    var micOk = false;
    if (IOS && SR) { micOk = true; micGranted = true; }                 // iOS: recognition asks for the mic itself; holding a second mic stream breaks it
    else if (SR && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micOk = true;
      } catch (e) { stream = null; }
    }
    $('ended').hidden = true; $('callUI').hidden = false; root.dataset.phase = 'call';
    destroyAvatar();
    inCall = true; startedAt = Date.now(); busy = false;
    updateAvToggle(); buildAvatar();
    logEl.innerHTML = ''; history = []; litenoted = false; capAI.textContent = ''; capYou.textContent = '';
    tickT = setInterval(function () { $('timer').textContent = fmt(Math.floor((Date.now() - startedAt) / 1000)); }, 1000);
    if (micOk && stream) startMeter();
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
    await Promise.race([clipsReady, new Promise(function (r) { setTimeout(r, 1500); })]);          // so the greeting uses the recorded voice
    streaming = false; enqueue(GREETING);
  }
  function leave() {
    inCall = false; stopListening(); stopSpeaking(); abortCurrent();
    clearInterval(tickT); cancelAnimationFrame(rafId);
    if (outCtx) { try { outCtx.close(); } catch (e) {} outCtx = null; playHead = 0; liveSrc = []; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (actx) { try { actx.close(); } catch (e) {} actx = null; }
    var secs = Math.floor((Date.now() - startedAt) / 1000);
    $('endedTime').textContent = 'Call length ' + fmt(secs) + '. Thanks for stopping by.';
    $('callUI').hidden = true; $('ended').hidden = false; root.dataset.phase = 'ended';
    destroyAvatar();
    streaming = false; busy = false; speakQ = []; speakingNow = false;
  }

  $('tapStart').addEventListener('click', function () {
    $('tapStart').hidden = true; blocked = false;
    if (synth) { try { synth.cancel(); } catch (e) {} }
    if (outCtx) { try { outCtx.resume(); } catch (e) {} }
    pump();
  });
  $('rejoinBtn').addEventListener('click', join);
  endBtn.addEventListener('click', leave);

  function toggleMic() {
    micMuted = !micMuted;
    micBtn.setAttribute('aria-pressed', micMuted ? 'true' : 'false');
    selfTile.classList.toggle('muted', micMuted);
    if (micMuted) { stopListening(); setYou(''); if (!busy && !speakingNow) setStatus('idle', 'Mic muted'); }
    else if (stream || micGranted) { srFails = 0; listenSoon(100); }
  }
  micBtn.addEventListener('click', toggleMic);
  $('avBtn').addEventListener('click', function () { switchAvatar(avatarMode === '3d' ? 'photo' : '3d'); });
  var talkBtn = $('talkBtn');
  talkBtn.addEventListener('click', function () { srFails = 0; talkBtn.hidden = true; startListening(); });   // starting inside a tap always counts as a user gesture
  setInterval(function () {                                           // offered on iPhone whenever it is my turn, and anywhere automatic listening keeps failing
    var show = inCall && SR && (stream || micGranted) && !micMuted && !listening && !busy && !streaming && !speakingNow && !speakQ.length && !blocked && (IOS || srFails >= 2);
    if (talkBtn.hidden === show) talkBtn.hidden = !show;
  }, 400);
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
  if (isLocal) window.__callDebug = function () { return { ttsUrl: TTS, ttsFails: ttsFails, ctx: outCtx && outCtx.state, ahead: outCtx ? +(playHead - outCtx.currentTime).toFixed(2) : null, blocked: blocked, mouth: impl && impl.debugOpen ? impl.debugOpen() : null }; };
  window.addEventListener('pagehide', function () { stopSpeaking(); if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); });
})();
