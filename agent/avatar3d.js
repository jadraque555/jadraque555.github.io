/* 3D avatar (three.js). Same interface as the SVG avatar:
 *   const av = await createAvatar3D(container, { url: 'agent/models/jayson.glb' })
 *   av.setState('idle'|'listening'|'thinking'|'speaking'), av.setEmotion(name), av.pulse(), av.setLevel(v),
 *   av.pause(), av.resume(), av.destroy(), av.info
 *
 * Models: .glb (ARKit blendshapes, Oculus visemes, or both) and .vrm (VRoid / VRM 0.x and 1.0).
 * Lip-sync and expressions are driven by the face morph targets inside the file, so the model must have them.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// "mouthSmile_L", "mouthSmileLeft" and "mouthsmilel" all become "mouthsmilel"
const norm = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/left$/, 'l').replace(/right$/, 'r');
const pair = (name, v) => ({ [name + 'l']: v, [name + 'r']: v });

/* ---------- expression presets ---------- */
const ARKIT = {
  neutral:  { ...pair('mouthsmile', 0.1) },
  happy:    { ...pair('mouthsmile', 0.78), ...pair('cheeksquint', 0.35), ...pair('eyesquint', 0.22), browinnerup: 0.08 },
  excited:  { ...pair('mouthsmile', 0.9), ...pair('cheeksquint', 0.4), ...pair('browouterup', 0.35), browinnerup: 0.45, ...pair('eyewide', 0.2) },
  thinking: { browinnerup: 0.3, browouterupl: 0.5, ...pair('eyelookup', 0.3), ...pair('mouthpress', 0.12), mouthright: 0.2 },
  serious:  { ...pair('browdown', 0.4), ...pair('mouthpress', 0.28), ...pair('mouthfrown', 0.08) },
  listening:{ browinnerup: 0.28, ...pair('eyewide', 0.16), ...pair('mouthsmile', 0.14) }
};
const VRM_EXPR = {
  neutral: {}, happy: { happy: 0.8 }, excited: { happy: 0.6, surprised: 0.3 },
  thinking: { relaxed: 0.25 }, serious: { sad: 0.12 }, listening: { surprised: 0.15 }
};
// mouth shapes cycled on every spoken word
const MOUTH_ARKIT = [
  { jawopen: 0.62, ...pair('mouthlowerdown', 0.25) },                                   // ah
  { jawopen: 0.28, ...pair('mouthstretch', 0.45), ...pair('mouthsmile', 0.18) },        // ee
  { jawopen: 0.4, mouthfunnel: 0.55 },                                                  // oh
  { jawopen: 0.18, mouthpucker: 0.6 },                                                  // oo
  { jawopen: 0.22, ...pair('mouthstretch', 0.3) }                                       // ih
];
const MOUTH_VISEME = ['visemeaa', 'visemee', 'visemeo', 'visemei', 'visemeu'];
const MOUTH_VRM = ['aa', 'ee', 'oh', 'ih', 'ou'];

function findBone(root, re) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.isBone && re.test(o.name || '')) hit = o; });
  return hit;
}

