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
    '<radialGradient id="avSkin" cx=".42" cy=".26" r=".9"><stop offset="0" stop-color="#e6b6a0"/><stop offset=".55" stop-color="#d49d85"/><stop offset="1" stop-color="#bf836b"/></radialGradient>' +
    '<linearGradient id="avBlazer" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a3350"/><stop offset="1" stop-color="#171d30"/></linearGradient>' +
    '<clipPath id="avMouthClip"><path id="avMouthClipPath" d=""/></clipPath>' +
  '</defs>' +
  '<g id="avBody">' +
    '<path d="M108 232 L108 300 Q160 334 212 300 L212 232 Z" fill="#bd8a6d"/>' +
    '<path d="M108 270 Q160 300 212 270 L212 300 Q160 334 108 300 Z" fill="#000" opacity=".1"/>' +
    '<path d="M2 400 C6 338 58 312 112 300 L208 300 C262 312 314 338 318 400 Z" fill="url(#avBlazer)"/>' +
    '<path d="M124 298 L160 356 L196 298 Q160 322 124 298Z" fill="#f0f1f5"/>' +
    '<path d="M124 298 L160 356 L196 298 Q160 318 124 298Z" fill="#000" opacity=".08"/>' +
    '<path d="M112 300 L146 356 L98 374 L80 326 Z" fill="#1a2033"/>' +
    '<path d="M208 300 L174 356 L222 374 L240 326 Z" fill="#1a2033"/>' +
  '</g>' +
  '<g id="avHead">' +
    '<path d="M86 136 C68 134 58 154 58 178 C58 204 69 222 86 217 C93 215 95 198 95 178 C95 158 93 140 86 136Z" fill="#c78a72"/><path d="M81 158 C74 158 72 172 74 186 C76 199 83 201 86 194 C88 185 88 168 81 158Z" fill="#b0705a" opacity=".55"/>' +
    '<path d="M234 136 C252 134 262 154 262 178 C262 204 251 222 234 217 C227 215 225 198 225 178 C225 158 227 140 234 136Z" fill="#c78a72"/><path d="M239 158 C246 158 248 172 246 186 C244 199 237 201 234 194 C232 185 232 168 239 158Z" fill="#b0705a" opacity=".55"/>' +
    '<path d="M160 46 C206 46 240 82 240 128 C240 160 228 184 224 204 C220 236 216 256 197 271 C185 279 173 283 160 283 C147 283 135 279 123 271 C104 256 100 236 96 204 C92 184 80 160 80 128 C80 82 114 46 160 46Z" fill="url(#avSkin)"/>' +
    '<ellipse cx="146" cy="78" rx="30" ry="13" fill="#fff" opacity=".2"/>' +
    '<path d="M86 150 C84 176 96 200 100 214" stroke="#a96e58" stroke-width="10" fill="none" opacity=".1" stroke-linecap="round"/><path d="M234 150 C236 176 224 200 220 214" stroke="#a96e58" stroke-width="10" fill="none" opacity=".1" stroke-linecap="round"/>' +
    '<ellipse cx="116" cy="186" rx="16" ry="9" fill="#d97b6c" opacity=".16"/><ellipse cx="204" cy="186" rx="16" ry="9" fill="#d97b6c" opacity=".16"/>' +
    '<g class="av-eye" data-side="l" transform="translate(125 131)">' +
      '<ellipse rx="17" ry="6.6" fill="#efe6e4"/><g class="av-gaze"><circle r="5.4" fill="#332a2a"/><circle r="2.7" fill="#120c0c"/><circle cx="-1.7" cy="-1.8" r="1.5" fill="#fff"/></g>' +
      '<path d="M-19.5 0 C-12 -10 12 -10 19.5 -0.5 C14 -5.6 -14 -5.6 -19.5 0Z" fill="#c98f78"/>' +
      '<ellipse class="av-lid" cx="0" cy="-8" rx="19" ry="9" fill="#c98f78" transform="scale(1 0)"/>' +
      '<path d="M-19 -2.5 C-11 -11 11 -11 19 -2.5" stroke="#7f5242" stroke-width="1.7" fill="none" opacity=".6"/>' +
      '<path d="M-16 5 Q0 9.5 16 5" stroke="#a96e58" stroke-width="1.4" fill="none" opacity=".35"/>' +
    '</g>' +
    '<g class="av-eye" data-side="r" transform="translate(195 131)">' +
      '<ellipse rx="17" ry="6.6" fill="#efe6e4"/><g class="av-gaze"><circle r="5.4" fill="#332a2a"/><circle r="2.7" fill="#120c0c"/><circle cx="-1.7" cy="-1.8" r="1.5" fill="#fff"/></g>' +
      '<path d="M-19.5 -0.5 C-12 -10 12 -10 19.5 0 C14 -5.6 -14 -5.6 -19.5 -0.5Z" fill="#c98f78"/>' +
      '<ellipse class="av-lid" cx="0" cy="-8" rx="19" ry="9" fill="#c98f78" transform="scale(1 0)"/>' +
      '<path d="M-19 -2.5 C-11 -11 11 -11 19 -2.5" stroke="#7f5242" stroke-width="1.7" fill="none" opacity=".6"/>' +
      '<path d="M-16 5 Q0 9.5 16 5" stroke="#a96e58" stroke-width="1.4" fill="none" opacity=".35"/>' +
    '</g>' +
    '<path class="av-brow" data-side="l" d="M-19 3 Q-2 -4 18 -1" transform="translate(123 117)" stroke="#8a5f4c" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>' +
    '<path class="av-brow" data-side="r" d="M-18 -1 Q2 -4 19 3" transform="translate(197 117)" stroke="#8a5f4c" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>' +
    '<path d="M152 126 Q149 150 142 167 Q137 174 145 177 Q160 184 175 177 Q183 174 178 167 Q171 150 168 126 Q160 133 152 126Z" fill="#d9988a" opacity=".45"/>' +
    '<path d="M134 172 Q139 183 151 180 M186 172 Q181 183 169 180" stroke="#8a5646" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".55"/>' +
    '<ellipse cx="152.5" cy="177" rx="4" ry="2.4" fill="#6e3f33" opacity=".55"/><ellipse cx="167.5" cy="177" rx="4" ry="2.4" fill="#6e3f33" opacity=".55"/>' +
    '<ellipse cx="160" cy="166" rx="11" ry="8" fill="#f0b4a4" opacity=".38"/>' +
    '<path id="avSmileL" d="M137 180 C128 190 126 200 130 208" stroke="#a5685a" stroke-width="2" fill="none" stroke-linecap="round" opacity="0"/>' +
    '<path id="avSmileR" d="M183 180 C192 190 194 200 190 208" stroke="#a5685a" stroke-width="2" fill="none" stroke-linecap="round" opacity="0"/>' +
    '<g id="avMouth" transform="translate(160 205)">' +
      '<ellipse id="avLowerLip" cx="0" cy="12" rx="18" ry="5.5" fill="#c37076" opacity=".5"/>' +
      '<path id="avCavity" d="" fill="#3a1717"/>' +
      '<g clip-path="url(#avMouthClip)">' +
        '<rect id="avTeeth" x="-40" y="-8" width="80" height="10" fill="#f1ebe3"/>' +
        '<path id="avWire" d="" stroke="#8d97b0" stroke-width="1" fill="none"/>' +
        '<g id="avBraces" fill="#8493b8" stroke="#4f5a78" stroke-width=".7"></g>' +
        '<ellipse id="avTongue" cx="0" cy="8" rx="14" ry="6" fill="#bf5d68"/>' +
      '</g>' +
      '<path id="avLip" d="" fill="none" stroke="#9c5a5a" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round"/>' +
    '</g>' +
  '</g>' +
  '</svg>';

  var EMOTIONS = {
    neutral: { smile: 0.28, brow: 0,  tilt: 0,   eye: 1.0,  gx: 0, gy: 0,  open: 0.0 },
    happy:   { smile: 1.0,  brow: -2, tilt: 0,   eye: 0.84, gx: 0, gy: 0,  open: 0.4 },
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
    var teeth = $('#avTeeth'), braces = $('#avBraces'), tongue = $('#avTongue'), lower = $('#avLowerLip'), wire = $('#avWire');
    var smileL = $('#avSmileL'), smileR = $('#avSmileR');
    var lids = $$('.av-lid'), brows = $$('.av-brow'), gazes = $$('.av-gaze');
    var eyes = $$('.av-eye');

    // tiny braces: a row of brackets on the teeth (a nod to the real photo)
    var NS = 'http://www.w3.org/2000/svg';
    for (var i = 0; i < 8; i++) {
      var r = document.createElementNS(NS, 'rect');
      r.setAttribute('width', '5.2'); r.setAttribute('height', '4.2'); r.setAttribute('rx', '1.1');
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
      var w = 25 + 9 * smile - 5 * open;
      var corner = -5 * smile;
      var depth = 1.5 + 3.2 * smile * (1 - 0.5 * open);
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
      var showTeeth = clamp(open * 5 + (smile > 0.55 ? 0.75 * clamp((smile - 0.55) * 3, 0, 1) : 0), 0, 1);
      teeth.setAttribute('opacity', showTeeth);
      braces.setAttribute('opacity', showTeeth);
      var bx = -w + 7, step = (2 * w - 14 - 5.2) / 7, by = upperMid + 1.8 + clamp(open * 5, 0, 4);
      for (var i = 0; i < braces.childNodes.length; i++) {
        var rc = braces.childNodes[i];
        rc.setAttribute('x', (bx + i * step).toFixed(1));
        rc.setAttribute('y', by.toFixed(1));
      }
      wire.setAttribute('d', 'M' + (-w + 6) + ' ' + (by + 2.1).toFixed(1) + ' L' + (w - 6) + ' ' + (by + 2.1).toFixed(1));
      wire.setAttribute('opacity', showTeeth);
      smileL.setAttribute('opacity', (clamp(smile - 0.35, 0, 1) * 0.55 * (1 - open * 0.5)).toFixed(3));
      smileR.setAttribute('opacity', (clamp(smile - 0.35, 0, 1) * 0.55 * (1 - open * 0.5)).toFixed(3));
      tongue.setAttribute('cy', lowerMid - 3);
      tongue.setAttribute('rx', 8 + w * 0.3);
      tongue.setAttribute('opacity', clamp(open * 4, 0, 1));
      lower.setAttribute('cy', lowerMid + 7);
      lower.setAttribute('rx', 11 + w * 0.22);
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
        var x = left ? 123 : 197, by = 117 + y;
        var rot = (left ? 1 : -1) * (-S.tilt * 0.9);
        b.setAttribute('transform', 'translate(' + x + ' ' + by.toFixed(2) + ') rotate(' + rot.toFixed(2) + ')');
      });
      // eyes: size + gaze
      eyes.forEach(function (e) {
        var left = e.getAttribute('data-side') === 'l';
        e.setAttribute('transform', 'translate(' + (left ? 125 : 195) + ' 131) scale(1 ' + S.eye.toFixed(3) + ')');
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
        head.setAttribute('transform', 'rotate(' + sway.toFixed(2) + ' 160 292) translate(0 ' + bob.toFixed(2) + ')');
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
