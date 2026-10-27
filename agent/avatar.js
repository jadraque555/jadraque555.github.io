/* Animated SVG avatar. Interface (so a 3D VRM face can replace it later):
 *   const av = createAvatar(element)
 *   av.setState('idle' | 'listening' | 'thinking' | 'speaking')
 *   av.setEmotion('neutral' | 'happy' | 'excited' | 'thinking' | 'serious')
 *   av.pulse(strength)   // call on each spoken word: the mouth snaps open
 *   av.setLevel(0..1)    // or feed a real audio level instead of pulses
 */
(function () {
  'use strict';

  var SVG = '' +
  '<svg viewBox="0 0 320 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated avatar of Jayson">' +
  '<defs>' +
    '<radialGradient id="avSkin" cx=".42" cy=".3" r=".85"><stop offset="0" stop-color="#ebb890"/><stop offset="1" stop-color="#cc9166"/></radialGradient>' +
    '<linearGradient id="avBlazer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3a68"/><stop offset="1" stop-color="#141c38"/></linearGradient>' +
    '<clipPath id="avMouthClip"><path id="avMouthClipPath" d=""/></clipPath>' +
  '</defs>' +
  '<g id="avBody">' +
    '<path d="M134 206 L134 280 Q160 304 186 280 L186 206 Z" fill="#c28660"/>' +
    '<path d="M8 400 C12 318 68 286 126 274 L194 274 C252 286 308 318 312 400 Z" fill="url(#avBlazer)"/>' +
    '<path d="M130 272 L160 340 L190 272 Z" fill="#f3f4f7"/>' +
    '<path d="M130 272 L160 340 L190 272 Q160 296 130 272Z" fill="#000" opacity=".08"/>' +
    '<path d="M126 274 L150 336 L110 352 L92 302 Z" fill="#0f1730"/>' +
    '<path d="M194 274 L170 336 L210 352 L228 302 Z" fill="#0f1730"/>' +
  '</g>' +
  '<g id="avHead">' +
    '<ellipse cx="84" cy="168" rx="13" ry="25" fill="url(#avSkin)"/><ellipse cx="86" cy="168" rx="6" ry="14" fill="#c98a63" opacity=".55"/>' +
    '<ellipse cx="236" cy="168" rx="13" ry="25" fill="url(#avSkin)"/><ellipse cx="234" cy="168" rx="6" ry="14" fill="#c98a63" opacity=".55"/>' +
    '<ellipse cx="160" cy="154" rx="77" ry="97" fill="url(#avSkin)"/>' +
    '<ellipse cx="138" cy="84" rx="32" ry="13" fill="#fff" opacity=".17"/>' +
    '<ellipse cx="109" cy="198" rx="15" ry="8" fill="#e0705f" opacity=".16"/><ellipse cx="211" cy="198" rx="15" ry="8" fill="#e0705f" opacity=".16"/>' +
    '<g class="av-eye" data-side="l" transform="translate(127 150)">' +
      '<ellipse rx="14.5" ry="9.5" fill="#fff"/><g class="av-gaze"><circle r="6.8" fill="#4a2c1b"/><circle r="3.4" fill="#150c08"/><circle cx="-2.2" cy="-2.4" r="1.9" fill="#fff"/></g>' +
      '<ellipse class="av-lid" cx="0" cy="-10" rx="16.5" ry="11" fill="#d39a70" transform="scale(1 0)"/>' +
      '<path d="M-14.5 -1 Q0 -12 14.5 -1" stroke="#7a4a30" stroke-width="2" fill="none" opacity=".55"/>' +
    '</g>' +
    '<g class="av-eye" data-side="r" transform="translate(193 150)">' +
      '<ellipse rx="14.5" ry="9.5" fill="#fff"/><g class="av-gaze"><circle r="6.8" fill="#4a2c1b"/><circle r="3.4" fill="#150c08"/><circle cx="-2.2" cy="-2.4" r="1.9" fill="#fff"/></g>' +
      '<ellipse class="av-lid" cx="0" cy="-10" rx="16.5" ry="11" fill="#d39a70" transform="scale(1 0)"/>' +
      '<path d="M-14.5 -1 Q0 -12 14.5 -1" stroke="#7a4a30" stroke-width="2" fill="none" opacity=".55"/>' +
    '</g>' +
    '<path class="av-brow" data-side="l" d="M-17 2 Q0 -5 17 0" transform="translate(127 126)" stroke="#2b1a12" stroke-width="4.4" fill="none" stroke-linecap="round"/>' +
    '<path class="av-brow" data-side="r" d="M-17 0 Q0 -5 17 2" transform="translate(193 126)" stroke="#2b1a12" stroke-width="4.4" fill="none" stroke-linecap="round"/>' +
    '<path d="M160 158 Q153 188 148 195 Q160 202 172 195 Q167 188 160 158Z" fill="#b87a55" opacity=".3"/>' +
    '<ellipse cx="154" cy="196" rx="3" ry="2" fill="#7a4630" opacity=".5"/><ellipse cx="166" cy="196" rx="3" ry="2" fill="#7a4630" opacity=".5"/>' +
    '<g id="avMouth" transform="translate(160 226)">' +
      '<ellipse id="avLowerLip" cx="0" cy="12" rx="16" ry="5" fill="#d98f78" opacity=".35"/>' +
      '<path id="avCavity" d="" fill="#3a1717"/>' +
      '<g clip-path="url(#avMouthClip)">' +
        '<rect id="avTeeth" x="-34" y="-8" width="68" height="10" fill="#fbfbfc"/>' +
        '<g id="avBraces" fill="#aeb5c4" stroke="#6b7384" stroke-width=".7"></g>' +
        '<ellipse id="avTongue" cx="0" cy="8" rx="14" ry="6" fill="#bf5d68"/>' +
      '</g>' +
      '<path id="avLip" d="" fill="none" stroke="#a65a4e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</g>' +
  '</g>' +
  '</svg>';

  var EMOTIONS = {
    neutral: { smile: 0.28, brow: 0,  tilt: 0,   eye: 1.0,  gx: 0, gy: 0,  open: 0.0 },
    happy:   { smile: 1.0,  brow: -2, tilt: 0,   eye: 0.86, gx: 0, gy: 0,  open: 0.2 },
    excited: { smile: 1.0,  brow: -7, tilt: 0,   eye: 1.12, gx: 0, gy: 0,  open: 0.32 },
    thinking:{ smile: 0.1,  brow: -3, tilt: 5,   eye: 0.96, gx: 4, gy: -4, open: 0.0 },
    serious: { smile: 0.0,  brow: 2,  tilt: -3,  eye: 0.95, gx: 0, gy: 0,  open: 0.0 },
    listening:{ smile: 0.4, brow: -3, tilt: 0,   eye: 1.08, gx: 0, gy: 1,  open: 0.0 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function createAvatar(root) {
    root.innerHTML = SVG;
    var $ = function (s) { return root.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
    var head = $('#avHead'), body = $('#avBody');
    var lip = $('#avLip'), cavity = $('#avCavity'), clipPath = $('#avMouthClipPath');
    var teeth = $('#avTeeth'), braces = $('#avBraces'), tongue = $('#avTongue'), lower = $('#avLowerLip');
    var lids = $$('.av-lid'), brows = $$('.av-brow'), gazes = $$('.av-gaze');
    var eyes = $$('.av-eye');

    // tiny braces: a row of brackets on the teeth (a nod to the real photo)
    var NS = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 8; i++) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('width', '5'); r.setAttribute('height', '4'); r.setAttribute('rx', '1');
      braces.appendChild(r);
    }

    var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var S = { smile: 0.28, brow: 0, tilt: 0, eye: 1, gx: 0, gy: 0, open: 0, energy: 0, level: null };
    var T = Object.assign({}, EMOTIONS.neutral);
    var state = 'idle', emotion = 'neutral', speaking = false;
    var blinkAt = performance.now() + 1800, blinkT = -1;
    var last = performance.now(), raf = 0, running = true;

    function apply(name) {
      var e = EMOTIONS[name] || EMOTIONS.neutral;
      Object.assign(T, e);
    }
    function api_setEmotion(name) { emotion = EMOTIONS[name] ? name : 'neutral'; if (state === 'speaking' || state === 'idle') apply(emotion); }
    function api_setState(s) {
      state = s;
      speaking = s === 'speaking';
      if (s === 'listening') apply('listening');
      else if (s === 'thinking') apply('thinking');
      else apply(emotion);
    }

    function renderMouth(open, smile) {
      var w = 30 + 9 * smile - 6 * open;
      var corner = -5 * smile;
      var depth = 1.5 + 5 * smile * (1 - 0.6 * open);
      var upper = corner + 2 * depth - open * 4;
      var h = open * 24;
      var lowerCtl = upper + 2 * h + 1;
      var d = 'M' + (-w) + ' ' + corner + ' Q0 ' + upper + ' ' + w + ' ' + corner +
              ' Q0 ' + lowerCtl + ' ' + (-w) + ' ' + corner + ' Z';
      lip.setAttribute('d', d);
      clipPath.setAttribute('d', d);
      cavity.setAttribute('d', d);
      cavity.setAttribute('opacity', clamp(open * 6, 0, 1));
      var upperMid = 0.5 * (corner + upper);
      var lowerMid = 0.5 * (corner + lowerCtl);
      teeth.setAttribute('y', upperMid - 3);
      teeth.setAttribute('height', clamp(5 + open * 18, 0, 14));
      var showTeeth = clamp(open * 5 + (smile > 0.7 ? 0.45 : 0), 0, 1);
      teeth.setAttribute('opacity', showTeeth);
      braces.setAttribute('opacity', showTeeth);
      var bx = -w + 9, step = (2 * w - 18 - 5) / 7, by = upperMid + 1.5 + clamp(open * 5, 0, 4);
      for (var i = 0; i < braces.childNodes.length; i++) {
        var rc = braces.childNodes[i];
        rc.setAttribute('x', (bx + i * step).toFixed(1));
        rc.setAttribute('y', by.toFixed(1));
      }
      tongue.setAttribute('cy', lowerMid - 3);
      tongue.setAttribute('rx', 8 + w * 0.3);
      tongue.setAttribute('opacity', clamp(open * 4, 0, 1));
      lower.setAttribute('cy', lowerMid + 7);
      lower.setAttribute('rx', 12 + w * 0.2);
    }

    function frame(now) {
      if (!running) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var t = now / 1000;
      var k = 1 - Math.exp(-dt * 9);           // smoothing factor

      S.smile = lerp(S.smile, T.smile, k);
      S.brow = lerp(S.brow, T.brow, k);
      S.tilt = lerp(S.tilt, T.tilt, k);
      S.eye = lerp(S.eye, T.eye, k);
      S.gx = lerp(S.gx, T.gx, k);
      S.gy = lerp(S.gy, T.gy, k);

      // mouth energy: word pulses decay fast; speaking adds a natural flutter
      S.energy = S.energy * Math.exp(-dt * 11);
      var talk = 0;
      if (S.level != null) talk = S.level;
      else if (speaking) talk = Math.max(S.energy, 0.2 + 0.16 * Math.sin(t * 13) + 0.1 * Math.sin(t * 21 + 1));
      var openTarget = clamp(T.open + talk * 0.78, 0, 1);
      S.open = lerp(S.open, openTarget, 1 - Math.exp(-dt * 26));
      renderMouth(S.open, S.smile);

      // brows (one is raised more when thinking)
      brows.forEach(function (b) {
        var left = b.getAttribute('data-side') === 'l';
        var y = S.brow + (left ? -S.tilt * 0.5 : S.tilt * 0.35);
        var x = left ? 127 : 193, by = 126 + y;
        var rot = (left ? 1 : -1) * (-S.tilt * 0.9);
        b.setAttribute('transform', 'translate(' + x + ' ' + by.toFixed(2) + ') rotate(' + rot.toFixed(2) + ')');
      });
      // eyes: size + gaze
      eyes.forEach(function (e) {
        var left = e.getAttribute('data-side') === 'l';
        e.setAttribute('transform', 'translate(' + (left ? 127 : 193) + ' 150) scale(1 ' + S.eye.toFixed(3) + ')');
      });
      gazes.forEach(function (g) { g.setAttribute('transform', 'translate(' + S.gx.toFixed(2) + ' ' + S.gy.toFixed(2) + ')'); });

      // blink
      if (now > blinkAt && blinkT < 0) blinkT = 0;
      var lid = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        var p = blinkT / 0.16;
        lid = p < 0.5 ? p * 2 : (p < 1 ? (1 - p) * 2 : 0);
        if (p >= 1) { blinkT = -1; blinkAt = now + 1800 + Math.random() * 3800; }
      }
      lids.forEach(function (l) { l.setAttribute('transform', 'scale(1 ' + clamp(lid * 1.25, 0, 1).toFixed(3) + ')'); });

      // idle motion
      if (!reduce) {
        var sway = Math.sin(t * 0.7) * 0.9 + (state === 'listening' ? 2.2 : 0) + (state === 'thinking' ? -2 : 0);
        var bob = Math.sin(t * 1.15) * 1.4 + (speaking ? Math.sin(t * 9) * 0.5 * S.open : 0);
        head.setAttribute('transform', 'rotate(' + sway.toFixed(2) + ' 160 270) translate(0 ' + bob.toFixed(2) + ')');
        body.setAttribute('transform', 'translate(0 ' + (Math.sin(t * 1.15) * 0.9).toFixed(2) + ')');
      }
      raf = requestAnimationFrame(frame);
    }

    renderMouth(0, 0.28);
    raf = requestAnimationFrame(frame);

    return {
      setState: api_setState,
      setEmotion: api_setEmotion,
      pulse: function (s) { S.energy = Math.max(S.energy, clamp(s == null ? 1 : s, 0, 1)); },
      setLevel: function (v) { S.level = v == null ? null : clamp(v, 0, 1); },
      pause: function () { running = false; cancelAnimationFrame(raf); },
      resume: function () { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      destroy: function () { running = false; cancelAnimationFrame(raf); }
    };
  }

  window.createAvatar = createAvatar;
})();