export async function createAvatar3D(container, opts = {}) {
  const url = opts.url;
  if (!url) throw new Error('no model url');
  const isVRM = /\.vrm(\?|$)/i.test(url);

  /* ----- renderer / scene ----- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const key = new THREE.DirectionalLight(0xfff0e0, 1.9); key.position.set(1.6, 2.4, 3.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fa4ff, 1.1); rim.position.set(-2.4, 1.6, -2.2); scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffd9a8, 0.35); fill.position.set(-2, 0.4, 2); scene.add(fill);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100);

  /* ----- load ----- */
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/'));
  loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/basis/').detectSupport(renderer));
  loader.setMeshoptDecoder(MeshoptDecoder);
  let VRMUtils = null;
  if (isVRM) {
    const mod = await import('@pixiv/three-vrm');
    VRMUtils = mod.VRMUtils;
    loader.register((p) => new mod.VRMLoaderPlugin(p));
  }
  const gltf = await new Promise((res, rej) => loader.load(url, res, (e) => opts.onProgress && e.total && opts.onProgress(e.loaded / e.total), rej));
  const vrm = isVRM ? gltf.userData.vrm : null;
  if (isVRM && !vrm) throw new Error('not a VRM file');
  const model = vrm ? vrm.scene : gltf.scene;
  let armsLowered = false;
  if (vrm) {
    VRMUtils.removeUnnecessaryVertices(model);
    VRMUtils.combineSkeletons(model);
    if (VRMUtils.rotateVRM0) VRMUtils.rotateVRM0(vrm);
    const hum = vrm.humanoid;                                         // arms down instead of a T-pose
    const L = hum.getNormalizedBoneNode('leftUpperArm'), R = hum.getNormalizedBoneNode('rightUpperArm');
    if (L) L.rotation.z = -1.2; if (R) R.rotation.z = 1.2;
  }
  if (!vrm) {                                                         // T-pose export (arms straight out): swing the upper arms down
    const drop = opts.armDrop != null ? opts.armDrop : 1.35, ax = opts.armAxis || 'x';
    const L = findBone(model, /(^|[^a-z])LeftArm$|mixamorigLeftArm$/i), R = findBone(model, /(^|[^a-z])RightArm$|mixamorigRightArm$/i);
    if (L && R && drop) {
      const turn = (b, a) => { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(ax === 'x' ? 1 : 0, ax === 'y' ? 1 : 0, ax === 'z' ? 1 : 0), a); b.quaternion.premultiply(q); };
      turn(L, ax === 'x' ? drop : -drop); turn(R, drop);          // about the bone's X axis both arms swing the same way
      armsLowered = true;
    }
  }
  model.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; } });
  const root = new THREE.Group();
  root.add(model);
  if (opts.rotateY) root.rotation.y = opts.rotateY;
  scene.add(root);

  /* ----- morph targets ----- */
  const entries = new Map();                                          // normalised name -> [{mesh, idx}]
  model.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary && o.morphTargetInfluences) {
      for (const [name, idx] of Object.entries(o.morphTargetDictionary)) {
        const k = norm(name);
        if (!entries.has(k)) entries.set(k, []);
        entries.get(k).push({ mesh: o, idx });
      }
    }
  });
  const has = (k) => entries.has(k);
  const fmt = vrm ? 'vrm' : has('jawopen') ? 'arkit' : has('visemeaa') ? 'viseme' : 'none';
  const cur = {}, tgt = {};
  const add = (k, v) => { tgt[k] = clamp((tgt[k] || 0) + v, 0, 1); };

  /* ----- framing ----- */
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const headBone = vrm ? vrm.humanoid.getNormalizedBoneNode('head') : findBone(model, /(^|[^a-z])head$|mixamorigHead$|CC_Base_Head$/i);
  const fullBody = size.y > 1.0 && !!headBone;
  const target = new THREE.Vector3();
  let extent;
  if (fullBody) {
    headBone.getWorldPosition(target);
    const headH = size.y * 0.13;                                     // rough head height
    target.y += headH * 0.5;                                         // the bone sits at the base of the skull: aim at the head centre
    extent = size.y * (opts.extent || 0.32);                         // head and shoulders
    target.y -= extent * (opts.lookDown != null ? opts.lookDown : 0.1);
  } else {
    target.copy(center);
    extent = size.y * (opts.extent || 1.12);
  }
  function layout() {
    const w = container.clientWidth || 320, h = container.clientHeight || 400;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const dist = (extent / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.set(target.x, target.y, target.z + dist);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
  }
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(container);

  /* ----- animation state ----- */
  let state = 'idle', emotion = 'neutral', speaking = false;
  let energy = 0, level = null, pulseSeq = 0, seenPulse = 0, shape = 0;
  let blinkAt = performance.now() + 1800, blinkT = -1;
  let running = true, raf = 0, last = performance.now();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const headBase = headBone ? headBone.quaternion.clone() : null;
  const euler = new THREE.Euler(), qOff = new THREE.Quaternion();

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    for (const k in tgt) delete tgt[k];

    // expression
    const em = state === 'thinking' ? 'thinking' : state === 'listening' ? 'listening' : emotion;
    if (fmt === 'vrm') for (const [k, v] of Object.entries(VRM_EXPR[em] || {})) add(k, v);
    else for (const [k, v] of Object.entries(ARKIT[em] || {})) if (has(k)) add(k, v);

    // mouth
    energy *= Math.exp(-dt * 11);
    const talk = level != null ? level : (speaking ? Math.max(energy, 0.2 + 0.16 * Math.sin(t * 13) + 0.1 * Math.sin(t * 21 + 1)) : 0);
    if (pulseSeq !== seenPulse) { seenPulse = pulseSeq; shape = (shape + 1 + Math.floor(Math.random() * 3)) % 5; }
    if (talk > 0.01) {
      if (fmt === 'vrm') add(MOUTH_VRM[shape], talk * 0.9);
      else if (fmt === 'arkit') for (const [k, v] of Object.entries(MOUTH_ARKIT[shape])) if (has(k)) add(k, v * talk * 1.25);
      else if (fmt === 'viseme') add(MOUTH_VISEME[shape], talk * 0.95);
    }

    // blink
    if (now > blinkAt && blinkT < 0) blinkT = 0;
    let lid = 0;
    if (blinkT >= 0) {
      blinkT += dt;
      const p = blinkT / 0.16;
      lid = p < 0.5 ? p * 2 : (p < 1 ? (1 - p) * 2 : 0);
      if (p >= 1) { blinkT = -1; blinkAt = now + 1800 + Math.random() * 3800; }
    }
    if (fmt === 'vrm') add('blink', lid); else { add('eyeblinkl', lid); add('eyeblinkr', lid); }

    // write morphs (smoothed)
    const k1 = 1 - Math.exp(-dt * 20);
    if (fmt === 'vrm') {
      const names = new Set([...Object.keys(cur), ...Object.keys(tgt)]);
      for (const n of names) {
        cur[n] = (cur[n] || 0) + ((tgt[n] || 0) - (cur[n] || 0)) * k1;
        vrm.expressionManager.setValue(n, cur[n]);
      }
    } else {
      for (const [k, list] of entries) {
        const c = (cur[k] || 0) + ((tgt[k] || 0) - (cur[k] || 0)) * k1;
        cur[k] = c;
        for (const e of list) e.mesh.morphTargetInfluences[e.idx] = c;
      }
    }

    // idle head motion
    if (!reduce) {
      const sway = Math.sin(t * 0.7) * 0.03 + (state === 'listening' ? 0.05 : 0) + (state === 'thinking' ? -0.05 : 0);
      const nod = Math.sin(t * 1.1) * 0.015 + (speaking ? Math.sin(t * 8) * 0.012 * talk : 0);
      if (headBone && headBase) {
        euler.set(nod, sway, 0);
        qOff.setFromEuler(euler);
        headBone.quaternion.copy(headBase).multiply(qOff);
      } else {
        root.rotation.y = (opts.rotateY || 0) + sway;
        root.rotation.x = nod * 0.6;
      }
    }
    if (vrm) vrm.update(dt);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  return {
    info: { armsLowered, format: fmt, morphTargets: entries.size, fullBody, hasHeadBone: !!headBone, vrm: !!vrm, mapped: ['jawopen', 'mouthsmilel', 'eyeblinkl', 'browinnerup', 'visemeaa'].filter(has) },
    setState: (s) => { state = s; speaking = s === 'speaking'; },
    setEmotion: (e) => { emotion = (ARKIT[e] ? e : 'neutral'); },
    pulse: (s) => { energy = Math.max(energy, clamp(s == null ? 1 : s, 0, 1)); pulseSeq++; },
    setLevel: (v) => { level = v == null ? null : clamp(v, 0, 1); },
    pause: () => { running = false; cancelAnimationFrame(raf); },
    resume: () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
    destroy: () => {
      running = false; cancelAnimationFrame(raf); ro.disconnect();
      scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
      renderer.dispose(); renderer.domElement.remove();
    }
  };
}
