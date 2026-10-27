/* Talking-photo avatar: animates a real portrait on a canvas.
 *   createPhotoAvatar(container, { url }) -> Promise<avatar>   (same interface as avatar.js / avatar3d.js)
 * What moves: jaw drops with the voice (the lower face is warped down and a mouth cavity is drawn in the gap),
 * eyelids blink, the head sways and breathes, and the emotion changes squint, tilt and posture.
 * The landmark numbers below are pixel positions measured on img/avatar-portrait.jpg (900x900).
 */
(function () {
  'use strict';
  var LM = {
    size: 900,
    eyes: [{ x: 399, y: 181, rx: 40, ry: 14 }, { x: 533, y: 182, rx: 40, ry: 14 }],
    mouth: { cx: 465, top: 317, rx: 52, maxDrop: 18 },     // top = row just under the upper teeth; the jaw moves down from here
    warp: { x0: 366, x1: 566, full: 400, end: 482 },        // columns warped, row where the full drop fades out, row where it stops
    focus: { x: 463, y: 330 },                              // face centre used for framing
    pivot: { x: 463, y: 600 }                               // neck: the head rotates around here
  };
  var EMO = {
    neutral:   { squint: 0.00, tilt: 0.000, lean: 0 },
    happy:     { squint: 0.14, tilt: 0.004, lean: 0 },
    excited:   { squint: 0.10, tilt: 0.000, lean: 0.012 },
    thinking:  { squint: 0.06, tilt: -0.012, lean: 0 },
    serious:   { squint: 0.04, tilt: 0.000, lean: 0.006 },
    listening: { squint: 0.00, tilt: 0.006, lean: 0.01 }
  };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };

  function avg(g, x, y, r) {
    var d = g.getImageData(x - r, y - r, r * 2, r * 2).data, R = 0, G = 0, B = 0, n = d.length / 4;
    for (var i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
    return [Math.round(R / n), Math.round(G / n), Math.round(B / n)];
  }
  var rgb = function (c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + (a == null ? 1 : a) + ')'; };

  function createPhotoAvatar(container, opts) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onerror = function () { reject(new Error('portrait failed to load')); };
      img.onload = function () { try { resolve(build(container, img)); } catch (e) { reject(e); } };
      img.src = opts.url;
    });
  }

  function build(container, img) {
    var N = LM.size;
    var src = document.createElement('canvas'); src.width = src.height = N;
    var sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0, N, N);
    var ov = document.createElement('canvas'); ov.width = N; ov.height = N; var og = ov.getContext('2d');
    var wk = document.createElement('canvas'); wk.width = wk.height = N; var wg = wk.getContext('2d');

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

    var S = { open: 0, level: null, energy: 0, squint: 0, tilt: 0, lean: 0, blink: 0 };
    var state = 'idle', emo = 'neutral', T = EMO.neutral;
    var blinkAt = performance.now() + 2600, blinkT = -1;
    var running = true, raf = 0, last = performance.now();

    function drawMouth(d) {
      var m = LM.mouth, w = LM.warp;
      // cavity in the gap the jaw leaves
      var cy = m.top + d / 2;
      var grad = wg.createLinearGradient(0, m.top, 0, m.top + d);
      grad.addColorStop(0, '#1a0709'); grad.addColorStop(1, '#3a1216');
      wg.fillStyle = grad;
      wg.beginPath(); wg.ellipse(m.cx, cy, m.rx, d / 2 + 2.5, 0, 0, Math.PI * 2); wg.fill();
      if (d > 8) { wg.fillStyle = 'rgba(176,84,92,.55)'; wg.beginPath(); wg.ellipse(m.cx, m.top + d - 3, m.rx * 0.5, Math.max(2, d * 0.22), 0, 0, Math.PI * 2); wg.fill(); }
      // jaw: horizontal strips pushed down, strongest at the lower lip and fading out by the neck
      og.clearRect(0, 0, N, N);
      var sw = w.x1 - w.x0;
      for (var y = m.top; y < w.end; y += 2) {
        var t = y < w.full ? 0 : (y - w.full) / (w.end - w.full);
        var dy = d * (1 - t * t * (3 - 2 * t));
        og.drawImage(src, w.x0, y, sw, 2, w.x0, y + dy, sw, 3.5);
      }
      og.globalCompositeOperation = 'destination-in';                // feather the left and right edges so the warp blends into the cheeks
      var fg = og.createLinearGradient(w.x0, 0, w.x1, 0);
      fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(0.16, '#000'); fg.addColorStop(0.84, '#000'); fg.addColorStop(1, 'rgba(0,0,0,0)');
      og.fillStyle = fg; og.fillRect(0, 0, N, N);
      og.globalCompositeOperation = 'source-over';
      wg.drawImage(ov, 0, 0);
    }

    var lc = document.createElement('canvas'); lc.width = 130; lc.height = 56; var lg = lc.getContext('2d');
    function drawLids(p) {
      if (p < 0.02) return;
      LM.eyes.forEach(function (e, i) {
        var w = e.rx * 2 + 8, h = e.ry * 2 + 10, top = e.y - e.ry - 4, cover = Math.max(2, h * p);
        lg.clearRect(0, 0, lc.width, lc.height);
        // lid skin: the skin texture just above the eye, stretched down over it, so tone and grain match the photo
        lg.drawImage(src, e.x - e.rx - 4, e.y - e.ry - 12, w, 9, 0, 0, w, cover);
        lg.globalCompositeOperation = 'destination-in';           // soft almond edge instead of a hard cut-out
        var rg = lg.createRadialGradient(w / 2, cover * 0.45, 2, w / 2, cover * 0.45, w / 2);
        rg.addColorStop(0, '#000'); rg.addColorStop(0.72, '#000'); rg.addColorStop(1, 'rgba(0,0,0,0)');
        lg.fillStyle = rg; lg.fillRect(0, 0, lc.width, lc.height);
        lg.globalCompositeOperation = 'source-over';
        wg.drawImage(lc, 0, 0, w, cover + 2, e.x - e.rx - 4, top, w, cover + 2);
        var edge = top + cover;                                      // lash line along the closing lid
        wg.strokeStyle = 'rgba(36,22,18,' + (0.2 + 0.55 * p) + ')'; wg.lineWidth = 1.7; wg.lineCap = 'round';
        wg.beginPath(); wg.moveTo(e.x - e.rx + 3, edge - 0.5); wg.quadraticCurveTo(e.x, edge + 1.5 + p * 3, e.x + e.rx - 3, edge - 0.5); wg.stroke();
      });
    }

    function frame(now) {
      if (!running) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - last) / 1000); last = now;
      var t = now / 1000, k = 1 - Math.exp(-dt * 8);
      S.squint = lerp(S.squint, T.squint, k); S.tilt = lerp(S.tilt, T.tilt, k); S.lean = lerp(S.lean, T.lean, k);

      S.energy *= Math.exp(-dt * 11);
      var talk = 0;
      if (S.level != null) talk = S.level;
      else if (state === 'speaking') talk = Math.max(S.energy, 0.2 + 0.16 * Math.sin(t * 13) + 0.1 * Math.sin(t * 21 + 1));
      S.open = lerp(S.open, clamp(talk * 0.95, 0, 1), 1 - Math.exp(-dt * 26));

      if (now > blinkAt && blinkT < 0) blinkT = 0;
      var blink = 0;
      if (blinkT >= 0) {
        blinkT += dt; var p = blinkT / 0.17;
        blink = p < 0.5 ? p * 2 : 2 - p * 2;
        if (p >= 1) { blinkT = -1; blink = 0; blinkAt = now + 1800 + Math.random() * 3800; }
      }
      var lidAmt = S.force != null ? S.force : Math.max(blink, S.squint);

      wg.clearRect(0, 0, N, N);
      wg.drawImage(src, 0, 0);
      var d = S.open * LM.mouth.maxDrop;
      if (d > 0.6) drawMouth(d);
      drawLids(lidAmt);

      // frame it: cover the canvas, face a little above centre, head sways around the neck
      var sc = Math.max(cw / N, ch / N) * (1.0 + S.lean);
      var ox = cw / 2 - LM.focus.x * sc, oy = ch * 0.44 - LM.focus.y * sc;
      ox = clamp(ox, cw - N * sc, 0); oy = clamp(oy, ch - N * sc, 0);
      var sway = Math.sin(t * 0.7) * 1.3 * dpr, bob = Math.sin(t * 1.1) * 1.2 * dpr + S.open * 2.2 * dpr;
      var rot = Math.sin(t * 0.5) * 0.004 + S.tilt + (state === 'thinking' ? -0.008 : 0);
      var px = ox + LM.pivot.x * sc, py = oy + LM.pivot.y * sc;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cw, ch);
      g.translate(px + sway, py + bob); g.rotate(rot); g.translate(-px, -py);
      g.imageSmoothingQuality = 'high';
      g.drawImage(wk, ox, oy, N * sc, N * sc);
    }
    raf = requestAnimationFrame(frame);

    return {
      kind: 'photo',
      forceLids: function (v) { S.force = v; },                       // for testing: hold the eyelids at 0..1
      setState: function (s) { state = s; },
      setEmotion: function (e) { emo = EMO[e] ? e : 'neutral'; T = EMO[emo]; },
      pulse: function (x) { S.energy = Math.max(S.energy, clamp(x == null ? 1 : x, 0, 1)); },
      setLevel: function (v) { S.level = v == null ? null : clamp(v, 0, 1); },
      pause: function () { running = false; cancelAnimationFrame(raf); },
      resume: function () { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      destroy: function () { running = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); canvas.remove(); }
    };
  }
  window.createPhotoAvatar = createPhotoAvatar;
})();
