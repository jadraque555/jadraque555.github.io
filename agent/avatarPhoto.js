/* Talking-photo avatar: brings a real portrait to life on a canvas.
 *   createPhotoAvatar(container, { url }) -> Promise<avatar>   (same interface as avatar.js / avatar3d.js)
 * What moves: jaw and mouth follow the voice; eyelids blink; eyes glance around; eyebrows lift on emphasis, questions
 * and while listening; the head drifts, tilts and nods; the chest breathes. Emotion tags shift brows, gaze and posture.
 * Landmark numbers are pixel positions measured on img/avatar-portrait.jpg (900x900).
 */
(function () {
  'use strict';
  var LM = {
    size: 900,
    eyes: [{ x: 399, y: 181, rx: 40, ry: 14 }, { x: 533, y: 182, rx: 40, ry: 14 }],
    mouth: { cx: 465, top: 317, lip: 327, rx: 50, maxDrop: 16 },  // top = row just under the upper teeth, lip = where the lower lip begins; the jaw moves down from there
    jaw: { x0: 366, x1: 566, full: 400, end: 482 },         // columns warped, row where the full drop fades out, row where it stops
    brow: { x0: 366, x1: 566, y0: 146, peak: 157, y1: 173 },// band lifted for eyebrow motion
    gazeClip: { rx: 30, ry: 8, dy: 1.5 },                   // the visible eye opening, where the iris may move
    focus: { x: 463, y: 330 },
    pivot: { x: 463, y: 600 },                              // neck: the head rotates around here
    chestY: 470                                             // below this row the torso "breathes"
  };
  // per emotion: brow lift (px), head tilt (rad), lean-in (scale), gaze centre (px)
  var EMO = {
    neutral:   { brow: 0,   tilt: 0,      lean: 0,     gx: 0,    gy: 0 },
    happy:     { brow: 1.2, tilt: 0.004,  lean: 0,     gx: 0,    gy: 0 },
    excited:   { brow: 3.2, tilt: 0,      lean: 0.012, gx: 0,    gy: 0 },
    thinking:  { brow: 2.2, tilt: -0.014, lean: 0,     gx: -2.4, gy: -1.8 },
    serious:   { brow: -1.4, tilt: 0,     lean: 0.006, gx: 0,    gy: 0 },
    listening: { brow: 1.8, tilt: 0.006,  lean: 0.01,  gx: 0,    gy: 0 }
  };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var smooth = function (t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  function createPhotoAvatar(container, opts) {
    var load = function (url) {
      return new Promise(function (resolve, reject) {
        var i = new Image(); i.onload = function () { resolve(i); }; i.onerror = function () { reject(new Error('failed to load ' + url)); }; i.src = url;
      });
    };
    var optional = function (url) { return url ? load(url).catch(function () { return null; }) : Promise.resolve(null); };   // no office image or matte: keep the original studio backdrop
    return Promise.all([load(opts.url), optional(opts.bg), optional(opts.matte)])
      .then(function (r) { return build(container, r[0], r[1], r[2]); });
  }

  function build(container, img, bgImg, matteImg) {
    var N = LM.size;
    var src = document.createElement('canvas'); src.width = src.height = N;
    var sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0, N, N);
    var hasBg = !!(bgImg && matteImg);
    if (hasBg) {                                                    // cut the person out of the studio backdrop: alpha comes from the matte
      var mc = document.createElement('canvas'); mc.width = mc.height = N;
      var mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(matteImg, 0, 0, N, N);
      var md = mg.getImageData(0, 0, N, N).data, pd = sg.getImageData(0, 0, N, N);
      for (var q = 0; q < N * N; q++) pd.data[q * 4 + 3] = md[q * 4];
      sg.putImageData(pd, 0, 0);
    }
    var ov = document.createElement('canvas'); ov.width = N; ov.height = N; var og = ov.getContext('2d');
    var wk = document.createElement('canvas'); wk.width = wk.height = N; var wg = wk.getContext('2d');
    var lc = document.createElement('canvas'); lc.width = 130; lc.height = 56; var lg = lc.getContext('2d');

    var canvas = document.createElement('canvas');
    canvas.className = 'photoav'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Animated portrait of Jayson');
    container.appendChild(canvas);
    var g = canvas.getContext('2d');
    var cw = 0, ch = 0, dpr = 1;
    function resize() {
      var r = container.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.max(2, Math.round(r.width * dpr)); ch = Math.max(2, Math.round(r.height * dpr));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    }
    resize();
    var ro = 'ResizeObserver' in window ? new ResizeObserver(resize) : null; if (ro) ro.observe(container);

    var S = { open: 0, amp: 1, level: null, energy: 0, brow: 0, bump: 0, tilt: 0, lean: 0, gx: 0, gy: 0, tgx: 0, tgy: 0, yaw: 0, tyaw: 0, nod: -1, prevTalk: 0 };
    var state = 'idle', T = EMO.neutral;
    var now0 = performance.now();
    var blinkAt = now0 + 2600, blinkT = -1, gazeAt = now0 + 1500, yawAt = now0 + 3000, nodAt = now0 + 2500, browAt = now0 + 2000;
    var running = true, raf = 0, last = now0;

    /* ---- warp a horizontal band of the photo up/down (strips), feathered at both sides ---- */
    function warpBand(x0, x1, yA, yB, shiftAt, fadeRows, alpha) {
      og.clearRect(0, 0, N, N);
      var sw = x1 - x0;
      for (var y = yA; y < yB; y += 2) {
        og.globalAlpha = fadeRows ? clamp((y - yA) / fadeRows, 0, 1) : 1;                // soft top edge, so no hard cut line
        og.drawImage(src, x0, y, sw, 2, x0, y + shiftAt(y), sw, 3.5);
      }
      og.globalAlpha = 1;
      og.globalCompositeOperation = 'destination-in';
      var fg = og.createLinearGradient(x0, 0, x1, 0);
      fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(0.16, '#000'); fg.addColorStop(0.84, '#000'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      og.fillStyle = fg; og.fillRect(0, 0, N, N);
      og.globalCompositeOperation = 'source-over';
      wg.globalAlpha = alpha == null ? 1 : alpha;
      wg.drawImage(ov, 0, 0);
      wg.globalAlpha = 1;
    }

    function drawBrows(b) {                                         // + lifts the brow band, - lowers it
      var B = LM.brow;
      warpBand(B.x0, B.x1, B.y0, B.y1, function (y) {
        var w = y < B.peak ? smooth((y - B.y0) / (B.peak - B.y0)) : smooth((B.y1 - y) / (B.y1 - B.peak));
        return -b * w;
      });
    }

    function drawGaze() {                                           // slide the iris inside the eye opening
      if (Math.abs(S.gx) < 0.15 && Math.abs(S.gy) < 0.15) return;
      var c = LM.gazeClip;
      LM.eyes.forEach(function (e) {
        wg.save();
        wg.beginPath(); wg.ellipse(e.x, e.y + c.dy, c.rx, c.ry, 0, 0, Math.PI * 2); wg.clip();
        wg.drawImage(src, e.x - c.rx - 4 - S.gx, e.y + c.dy - c.ry - 4 - S.gy, c.rx * 2 + 8, c.ry * 2 + 8, e.x - c.rx - 4, e.y + c.dy - c.ry - 4, c.rx * 2 + 8, c.ry * 2 + 8);
        wg.restore();
      });
    }

    // 0 at the mouth corners, 1 in the middle: the jaw moves most in the centre, so the opening is a rounded bowl, not a straight slot
    function mouthWeight(x, R) {
      var u = (x - LM.mouth.cx) / R;
      return u <= -1 || u >= 1 ? 0 : Math.pow(1 - u * u, 0.7);
    }

    function drawMouth(d) {
      var m = LM.mouth, j = LM.jaw, lip = m.lip, R = m.rx + 3;
      var ta = 1 - smooth((d - 2) / 5);                                // 1 = lower teeth still show, 0 = hidden in shadow
      var xa = Math.floor(m.cx - R), xb = Math.ceil(m.cx + R), x, w;

      // inside of the mouth: flat top under the upper teeth, bottom following the curve of the moving lower lip
      var deep = (1 - ta) * (lip - m.top);                             // lower-teeth zone, swallowed by shadow on wide openings
      wg.save();
      var gr = wg.createLinearGradient(0, m.top, 0, lip + d + 2);
      gr.addColorStop(0, '#26100f'); gr.addColorStop(0.5, '#3d1718'); gr.addColorStop(1, '#5a2427');
      wg.fillStyle = gr;
      wg.beginPath();
      wg.moveTo(xa + 2, m.top - 0.5);
      for (x = xa + 2; x <= xb - 2; x += 1) {
        w = mouthWeight(x, R);
        var edge = clamp((1 - Math.abs(x - m.cx) / R) / 0.4, 0, 1);    // thins out toward the corners
        wg.lineTo(x, m.top + 1 + d * w + deep * edge * edge * (3 - 2 * edge));
      }
      wg.lineTo(xb - 2, m.top - 0.5); wg.closePath(); wg.fill();
      if (d > 7) {                                                     // a hint of tongue on a wide opening
        var ty = lip + d - 2, tr = wg.createRadialGradient(m.cx, ty, 1, m.cx, ty, m.rx * 0.55);
        tr.addColorStop(0, 'rgba(188,94,100,.8)'); tr.addColorStop(1, 'rgba(150,70,76,0)');
        wg.fillStyle = tr; wg.beginPath(); wg.ellipse(m.cx, ty, m.rx * 0.5, Math.min(9, d * 0.5), 0, 0, Math.PI * 2); wg.fill();   // rounded, no hard block
      }
      wg.restore();

      // jaw: column by column, so the lower lip's top edge is a smooth curve
      og.clearRect(0, 0, N, N);
      for (x = xa; x < xb; x += 1) {
        var sh = d * mouthWeight(x + 0.5, R);
        if (sh < 0.15) continue;                                       // this column barely moves: the base photo already shows it
        if (ta > 0.02) {                                               // lower teeth ride down on small openings and fade on wide ones
          og.globalAlpha = ta;
          og.drawImage(src, x, m.top, 1, lip - m.top, x, m.top + sh * 0.96, 1, lip - m.top);
          og.globalAlpha = 1;
        }
        og.globalAlpha = 0.35; og.drawImage(src, x, lip, 1, 1.5, x, lip + sh, 1.3, 1.5);                     // soft top edge on the lip, so the curve has no hard steps
        og.globalAlpha = 0.7;  og.drawImage(src, x, lip + 1.5, 1, 1.5, x, lip + sh + 1.5, 1.3, 1.5);
        og.globalAlpha = 1;    og.drawImage(src, x, lip + 3, 1, j.full - lip - 3, x, lip + sh + 3, 1.3, j.full - lip - 3);   // lower lip and chin
        og.drawImage(src, x, j.full, 1, j.end - j.full, x, j.full + sh, 1.3, j.end - j.full - sh);        // fades out toward the neck
      }
      wg.drawImage(ov, 0, 0);
    }

    function drawLids(p) {                                          // blink: skin texture from above the eye, stretched down
      if (p < 0.04) return;
      LM.eyes.forEach(function (e) {
        var w = e.rx * 2 + 8, h = e.ry * 2 + 10, top = e.y - e.ry - 4, cover = Math.max(2, h * p);
        lg.clearRect(0, 0, lc.width, lc.height);
        lg.drawImage(src, e.x - e.rx - 4, e.y - e.ry - 12, w, 9, 0, 0, w, cover);
        lg.globalCompositeOperation = 'destination-in';
        var rg = lg.createRadialGradient(w / 2, cover * 0.45, 2, w / 2, cover * 0.45, w / 2);
        rg.addColorStop(0, '#000'); rg.addColorStop(0.72, '#000'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        lg.fillStyle = rg; lg.fillRect(0, 0, lc.width, lc.height);
        lg.globalCompositeOperation = 'source-over';
        wg.drawImage(lc, 0, 0, w, cover + 2, e.x - e.rx - 4, top, w, cover + 2);
        if (p > 0.35) {                                             // lash line only once the lid is mostly down
          var edge = top + cover, a = (p - 0.35) / 0.65;
          wg.strokeStyle = 'rgba(36,22,18,' + (0.55 * a) + ')'; wg.lineWidth = 1.7; wg.lineCap = 'round';
          wg.beginPath(); wg.moveTo(e.x - e.rx + 3, edge - 0.5); wg.quadraticCurveTo(e.x, edge + 1.5 + p * 3, e.x + e.rx - 3, edge - 0.5); wg.stroke();
        }
      });
    }

    function backdrop(ox, oy, w, h) {                               // extend the photo's own edge colours sideways and up
      var e = 14;
      g.fillStyle = '#9d9fa6'; g.fillRect(0, 0, cw, ch);
      g.drawImage(src, 0, 0, e, N, 0, oy, ox + 3, h);                         // left
      g.drawImage(src, N - e, 0, e, N, ox + w - 3, oy, cw - (ox + w) + 3, h); // right
      if (oy > 0) {
        g.drawImage(src, 0, 0, N, 6, ox, 0, w, oy + 3);                       // top
        g.drawImage(src, 0, 0, e, 6, 0, 0, ox + 3, oy + 3);
        g.drawImage(src, N - e, 0, e, 6, ox + w - 3, 0, cw - (ox + w) + 3, oy + 3);
      }
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var t = now / 1000, k = 1 - Math.exp(-dt * 8);
      var speaking = state === 'speaking', listening = state === 'listening', thinking = state === 'thinking';

      S.tilt = lerp(S.tilt, T.tilt, k); S.lean = lerp(S.lean, T.lean, k);

      // ---- mouth: follows the voice; every new syllable picks a slightly different opening ----
      S.energy *= Math.exp(-dt * 11);
      var talk = 0;
      if (S.level != null) talk = S.level;
      else if (speaking) talk = Math.max(S.energy, 0.2 + 0.16 * Math.sin(t * 13) + 0.1 * Math.sin(t * 21 + 1));
      if (talk > 0.22 && S.prevTalk < 0.12) { S.amp = rnd(0.62, 1.05); S.bump = Math.max(S.bump, rnd(0.2, 1.1)); }   // new syllable
      S.prevTalk = talk;
      S.open = lerp(S.open, clamp(talk * 0.95 * S.amp, 0, 1), 1 - Math.exp(-dt * 26));
      S.bump *= Math.exp(-dt * 3);

      // ---- blinks (sometimes a double blink) ----
      if (now > blinkAt && blinkT < 0) blinkT = 0;
      var blink = 0;
      if (blinkT >= 0) {
        blinkT += dt; var p = blinkT / 0.17;
        blink = p < 0.5 ? p * 2 : 2 - p * 2;
        if (p >= 1) { blinkT = -1; blink = 0; blinkAt = now + (Math.random() < 0.2 ? 220 : 1800 + Math.random() * 3800); }
      }

      // ---- gaze: quick glances, looks up-left when thinking, mostly at the camera when listening ----
      if (now > gazeAt) {
        if (thinking) { S.tgx = T.gx + rnd(-0.6, 0.6); S.tgy = T.gy + rnd(-0.4, 0.4); gazeAt = now + rnd(900, 1600); }
        else if (listening) { S.tgx = rnd(-0.8, 0.8); S.tgy = rnd(-0.5, 0.5); gazeAt = now + rnd(1800, 3600); }
        else if (speaking) { S.tgx = rnd(-2.6, 2.6); S.tgy = rnd(-1.4, 1.2); gazeAt = now + rnd(1200, 3200); }
        else { S.tgx = rnd(-1.4, 1.4); S.tgy = rnd(-0.8, 0.8); gazeAt = now + rnd(2000, 4200); }
      }
      var gk = 1 - Math.exp(-dt * 20);
      S.gx = lerp(S.gx, S.tgx, gk); S.gy = lerp(S.gy, S.tgy, gk);

      // ---- eyebrows: base from emotion, plus lifts on emphasis, questions-in-thought and listening ----
      if (now > browAt) { if (speaking || listening) S.bump = Math.max(S.bump, rnd(0.4, 1.0)); browAt = now + rnd(1200, 3200); }
      var browTarget = T.brow + S.bump * 2.2 + (listening ? 0.8 : 0);
      S.brow = lerp(S.brow, browTarget, 1 - Math.exp(-dt * 10));

      // ---- head: slow drifting turn, an "I'm following you" nod while listening, a nod on emphasis ----
      if (now > yawAt) { S.tyaw = rnd(-0.018, 0.018); yawAt = now + rnd(2500, 5500); }
      S.yaw = lerp(S.yaw, S.tyaw, 1 - Math.exp(-dt * 1.4));
      if (listening && now > nodAt && S.nod < 0) { S.nod = 0; nodAt = now + rnd(2600, 4800); }
      var nodY = 0;
      if (S.nod >= 0) { S.nod += dt / 0.6; nodY = Math.sin(Math.PI * Math.min(S.nod, 1)) * 3.2; if (S.nod >= 1) S.nod = -1; }

      // ---- render ----
      wg.clearRect(0, 0, N, N);
      wg.drawImage(src, 0, 0);
      if (Math.abs(S.brow) > 0.25) drawBrows(S.brow);
      drawGaze();
      var d = S.open * LM.mouth.maxDrop;
      if (d > 0.6) drawMouth(d);
      drawLids(blink);

      if (!hasBg) {                                                  // studio backdrop: melt the photo's left/right edges into the extended edge colours
        wg.globalCompositeOperation = 'destination-in';
        var ef = wg.createLinearGradient(0, 0, N, 0);
        ef.addColorStop(0, 'rgba(0,0,0,0)'); ef.addColorStop(0.06, '#000'); ef.addColorStop(0.94, '#000'); ef.addColorStop(1, 'rgba(0,0,0,0)');
        wg.fillStyle = ef; wg.fillRect(0, 0, N, N);
        wg.globalCompositeOperation = 'source-over';
      }

      // the whole portrait fits inside the tile (head and shoulders always visible)
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      var sc, iw, ox, oy;
      if (hasBg) {
        sc = Math.min(cw / N, ch / N * 1.08) * (1 + S.lean);          // a little larger than the tile is tall: the head stays fully in, the chest may crop
        sc = Math.max(sc, ch * 0.93 / (N - 25) * (1 + S.lean));        // tall/narrow tiles: scale up so the chest always reaches the bottom edge
        iw = N * sc; ox = (cw - iw) / 2; oy = ch * 0.07 - 25 * sc;
        var bs = Math.max(cw / bgImg.width, ch / bgImg.height) * 1.06;   // office: fills the tile, drifts very slowly for depth
        var bw = bgImg.width * bs, bh = bgImg.height * bs;
        g.drawImage(bgImg, (cw - bw) / 2 - Math.sin(t * 0.23) * 5 * dpr, (ch - bh) / 2 + Math.cos(t * 0.19) * 3 * dpr, bw, bh);
      } else {
        sc = Math.min(cw / N, ch / N) * (0.97 + S.lean);
        iw = N * sc; ox = (cw - iw) / 2; oy = ch - iw;
        backdrop(ox, oy, iw, iw);
      }

      var sway = Math.sin(t * 0.7) * 1.3 * dpr;
      var bob = (Math.sin(t * 1.1) * 1.1 + S.open * 2.2 + S.bump * 1.2 + nodY) * dpr;
      var rot = Math.sin(t * 0.5) * 0.004 + S.tilt + S.yaw * 0.5;
      var px = ox + LM.pivot.x * sc, py = oy + LM.pivot.y * sc;
      var br = (Math.sin(t * 1.25) * 0.5 + 0.5) * 0.007 + (speaking ? S.open * 0.003 : 0);   // chest rises and falls
      var cy = LM.chestY;
      g.save();
      g.translate(px + sway, py + bob); g.rotate(rot); g.transform(1, 0, S.yaw * 0.6, 1, -S.yaw * 0.6 * 0, 0); g.translate(-px, -py);
      g.drawImage(wk, 0, cy - 3, N, N - cy + 3, ox, oy + (cy - 3) * sc, iw, (N - cy + 3) * sc * (1 + br));   // torso first, overlapping the seam
      g.drawImage(wk, 0, 0, N, cy, ox, oy, iw, cy * sc);
      g.restore();
    }
    raf = requestAnimationFrame(frame);

    return {
      kind: 'photo',
      debugOpen: function () { return +S.open.toFixed(3); },
      setState: function (s) { state = s; gazeAt = 0; },
      setEmotion: function (e) { T = EMO[e] || EMO.neutral; },
      pulse: function (x) { S.energy = Math.max(S.energy, clamp(x == null ? 1 : x, 0, 1)); },
      setLevel: function (v) { S.level = v == null ? null : clamp(v, 0, 1); },
      forceLids: function (v) { /* testing hook */ blinkT = v > 0 ? 0.085 : -1; },
      pause: function () { running = false; cancelAnimationFrame(raf); },
      resume: function () { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      destroy: function () { running = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); canvas.remove(); }
    };
  }
  window.createPhotoAvatar = createPhotoAvatar;
})();
