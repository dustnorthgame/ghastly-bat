// graphics3d.js — Three.js broadcast graphics for the Usher election platform.
// Every scene function takes a container element and returns a controller with dispose().
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';
const SANS = '"Barlow", "Helvetica Neue", Arial, sans-serif';
const SQRT3 = Math.sqrt(3);
const stillMode = new URLSearchParams(location.search).has('still');
const reducedMotion = stillMode || matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- utilities
export async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`800 100px ${COND}`),
      document.fonts.load(`700 100px ${COND}`),
      document.fonts.load(`600 100px ${COND}`),
      document.fonts.load(`600 100px ${SANS}`),
    ]);
  } catch {}
}

export const ease = {
  linear: (t) => t,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => {
    const c1 = 1.5, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  outQuint: (t) => 1 - Math.pow(1 - t, 5),
};

function col(hex) {
  return new THREE.Color(hex);
}
function shade(hex, amt) {
  // amt < 0 darkens towards black, > 0 lightens towards white
  const c = col(hex);
  return amt < 0 ? c.lerp(new THREE.Color(0, 0, 0), -amt) : c.lerp(new THREE.Color(1, 1, 1), amt);
}
function cssShade(hex, amt) {
  return '#' + shade(hex, amt).getHexString();
}
function luminance(hex) {
  const c = col(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}
/** Readable party colour for text on white. */
function inkOnWhite(hex) {
  return luminance(hex) > 0.55 ? cssShade(hex, -0.45) : hex;
}

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const api = {
    tex,
    canvas,
    ctx,
    redraw(fn = draw) {
      ctx.clearRect(0, 0, w, h);
      fn(ctx, w, h);
      tex.needsUpdate = true;
    },
  };
  if (draw) api.redraw(draw);
  return api;
}

/** Fit text into a width by shrinking font size. */
function fitFont(ctx, text, weight, size, family, maxW) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

/** A flat text label as a mesh. Height in world units. */
export function textPlane(text, { height = 0.3, color = '#ffffff', weight = 700, family = COND, bg = null, padX = 0.18, letter = 0 } = {}) {
  const px = 160;
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = `${weight} ${px}px ${family}`;
  const tw = Math.max(1, measure.measureText(text).width + letter * text.length * px);
  const cw = Math.ceil(tw + px * padX * 2);
  const ch = Math.ceil(px * 1.25);
  const ct = canvasTexture(cw, ch, (ctx) => {
    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);
    }
    ctx.font = `${weight} ${px}px ${family}`;
    if (letter) ctx.letterSpacing = `${letter * px}px`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cw / 2, ch / 2 + px * 0.04);
  });
  const mat = new THREE.MeshBasicMaterial({ map: ct.tex, transparent: true, toneMapped: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(height * (cw / ch), height), mat);
  mesh.userData.width = height * (cw / ch);
  return mesh;
}

function hexShape(r, rotation = Math.PI / 2) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}
function hexPath(r, rotation = Math.PI / 2) {
  const p = new THREE.Path();
  for (let i = 0; i < 6; i++) {
    const a = rotation + (i * Math.PI) / 3;
    i ? p.lineTo(Math.cos(a) * r, Math.sin(a) * r) : p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  p.closePath();
  return p;
}
/** Planar UVs from x/y so a square texture spans [-r, r]. */
function planarUV(geo, r) {
  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / (2 * r) + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / (2 * r) + 0.5;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

// ---------------------------------------------------------------- stage
export function createStage(container, opts = {}) {
  const { fov = 32, bloom = true, transparent = false, background = '#05070c', exposure = 1.0, shadows = false, bloomStrength = 0.5 } = opts;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'g-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  if (!transparent) scene.background = col(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(fov, 16 / 9, 0.1, 400);

  let composer = null;
  let bloomPass = null;
  if (bloom && !transparent) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), bloomStrength, 0.5, 0.94);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  const frameFns = new Set();
  const resizeFns = new Set();
  let tweens = [];
  let time = 0;
  let running = true;
  const clock = new THREE.Clock();

  function size() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    composer?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    resizeFns.forEach((fn) => fn(w, h));
  }
  const ro = new ResizeObserver(size);
  ro.observe(container);
  size();

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    time += dt;
    const live = [];
    for (const tw of tweens) {
      if (time < tw.start) {
        live.push(tw);
        continue;
      }
      const t = tw.dur <= 0 ? 1 : Math.min(1, (time - tw.start) / tw.dur);
      tw.update(tw.ease(t), t);
      if (t < 1) live.push(tw);
      else tw.resolve();
    }
    tweens = live;
    frameFns.forEach((fn) => fn(dt, time));
    composer ? composer.render() : renderer.render(scene, camera);
  }
  requestAnimationFrame(loop);

  const stage = {
    renderer,
    scene,
    camera,
    container,
    get time() {
      return time;
    },
    tween({ dur = 1, delay = 0, ease: e = ease.outCubic, update }) {
      if (stillMode) {
        dur = 0;
        delay = 0;
      } else if (reducedMotion) {
        dur = Math.min(dur, 0.15);
        delay = Math.min(delay, 0.05);
      }
      return new Promise((resolve) => tweens.push({ start: time + delay, dur, ease: e, update, resolve }));
    },
    wait(sec) {
      return stage.tween({ dur: reducedMotion ? 0 : sec, update() {} });
    },
    clearTweens() {
      tweens.forEach((t) => t.resolve());
      tweens = [];
    },
    onFrame(fn) {
      frameFns.add(fn);
      return () => frameFns.delete(fn);
    },
    onResize(fn) {
      resizeFns.add(fn);
      fn(container.clientWidth, container.clientHeight);
    },
    setBloom(v) {
      if (bloomPass) bloomPass.strength = v;
    },
    overlay(className = '') {
      const el = document.createElement('div');
      el.className = `g-overlay ${className}`;
      container.appendChild(el);
      return el;
    },
    dispose() {
      running = false;
      ro.disconnect();
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          m.map?.dispose?.();
          m.dispose?.();
        });
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
      container.querySelectorAll('.g-canvas, .g-overlay').forEach((n) => n.remove());
    },
  };
  return stage;
}

// ---------------------------------------------------------------- textures
const texCache = new Map();
function sunburstTexture() {
  if (texCache.has('sun')) return texCache.get('sun');
  const ct = canvasTexture(1024, 1024, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    for (let i = 0; i < 180; i++) {
      ctx.rotate((Math.PI * 2) / 180);
      ctx.fillStyle = i % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.0)';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(w, -6);
      ctx.lineTo(w, 6);
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const g = ctx.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  texCache.set('sun', ct.tex);
  return ct.tex;
}
function faceTexture() {
  if (texCache.has('face')) return texCache.get('face');
  const ct = canvasTexture(512, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f1f2f4');
    g.addColorStop(1, '#d9dbe0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  texCache.set('face', ct.tex);
  return ct.tex;
}
function glowTexture() {
  if (texCache.has('glow')) return texCache.get('glow');
  const ct = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  ct.tex.colorSpace = THREE.NoColorSpace;
  texCache.set('glow', ct.tex);
  return ct.tex;
}

// ---------------------------------------------------------------- hexagon badge
/**
 * Dimensional hexagon badge.
 * style 'white': coloured sunburst rim + white raised face, number in party colour (exit poll look).
 * style 'colour': lighter rim + party-colour face, white number (panel-wall look).
 */
export function makeHexBadge({ colour, name = '', value = 0, radius = 1, style = 'white', unit = '', glow = true }) {
  const g = new THREE.Group();
  const R = radius;
  const rimDepth = 0.14 * R;

  // back plate (dark seam between rim and face)
  const back = new THREE.Mesh(
    new THREE.ShapeGeometry(hexShape(R * 0.8)),
    new THREE.MeshStandardMaterial({ color: shade(colour, -0.7), roughness: 0.6 })
  );
  back.position.z = 0.01;
  g.add(back);

  // rim
  const rimShape = hexShape(R);
  rimShape.holes.push(hexPath(R * 0.79));
  const rimGeo = planarUV(
    new THREE.ExtrudeGeometry(rimShape, { depth: rimDepth, bevelEnabled: true, bevelThickness: 0.05 * R, bevelSize: 0.035 * R, bevelSegments: 3, curveSegments: 1 }),
    R * 1.05
  );
  const rimMat = new THREE.MeshPhysicalMaterial({
    color: style === 'white' ? col(colour) : shade(colour, 0.28),
    map: sunburstTexture(),
    metalness: 0.35,
    roughness: 0.3,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    envMapIntensity: style === 'white' ? 1 : 0.6,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  g.add(rim);

  // raised face
  const faceR = R * 0.74;
  const faceGeo = planarUV(
    new THREE.ExtrudeGeometry(hexShape(faceR), { depth: 0.12 * R, bevelEnabled: true, bevelThickness: 0.08 * R, bevelSize: 0.045 * R, bevelSegments: 5, curveSegments: 1 }),
    faceR * 1.08
  );
  const faceMat =
    style === 'white'
      ? new THREE.MeshPhysicalMaterial({ color: 0xd9dadd, map: faceTexture(), roughness: 0.4, clearcoat: 0.7, clearcoatRoughness: 0.25, envMapIntensity: 0.55 })
      : new THREE.MeshPhysicalMaterial({ color: col(colour), roughness: 0.36, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.25, envMapIntensity: 0.45, emissive: col(colour), emissiveIntensity: 0.06 });
  const face = new THREE.Mesh(faceGeo, faceMat);
  face.position.z = 0.02 * R;
  g.add(face);
  const faceTop = 0.02 * R + 0.12 * R + 0.08 * R;

  // text layer
  const textR = faceR * 0.98;
  const nameInk = style === 'white' ? '#5b5f66' : '#ffffff';
  const numInk = style === 'white' ? inkOnWhite(colour) : '#ffffff';
  let current = { name, value };
  const ct = canvasTexture(512, 512, null);
  function draw() {
    const { ctx } = ct;
    ct.redraw((c, w, h) => {
      c.textAlign = 'center';
      c.textBaseline = 'alphabetic';
      c.fillStyle = nameInk;
      fitFont(c, current.name, 600, 92, SANS, w * 0.66);
      c.fillText(current.name, w / 2, h * 0.37);
      c.fillStyle = numInk;
      const num = `${Math.round(current.value)}${unit}`;
      fitFont(c, num, 700, 250, COND, w * 0.74);
      if (style === 'white') {
        c.shadowColor = 'rgba(0,0,0,0.18)';
        c.shadowOffsetY = 4;
        c.shadowBlur = 6;
      } else {
        c.shadowColor = 'rgba(0,0,0,0.35)';
        c.shadowOffsetY = 5;
        c.shadowBlur = 10;
      }
      c.fillText(num, w / 2, h * 0.78);
      c.shadowColor = 'transparent';
    });
    void ctx;
  }
  draw();
  const label = new THREE.Mesh(
    planarUV(new THREE.ShapeGeometry(hexShape(textR)), textR),
    new THREE.MeshBasicMaterial({ map: ct.tex, transparent: true, toneMapped: false, depthWrite: false })
  );
  label.position.z = faceTop + 0.004;
  g.add(label);

  if (glow) {
    const glowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(R * 2.9, R * 2.9),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: col(colour), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    );
    glowMesh.position.z = -0.05;
    glowMesh.renderOrder = -1;
    g.add(glowMesh);
    g.userData.glow = glowMesh;
  }

  g.userData.depth = faceTop;
  g.userData.setValue = (v) => {
    current.value = v;
    draw();
  };
  g.userData.setName = (n) => {
    current.name = n;
    draw();
  };
  g.userData.value = () => current.value;
  return g;
}

/** Tween a badge's number from its current value to `to`. */
function countTo(stage, badge, to, dur = 1.4, delay = 0) {
  const from = badge.userData.value();
  return stage.tween({ dur, delay, ease: ease.outCubic, update: (t) => badge.userData.setValue(from + (to - from) * t) });
}

// ---------------------------------------------------------------- shared set pieces
function addStudioLights(scene, { key = 2.2, fill = 0.6 } = {}) {
  const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x1a1410, fill);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, key);
  dir.position.set(2, 4, 8);
  scene.add(dir);
  const rimL = new THREE.DirectionalLight(0x9fb6ff, 0.6);
  rimL.position.set(-6, 3, -2);
  scene.add(rimL);
  return { hemi, dir };
}

/** A Georgian-style townhouse façade drawn procedurally (fictional, not a real building). */
function makeFacade(accent) {
  const group = new THREE.Group();
  const W = 2048, H = 1024;
  const winRects = [];
  const tex = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#1c1414';
    ctx.fillRect(0, 0, W, H);
    // brickwork
    const bh = 14, bw = 44;
    for (let y = 0; y < H; y += bh) {
      const off = (y / bh) % 2 ? bw / 2 : 0;
      for (let x = -bw; x < W; x += bw) {
        const v = 26 + Math.random() * 22;
        ctx.fillStyle = `rgb(${v + 10},${v * 0.62},${v * 0.55})`;
        ctx.fillRect(x + off + 1, y + 1, bw - 2, bh - 2);
      }
    }
    // string course + cornice
    ctx.fillStyle = '#3b3633';
    ctx.fillRect(0, 430, W, 20);
    ctx.fillRect(0, 90, W, 26);
    // windows
    const cols = 9;
    for (let row = 0; row < 2; row++) {
      for (let i = 0; i < cols; i++) {
        const cx = (W / cols) * (i + 0.5);
        if (row === 1 && i === 4) continue; // door
        const ww = 120, wh = row === 0 ? 230 : 250;
        const wy = row === 0 ? 160 : 520;
        ctx.fillStyle = '#e9e4da';
        ctx.fillRect(cx - ww / 2 - 10, wy - 10, ww + 20, wh + 20);
        ctx.fillStyle = '#2a2c33';
        ctx.fillRect(cx - ww / 2, wy, ww, wh);
        winRects.push([cx - ww / 2, wy, ww, wh]);
        ctx.strokeStyle = '#e9e4da';
        ctx.lineWidth = 6;
        for (let k = 1; k < 3; k++) {
          ctx.beginPath();
          ctx.moveTo(cx - ww / 2 + (ww / 3) * k, wy);
          ctx.lineTo(cx - ww / 2 + (ww / 3) * k, wy + wh);
          ctx.stroke();
        }
        for (let k = 1; k < 4; k++) {
          ctx.beginPath();
          ctx.moveTo(cx - ww / 2, wy + (wh / 4) * k);
          ctx.lineTo(cx + ww / 2, wy + (wh / 4) * k);
          ctx.stroke();
        }
      }
    }
    // door with fanlight
    const dx = W / 2;
    ctx.fillStyle = '#d9d4c9';
    ctx.fillRect(dx - 110, 520, 220, 420);
    ctx.fillStyle = '#0c0d10';
    ctx.fillRect(dx - 80, 600, 160, 340);
    ctx.beginPath();
    ctx.arc(dx, 600, 80, Math.PI, 0);
    ctx.fillStyle = '#c8b48a';
    ctx.fill();
  });
  const emis = canvasTexture(W, H, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const [x, y, w, h] of winRects) {
      const lit = Math.random() > 0.35;
      if (!lit) continue;
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,214,160,0.9)');
      g.addColorStop(1, 'rgba(255,170,110,0.5)');
      ctx.fillStyle = g;
      ctx.fillRect(x + 4, y + 4, w - 8, h - 8);
    }
  });
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 17),
    new THREE.MeshStandardMaterial({ map: tex.tex, color: 0x8a8a8a, emissiveMap: emis.tex, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.95, envMapIntensity: 0.06 })
  );
  wall.position.set(0, 5.6, -7);
  group.add(wall);

  // railings
  const n = 90;
  const bar = new THREE.CylinderGeometry(0.018, 0.018, 1.3, 6);
  bar.translate(0, 0.65, 0);
  const rail = new THREE.InstancedMesh(bar, new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.8, roughness: 0.4 }), n);
  const m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    m.makeTranslation(-13 + (26 / n) * i, -2.6, -5.2);
    rail.setMatrixAt(i, m);
  }
  group.add(rail);
  const topRail = new THREE.Mesh(new THREE.BoxGeometry(26, 0.05, 0.05), rail.material);
  topRail.position.set(0, -1.35, -5.2);
  group.add(topRail);

  // street
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: 0x111216, roughness: 0.6, metalness: 0.2, envMapIntensity: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.6;
  group.add(floor);

  // coloured uplights washing the façade
  const spots = [];
  for (const x of [-9, -3.5, 3.5, 9]) {
    const s = new THREE.SpotLight(col(accent), 0, 32, 0.5, 0.75, 1.1);
    s.position.set(x * 0.8, -2.4, -2.5);
    s.target.position.set(x, 5, -7);
    group.add(s, s.target);
    spots.push(s);
  }
  group.userData.spots = spots;
  group.userData.setAccent = (c) => spots.forEach((s) => s.color.set(c));
  return group;
}

// ---------------------------------------------------------------- EXIT POLL (reference: honeycomb badges in front of a façade)
/**
 * entries: [{ id, name, short, colour, seats, image? }]
 * opts: { title, outcomeText, note, autoplay, onDone }
 */
export async function exitPollScene(container, entries, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 30, bloomStrength: 0.32, exposure: 0.95 });
  const { scene, camera } = stage;
  scene.fog = new THREE.Fog(0x05070c, 18, 42);
  addStudioLights(scene, { key: 1.3, fill: 0.35 });

  const sorted = [...entries].sort((a, b) => b.seats - a.seats);
  const lead = sorted[0];
  const facade = makeFacade(lead?.colour || '#888');
  scene.add(facade);

  // "EXIT POLL" sign — white rounded box with lettering in the leading colour
  const sign = new THREE.Group();
  const signBox = new THREE.Mesh(new RoundedBoxGeometry(3.6, 0.92, 0.18, 4, 0.06), new THREE.MeshPhysicalMaterial({ color: 0xcfd1d6, roughness: 0.35, clearcoat: 0.8, envMapIntensity: 0.5 }));
  sign.add(signBox);
  const signText = textPlane(opts.title || 'EXIT POLL', { height: 0.78, color: inkOnWhite(lead?.colour || '#c00'), weight: 800, letter: 0.02 });
  signText.position.z = 0.095;
  if (signText.userData.width > 3.4) signText.scale.setScalar(3.4 / signText.userData.width);
  sign.add(signText);
  sign.position.set(0, 2.25, 0);
  scene.add(sign);

  // honeycomb slots: lead centre-bottom, others alternate left/right
  const r = 0.62;
  const dx = SQRT3 * r * 1.07;
  const dy = 1.5 * r * 1.07;
  const x1 = -2.2, y1 = -0.38;
  const slotsL = [
    [x1, y1], // lower inner
    [x1 + dx / 2, y1 + dy], // upper inner
    [x1 - dx / 2, y1 + dy], // upper outer
    [x1 - dx, y1], // lower outer
    [x1 - dx * 1.5, y1 + dy],
    [x1 - dx / 2, y1 - dy],
    [x1 - dx * 1.5, y1 - dy],
  ];
  const slots = [];
  for (let i = 0; i < slotsL.length; i++) {
    slots.push(slotsL[i], [-slotsL[i][0], slotsL[i][1]]);
  }

  const badges = [];
  if (lead) {
    const b = makeHexBadge({ colour: lead.colour, name: lead.short, value: 0, radius: 1.42 });
    b.position.set(0, -0.62, 0.35);
    b.userData.home = b.position.clone();
    b.userData.entry = lead;
    badges.push(b);
    if (lead.image) {
      new THREE.TextureLoader().load(lead.image, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        const a = t.image.width / t.image.height;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(1.9 * a, 1.9), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
        p.position.set(0, 1.05, 0.05);
        b.userData.portrait = p;
        p.material.opacity = 0;
        scene.add(p);
      });
    }
  }
  sorted.slice(1).forEach((e, i) => {
    const s = slots[i] || [((i % 2) ? 1 : -1) * (4.2 + Math.floor(i / 2) * 0.4), -1.8];
    const b = makeHexBadge({ colour: e.colour, name: e.short, value: 0, radius: r });
    b.position.set(s[0], s[1], 0);
    b.userData.home = b.position.clone();
    b.userData.entry = e;
    badges.push(b);
  });
  badges.forEach((b) => {
    b.visible = false;
    scene.add(b);
  });

  // camera framing that works on wide and tall screens
  const fit = () => {
    const halfW = 4.3;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(9.6, halfW / (t * camera.aspect), 2.95 / t);
    camera.userData.dist = dist;
  };
  stage.onResize(fit);

  // overlay
  const ov = stage.overlay('ep-overlay');
  ov.innerHTML = `
    <div class="ep-strip" hidden>
      <span class="ep-chip">Projection</span>
      <strong class="ep-outcome"></strong>
      <span class="ep-meta"></span>
    </div>`;
  const strip = ov.querySelector('.ep-strip');
  strip.querySelector('.ep-outcome').textContent = opts.outcomeText || '';
  strip.querySelector('.ep-meta').textContent = opts.note || '326 for a majority · 650 seats';

  let idleOff = null;
  async function play() {
    stage.clearTweens();
    idleOff?.();
    strip.hidden = true;
    strip.classList.remove('in');
    const d = camera.userData.dist;
    facade.userData.spots.forEach((s) => (s.intensity = 0));
    sign.position.y = 6;
    badges.forEach((b) => {
      b.visible = false;
      b.userData.setValue(0);
    });

    // 1. camera glides in from high and wide
    stage.tween({
      dur: 3.2,
      ease: ease.inOutCubic,
      update: (t) => {
        camera.position.set(Math.sin((1 - t) * 0.5) * d * 0.4, 0.2 + (1 - t) * 3.5, d + (1 - t) * 8);
        camera.lookAt(0, -0.05 - (1 - t) * 0.3, 0);
      },
    });
    // 2. façade lights up in the leading colour
    stage.tween({ dur: 2, delay: 0.6, update: (t) => facade.userData.spots.forEach((s) => (s.intensity = t * 900)) });
    // 3. sign drops in
    await stage.tween({ dur: 1.1, delay: 1.1, ease: ease.outBack, update: (t) => (sign.position.y = 6 + (2.25 - 6) * t) });

    // 4. badges: smallest first, lead last
    const order = badges.slice(1).reverse();
    for (const b of order) {
      revealBadge(b, 0.62);
      await stage.wait(0.42);
    }
    await stage.wait(0.5);
    if (badges[0]) {
      revealBadge(badges[0], 1.2, 1.9);
      const p = badges[0].userData.portrait;
      if (p) stage.tween({ dur: 1.2, delay: 0.4, update: (t) => (p.material.opacity = t) });
      await stage.wait(2.1);
    }
    strip.hidden = false;
    requestAnimationFrame(() => strip.classList.add('in'));
    idle();
    opts.onDone?.();
  }

  function revealBadge(b, dur, countDur = 1.2) {
    const home = b.userData.home;
    b.visible = true;
    stage.tween({
      dur: dur + 0.3,
      ease: ease.outBack,
      update: (t) => {
        b.position.set(home.x, home.y - (1 - t) * 0.8, home.z - (1 - t) * 5);
        b.rotation.y = (1 - t) * Math.PI * 1.5;
        b.scale.setScalar(Math.max(0.001, t));
      },
    });
    countTo(stage, b, b.userData.entry.seats, countDur, dur * 0.4);
  }

  function idle() {
    const d = camera.userData.dist;
    const t0 = stage.time;
    idleOff = stage.onFrame((dt, time) => {
      const t = time - t0;
      badges.forEach((b, i) => {
        const h = b.userData.home;
        b.position.y = h.y + Math.sin(t * 1.1 + i * 1.3) * 0.025;
        b.rotation.y = Math.sin(t * 0.6 + i) * 0.06;
        b.rotation.x = Math.cos(t * 0.5 + i) * 0.03;
      });
      camera.position.set(Math.sin(t * 0.12) * 0.6, 0.2 + Math.sin(t * 0.17) * 0.08, d);
      camera.lookAt(0, -0.05, 0);
      facade.userData.spots.forEach((s, i) => (s.target.position.x = [-9, -3.5, 3.5, 9][i] + Math.sin(t * 0.4 + i) * 1.2));
    });
  }

  if (opts.autoplay !== false) play();
  return {
    stage,
    replay: play,
    dispose: () => stage.dispose(),
  };
}

// ---------------------------------------------------------------- PANEL WALL (reference: curved wall of party panels)
/** entries: [{ name, short, colour, seats, change, image? }] */
export async function partyWallScene(container, entries, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 34, bloomStrength: 0.25, exposure: 0.95 });
  const { scene, camera } = stage;
  scene.background = col('#0a0c12');
  addStudioLights(scene, { key: 1.2, fill: 0.45 });

  // glossy wooden floor
  const wood = canvasTexture(1024, 1024, (ctx, w, h) => {
    for (let i = 0; i < 16; i++) {
      const v = 120 + Math.random() * 40;
      ctx.fillStyle = `rgb(${v},${v * 0.72},${v * 0.48})`;
      ctx.fillRect(0, (h / 16) * i, w, h / 16 - 2);
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `rgba(60,35,15,${Math.random() * 0.15})`;
        ctx.fillRect(Math.random() * w, (h / 16) * i + Math.random() * (h / 16), Math.random() * 200, 1.5);
      }
    }
  });
  wood.tex.wrapS = wood.tex.wrapT = THREE.RepeatWrapping;
  wood.tex.repeat.set(6, 6);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshPhysicalMaterial({ map: wood.tex, color: 0x8a7a6a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  scene.add(floor);

  const R = 9.5;
  const pw = 2.3, ph = 5.6, gap = 0.08;
  const step = (pw + gap) / R;
  const n = entries.length;
  const start = (-step * (n - 1)) / 2;
  const panels = [];

  entries.forEach((e, i) => {
    const a = start + step * i;
    const grp = new THREE.Group();
    grp.position.set(Math.sin(a) * R, -3 + ph / 2 + 0.05, -Math.cos(a) * R);
    grp.lookAt(0, grp.position.y, 0);

    const grad = canvasTexture(256, 1024, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, cssShade(e.colour, -0.7));
      g.addColorStop(0.55, cssShade(e.colour, -0.15));
      g.addColorStop(1, e.colour);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      // subtle vertical sheen
      const s = ctx.createLinearGradient(0, 0, w, 0);
      s.addColorStop(0, 'rgba(0,0,0,0.18)');
      s.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      s.addColorStop(1, 'rgba(0,0,0,0.18)');
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, w, h);
    });
    const panel = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, 0.08), [
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
      new THREE.MeshStandardMaterial({ map: grad.tex, color: 0x9a9a9a, emissiveMap: grad.tex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.6, envMapIntensity: 0.15 }),
      new THREE.MeshStandardMaterial({ color: 0x111111 }),
    ]);
    grp.add(panel);

    const nameLbl = textPlane(e.name.toUpperCase(), { height: 0.17, weight: 700, letter: 0.06 });
    if (nameLbl.userData.width > pw * 0.88) nameLbl.scale.setScalar((pw * 0.88) / nameLbl.userData.width);
    nameLbl.position.set(0, ph / 2 - 0.35, 0.05);
    grp.add(nameLbl);

    if (e.image) {
      new THREE.TextureLoader().load(e.image, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        const asp = t.image.width / t.image.height;
        const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4 * asp, 2.4), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false }));
        p.position.set(0, 1.0, 0.05);
        grp.add(p);
      });
    }

    const badge = makeHexBadge({ colour: e.colour, name: e.short, value: 0, radius: 0.72, style: 'colour', glow: true });
    badge.position.set(0, -0.55, 0.12);
    badge.scale.setScalar(0.001);
    grp.add(badge);

    const sign = e.change > 0 ? '+' : '';
    const ch = textPlane(`${sign}${e.change} SINCE ${opts.prevLabel || 'LAST TIME'}`, { height: 0.3, weight: 700, letter: 0.02 });
    if (ch.userData.width > pw * 0.92) ch.scale.setScalar((pw * 0.92) / ch.userData.width);
    ch.position.set(0, -1.95, 0.05);
    ch.material.opacity = 0;
    grp.add(ch);

    const home = grp.position.clone();
    grp.position.y = home.y - ph - 1;
    scene.add(grp);
    panels.push({ grp, home, badge, ch, entry: e });
  });

  stage.onResize(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfA = Math.min(1.3, (step * n) / 2);
    const halfW = Math.max(3.2, Math.sin(halfA) * R + 0.35);
    const needW = halfW / (t * camera.aspect);
    const needH = (ph / 2 + 0.6) / t;
    camera.userData.z = Math.max(needW, needH) - R * Math.cos(halfA * 0.6);
  });

  let idleOff = null;
  async function play() {
    stage.clearTweens();
    idleOff?.();
    panels.forEach((p) => {
      p.grp.position.y = p.home.y - ph - 1;
      p.badge.scale.setScalar(0.001);
      p.badge.userData.setValue(0);
      p.ch.material.opacity = 0;
    });
    const z = camera.userData.z ?? 3;
    stage.tween({
      dur: 3,
      ease: ease.inOutCubic,
      update: (t) => {
        camera.position.set(0, -0.9 + (1 - t) * 1.2, z + (1 - t) * 3);
        camera.lookAt(0, -0.25, -R);
      },
    });
    panels.forEach((p, i) =>
      stage.tween({ dur: 1.1, delay: 0.3 + i * 0.12, ease: ease.outQuint, update: (t) => (p.grp.position.y = p.home.y - (ph + 1) * (1 - t)) })
    );
    await stage.wait(0.6 + panels.length * 0.12 + 0.6);
    const order = [...panels].sort((a, b) => a.entry.seats - b.entry.seats);
    for (const p of order) {
      stage.tween({
        dur: 1,
        ease: ease.outBack,
        update: (t) => {
          p.badge.scale.setScalar(Math.max(0.001, t));
          p.badge.rotation.y = (1 - t) * Math.PI;
        },
      });
      countTo(stage, p.badge, p.entry.seats, 1.3, 0.3);
      stage.tween({ dur: 0.6, delay: 1.2, update: (t) => (p.ch.material.opacity = t) });
      await stage.wait(0.45);
    }
    const t0 = stage.time;
    idleOff = stage.onFrame((dt, time) => {
      const t = time - t0;
      camera.position.x = Math.sin(t * 0.15) * 0.9;
      camera.lookAt(Math.sin(t * 0.15) * 1.5, -0.25, -R);
      panels.forEach((p, i) => (p.badge.position.y = -0.55 + Math.sin(t * 1.2 + i) * 0.03));
    });
    opts.onDone?.();
  }
  play();
  return { stage, replay: play, dispose: () => stage.dispose() };
}

// ---------------------------------------------------------------- SWINGOMETER
/**
 * Upright semicircular dial with a pointer pivoting at the bottom.
 * Right half = party B (swing towards B), left half = party A.
 * targets: [{ need, holder }] from calc.swingTargets
 */
export async function swingometerScene(container, opts = {}) {
  await fontsReady();
  const MAX = opts.max || 15;
  const stage = createStage(container, { fov: 30, bloomStrength: 0.4 });
  const { scene, camera } = stage;
  scene.background = col('#060912');
  addStudioLights(scene, { key: 2.0, fill: 0.6 });

  const R = 3.3;
  const pivot = new THREE.Vector3(0, -1.65, 0);
  const root = new THREE.Group();
  root.position.copy(pivot);
  scene.add(root);

  // back glow
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(R * 3.6, R * 3.6),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x3050a0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  halo.position.set(0, 0.6, -0.6);
  root.add(halo);

  function halfDisc(startA, endA, radius, inner = 0) {
    const s = new THREE.Shape();
    s.moveTo(Math.cos(startA) * inner, Math.sin(startA) * inner);
    s.absarc(0, 0, radius, startA, endA, false);
    if (inner > 0) s.absarc(0, 0, inner, endA, startA, true);
    else s.lineTo(0, 0);
    return s;
  }
  const discOpts = { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 64 };
  const matA = new THREE.MeshPhysicalMaterial({ color: 0x888888, roughness: 0.35, clearcoat: 0.8, metalness: 0.2 });
  const matB = matA.clone();
  const discA = new THREE.Mesh(new THREE.ExtrudeGeometry(halfDisc(Math.PI / 2, Math.PI, R), discOpts), matA);
  const discB = new THREE.Mesh(new THREE.ExtrudeGeometry(halfDisc(0, Math.PI / 2, R), discOpts), matB);
  root.add(discA, discB);

  // outer bezel
  const bezel = new THREE.Mesh(
    new THREE.ExtrudeGeometry(halfDisc(0, Math.PI, R + 0.16, R + 0.02), { ...discOpts, depth: 0.26 }),
    new THREE.MeshPhysicalMaterial({ color: 0xd9dce2, metalness: 0.9, roughness: 0.22 })
  );
  bezel.position.z = -0.03;
  root.add(bezel);
  const base = new THREE.Mesh(new RoundedBoxGeometry(2 * R + 0.6, 0.35, 0.6, 4, 0.08), bezel.material);
  base.position.set(0, -0.18, 0.05);
  root.add(base);

  // dial face markings
  const face = canvasTexture(2048, 1024, (ctx, w, h) => {
    const cx = w / 2, cy = h, rr = h * 0.96;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = -MAX; v <= MAX; v += 0.5) {
      const ang = -Math.PI / 2 + (v / MAX) * (Math.PI / 2);
      const major = Number.isInteger(v) && v % 5 === 0;
      const mid = Number.isInteger(v);
      const len = major ? 60 : mid ? 34 : 18;
      ctx.lineWidth = major ? 6 : mid ? 3.5 : 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr);
      ctx.lineTo(cx + Math.cos(ang) * (rr - len), cy + Math.sin(ang) * (rr - len));
      ctx.stroke();
      if (major) {
        ctx.font = `700 54px ${COND}`;
        const tr = rr - 100;
        ctx.fillText(`${Math.abs(v)}%`, cx + Math.cos(ang) * tr, cy + Math.sin(ang) * tr);
      }
    }
    ctx.beginPath();
    ctx.lineWidth = 3;
    ctx.arc(cx, cy, rr - 150, Math.PI, 0);
    ctx.stroke();
  });
  const faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * R * 0.98, R * 0.98), new THREE.MeshBasicMaterial({ map: face.tex, transparent: true, toneMapped: false, depthWrite: false }));
  faceMesh.position.set(0, (R * 0.98) / 2, 0.205);
  root.add(faceMesh);

  // party labels on the dial
  let labelA = null, labelB = null;
  function setLabels(a, b) {
    [labelA, labelB].forEach((l) => l && root.remove(l));
    labelA = textPlane(a.short.toUpperCase(), { height: 0.42, weight: 800 });
    labelB = textPlane(b.short.toUpperCase(), { height: 0.42, weight: 800 });
    labelA.position.set(-R * 0.48, R * 0.28, 0.22);
    labelB.position.set(R * 0.48, R * 0.28, 0.22);
    root.add(labelA, labelB);
  }

  // target seat chips
  const chipGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6);
  chipGeo.rotateX(Math.PI / 2);
  const MAXCHIPS = 700;
  const chips = new THREE.InstancedMesh(chipGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2 }), MAXCHIPS);
  chips.count = 0;
  root.add(chips);
  let chipData = [];

  // pointer
  const pointer = new THREE.Group();
  const armMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.2, clearcoat: 1 });
  const arm = new THREE.Mesh(new RoundedBoxGeometry(0.11, R * 1.02, 0.08, 3, 0.03), armMat);
  arm.position.y = (R * 1.02) / 2;
  const tipShape = new THREE.Shape();
  tipShape.moveTo(-0.16, 0);
  tipShape.lineTo(0.16, 0);
  tipShape.lineTo(0, 0.34);
  tipShape.closePath();
  const tip = new THREE.Mesh(new THREE.ExtrudeGeometry(tipShape, { depth: 0.08, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: 0xffd34d, emissive: 0xffb000, emissiveIntensity: 1.2 }));
  tip.position.set(0, R * 1.02, -0.04);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 48), bezel.material);
  hub.rotation.x = Math.PI / 2;
  pointer.add(arm, tip, hub);
  pointer.position.z = 0.32;
  root.add(pointer);

  const ov = stage.overlay('sw-overlay');

  let target = 0, shown = 0, vel = 0;
  let cA = '#888', cB = '#888';
  const tmpM = new THREE.Matrix4();
  const tmpC = new THREE.Color();

  function layoutChips(targets) {
    // bucket by 0.5% so chips stack outward from the hub
    const buckets = new Map();
    chipData = [];
    for (const t of targets) {
      if (Math.abs(t.need) > MAX) continue;
      const key = Math.round(t.need * 2) / 2 || (t.need >= 0 ? 0.5 : -0.5);
      const k = buckets.get(key) || 0;
      buckets.set(key, k + 1);
      const ring = R * 0.36 + k * 0.16;
      if (ring > R * 0.76) continue;
      const ang = Math.PI / 2 - (key / MAX) * (Math.PI / 2);
      chipData.push({ need: t.need, holder: t.holder, x: Math.cos(ang) * ring, y: Math.sin(ang) * ring, lift: 0 });
    }
    chips.count = Math.min(MAXCHIPS, chipData.length);
  }

  stage.onResize(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(11, (R + 0.9) / (t * camera.aspect), 3.2 / t);
    camera.position.set(0, 0.4, dist);
    camera.lookAt(0, 0.05, 0);
  });

  stage.onFrame((dt, time) => {
    // critically damped spring for the pointer
    const k = 22, c = 2 * Math.sqrt(k);
    vel += (k * (target - shown) - c * vel) * dt;
    shown += vel * dt;
    pointer.rotation.z = -(Math.max(-MAX, Math.min(MAX, shown)) / MAX) * (Math.PI / 2);
    for (let i = 0; i < chips.count; i++) {
      const d = chipData[i];
      const fallen = d.need >= 0 ? shown >= d.need && d.need > 0 : shown <= d.need;
      d.lift += ((fallen ? 1 : 0) - d.lift) * Math.min(1, dt * 8);
      tmpM.makeTranslation(d.x, d.y, 0.24 + d.lift * 0.12);
      chips.setMatrixAt(i, tmpM);
      const holderC = d.holder === opts.a ? cA : cB;
      const gainC = d.holder === opts.a ? cB : cA;
      tmpC.set(holderC).lerp(new THREE.Color(gainC), d.lift);
      if (!fallen) tmpC.multiplyScalar(0.6);
      chips.setColorAt(i, tmpC);
    }
    chips.instanceMatrix.needsUpdate = true;
    if (chips.instanceColor) chips.instanceColor.needsUpdate = true;
    halo.material.opacity = 0.3 + Math.sin(time * 1.5) * 0.05;
  });

  return {
    stage,
    overlay: ov,
    /** a, b: party objects; swing: pp from a to b; targets from calc.swingTargets */
    set({ a, b, swing, targets }) {
      if (a && b) {
        opts.a = a.id;
        cA = a.colour;
        cB = b.colour;
        matA.color.set(shade(a.colour, -0.15));
        matB.color.set(shade(b.colour, -0.15));
        setLabels(a, b);
      }
      if (targets) layoutChips(targets);
      if (typeof swing === 'number') target = swing;
    },
    dispose: () => stage.dispose(),
  };
}

// ---------------------------------------------------------------- SEAT / SHARE COLUMNS
/**
 * items: [{ id, label, colour, value, display? }]  value may be negative (net change)
 * opts: { max, line: { value, label }, unit, title }
 */
export async function barsScene(container, items, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 30, bloomStrength: 0.18, exposure: 0.9, transparent: !!opts.transparent });
  const { scene, camera } = stage;
  if (!opts.transparent) scene.background = col(opts.background || '#070a12');
  addStudioLights(scene, { key: 1.5, fill: 0.45 });

  const H = 3.6;
  const group = new THREE.Group();
  scene.add(group);

  // studio floor with reflection-ish sheen
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.MeshPhysicalMaterial({ color: 0x0a0e18, roughness: 0.35, metalness: 0.3, clearcoat: 0.6, envMapIntensity: 0.08 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  if (!opts.transparent) scene.add(floor);

  let cols = [];
  let lineGroup = null;
  let max = opts.max || 1;

  function build(list) {
    cols.forEach((c) => group.remove(c.g));
    cols = [];
    const n = list.length;
    const w = Math.min(1.25, 7.5 / n);
    const gap = w * 0.45;
    const total = n * w + (n - 1) * gap;
    list.forEach((it, i) => {
      const g = new THREE.Group();
      g.position.x = -total / 2 + w / 2 + i * (w + gap);
      const mat = new THREE.MeshPhysicalMaterial({ color: col(it.colour), roughness: 0.38, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2, envMapIntensity: 0.4, emissive: col(it.colour), emissiveIntensity: 0.12 });
      const geo = new THREE.BoxGeometry(w, 1, w * 0.7);
      geo.translate(0, 0.5, 0);
      const box = new THREE.Mesh(geo, mat);
      box.scale.y = 0.0001;
      g.add(box);
      const badge = makeHexBadge({ colour: it.colour, name: '', value: 0, radius: w * 0.62, glow: false, unit: opts.unit || '' });
      badge.position.z = w * 0.4;
      g.add(badge);
      const lbl = textPlane(it.label, { height: Math.min(0.32, w * 0.34), weight: 700 });
      if (lbl.userData.width > w + gap * 0.9) lbl.scale.setScalar((w + gap * 0.9) / lbl.userData.width);
      lbl.position.set(0, -0.32, w * 0.36);
      g.add(lbl);
      group.add(g);
      cols.push({ g, box, badge, item: it, h: 0, w });
    });
  }

  function buildLine() {
    if (lineGroup) group.remove(lineGroup);
    lineGroup = null;
    if (!opts.line) return;
    lineGroup = new THREE.Group();
    const y = (opts.line.value / max) * H;
    const width = 9.5;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(width, 0.025, 0.025), new THREE.MeshBasicMaterial({ color: 0xffd34d, toneMapped: false }));
    bar.position.y = y;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, 1.2), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false }));
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.y = y;
    const lbl = textPlane(opts.line.label, { height: 0.26, color: '#ffd34d', weight: 700 });
    lbl.position.set(width / 2 - lbl.userData.width / 2, y + 0.2, 0.3);
    lineGroup.add(bar, sheet, lbl);
    group.add(lineGroup);
  }

  function animateTo(list) {
    max = opts.max || Math.max(1, ...list.map((i) => Math.abs(i.value)));
    list.forEach((it, i) => {
      const c = cols[i];
      if (!c) return;
      const fromH = c.h;
      const toH = (it.value / max) * H;
      c.h = toH;
      const fromV = c.badge.userData.value();
      stage.tween({
        dur: 1.6,
        delay: i * 0.08,
        ease: ease.outCubic,
        update: (t) => {
          const h = fromH + (toH - fromH) * t;
          c.box.scale.y = Math.max(0.0001, Math.abs(h));
          c.box.position.y = h < 0 ? h : 0;
          c.badge.position.y = h < 0 ? 0.0 + c.w * 0.62 : h + c.w * 0.62 + 0.05;
          c.badge.userData.setValue(fromV + (it.value - fromV) * t);
        },
      });
    });
    buildLine();
  }

  stage.onResize(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = Math.max(10, 5.3 / (t * camera.aspect), 3.2 / t);
    camera.userData.dist = dist;
  });
  const t0 = stage.time;
  stage.onFrame((dt, time) => {
    const t = time - t0;
    const d = camera.userData.dist || 12;
    camera.position.set(Math.sin(t * 0.13) * 1.2, 2.2 + Math.sin(t * 0.21) * 0.15, d);
    camera.lookAt(0, H * 0.42, 0);
  });

  build(items);
  animateTo(items);
  return {
    stage,
    update(list) {
      const same = list.length === cols.length && list.every((it, i) => it.id === cols[i].item.id);
      if (!same) {
        build(list);
      }
      cols.forEach((c, i) => (c.item = list[i]));
      animateTo(list);
    },
    dispose: () => stage.dispose(),
  };
}

// ---------------------------------------------------------------- HOUSE OF COMMONS CHAMBER
/**
 * seats: ordered list of { id, colour, count } for government side first entry,
 *        then opposition parties, then undeclared (id: '_none').
 * opts: { government: partyId, majority: 326 }
 */
export async function chamberScene(container, groups, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 34, bloomStrength: 0.2, exposure: 0.95 });
  const { scene, camera, renderer } = stage;
  scene.background = col('#080b10');
  addStudioLights(scene, { key: 1.6, fill: 0.8 });

  const ROWS = 7;
  const SP = 0.3;
  const seatGeo = new RoundedBoxGeometry(0.24, 0.16, 0.24, 2, 0.05);
  const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshPhysicalMaterial({ roughness: 0.35, clearcoat: 0.6 }), 650);
  scene.add(seats);
  const benchMat = new THREE.MeshStandardMaterial({ color: 0x1f4a37, roughness: 0.8 });
  const benchGroup = new THREE.Group();
  scene.add(benchGroup);

  // table, dispatch boxes, Speaker's chair
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3020, roughness: 0.6 });
  const table = new THREE.Mesh(new RoundedBoxGeometry(5, 0.4, 1.2, 3, 0.05), wood);
  table.position.set(-3, 0.2, 0);
  scene.add(table);
  const chair = new THREE.Mesh(new RoundedBoxGeometry(0.9, 1.8, 0.9, 3, 0.1), wood);
  scene.add(chair);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshStandardMaterial({ color: 0x0e1410, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(30, 1.9), new THREE.MeshStandardMaterial({ color: 0x163b2a, roughness: 1 }));
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.005;
  scene.add(carpet);

  let marker = null;
  const ov = stage.overlay('ch-overlay');
  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const tmpP = new THREE.Vector3();
  let layout = [];

  function place(list) {
    benchGroup.clear();
    if (marker) scene.remove(marker);
    marker = null;
    const gov = list[0] && list[0].id !== '_none' ? list[0] : null;
    const govCount = gov ? gov.count : 0;
    const rest = list.slice(gov ? 1 : 0).filter((g) => g.id !== '_none');
    const none = list.find((g) => g.id === '_none');
    const oppCount = rest.reduce((a, g) => a + g.count, 0);
    const colsN = Math.max(20, Math.ceil(Math.max(govCount, oppCount) / ROWS));
    const length = colsN * SP;
    const x0 = -length / 2 + 0.6;

    // benches
    for (const side of [1, -1]) {
      for (let r = 0; r < ROWS; r++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(length + 0.2, 0.12 + r * 0.16, 0.3), benchMat);
        b.position.set(x0 + length / 2 - SP / 2, (0.12 + r * 0.16) / 2, side * (1.15 + r * SP));
        benchGroup.add(b);
      }
    }
    table.position.set(x0 + 2.5, 0.2, 0);
    table.scale.x = Math.min(1, length / 8);
    chair.position.set(x0 - 1.2, 0.9, 0);
    carpet.scale.x = (length + 3) / 30;
    carpet.position.x = x0 + length / 2 - 1;

    layout = [];
    const seatPos = (side, idx) => {
      const c = Math.floor(idx / ROWS);
      const r = idx % ROWS;
      return new THREE.Vector3(x0 + c * SP, 0.12 + r * 0.16 + 0.08, side * (1.15 + r * SP));
    };
    let gi = 0;
    if (gov) for (let i = 0; i < govCount; i++) layout.push({ p: seatPos(1, gi++), colour: gov.colour });
    let oi = 0;
    for (const g of rest) for (let i = 0; i < g.count; i++) layout.push({ p: seatPos(-1, oi++), colour: g.colour });
    // undeclared on the cross benches at the far end, facing the Speaker
    if (none) {
      const crossCols = Math.ceil(none.count / 12);
      for (let i = 0; i < none.count; i++) {
        const c = Math.floor(i / 12), rr = i % 12;
        layout.push({ p: new THREE.Vector3(x0 + length + 0.8 + c * SP, 0.1, -1.65 + rr * SP), colour: '#39404c', dim: true });
      }
      void crossCols;
    }

    // majority marker on the government benches
    const mj = opts.majority || 326;
    const c = Math.floor((mj - 1) / ROWS);
    const mx = x0 + c * SP + SP / 2;
    marker = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.6, ROWS * SP + 0.3), new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, toneMapped: false }));
    post.position.set(mx, 0.8, 1.15 + ((ROWS - 1) * SP) / 2);
    const lbl = textPlane(`${mj} FOR MAJORITY`, { height: 0.3, color: '#ffd34d', weight: 700 });
    lbl.position.set(mx, 1.85, 1.15 + ((ROWS - 1) * SP) / 2);
    marker.add(post, lbl);
    marker.userData.lbl = lbl;
    scene.add(marker);

    camera.userData.len = length;
  }

  function fill() {
    seats.count = layout.length;
    layout.forEach((s, i) => {
      seats.setColorAt(i, new THREE.Color(s.colour));
      tmpM.compose(s.p, tmpQ, tmpS.setScalar(0.0001));
      seats.setMatrixAt(i, tmpM);
    });
    seats.instanceMatrix.needsUpdate = true;
    if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
    const n = layout.length;
    stage.tween({
      dur: 2.4,
      ease: ease.linear,
      update: (t) => {
        for (let i = 0; i < n; i++) {
          const local = Math.min(1, Math.max(0, t * 1.6 - (i / n) * 0.6));
          const s = ease.outBack(local);
          tmpM.compose(tmpP.copy(layout[i].p).setY(layout[i].p.y + (1 - local) * 0.6), tmpQ, tmpS.setScalar(Math.max(0.0001, s)));
          seats.setMatrixAt(i, tmpM);
        }
        seats.instanceMatrix.needsUpdate = true;
      },
    });
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.35;
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.autoRotate = !reducedMotion;
  controls.autoRotateSpeed = 0.35;
  controls.enablePan = false;

  function frameCam() {
    const len = camera.userData.len || 15;
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(9, (len * 0.62) / (t * camera.aspect));
    camera.position.set(len * 0.12, d * 0.55, d * 0.78);
    controls.target.set(0.5, 0.3, 0);
    controls.update();
  }
  stage.onFrame(() => {
    controls.update();
    if (marker) marker.userData.lbl.quaternion.copy(camera.quaternion);
  });

  place(groups);
  stage.onResize(frameCam);
  fill();
  return {
    stage,
    overlay: ov,
    update(list) {
      place(list);
      fill();
    },
    dispose: () => {
      controls.dispose();
      stage.dispose();
    },
  };
}

// ---------------------------------------------------------------- 3D CONSTITUENCY MAP (hex cartogram or uploaded GeoJSON)
/**
 * cons: constituencies (with hex {col,row})
 * styleOf(con) -> { colour, height, pulse? }
 * opts: { geojson, onHover(con|null, event), onClick(con) }
 */
export async function mapScene(container, cons, styleOf, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 32, bloomStrength: 0.2, exposure: 0.95 });
  const { scene, camera, renderer } = stage;
  scene.background = col('#060912');
  addStudioLights(scene, { key: 1.5, fill: 0.55 });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 6;
  controls.maxDistance = 90;
  controls.screenSpacePanning = false;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  let hoverId = null;
  let dimSet = null;
  let focusId = null;
  const items = []; // { con, cur, target, colour, pulse, mesh?/index }
  const byId = new Map();
  let mode = 'hex';
  let inst = null;
  let geoGroup = null;
  let extent = 30;
  const tmpM = new THREE.Matrix4();
  const tmpC = new THREE.Color();

  const base = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ color: 0x070b14, roughness: 0.95, envMapIntensity: 0.05 }));
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.02;
  scene.add(base);

  function buildHex() {
    mode = 'hex';
    const r = 0.5;
    const geo = new THREE.CylinderGeometry(r * 0.93, r * 0.93, 1, 6);
    geo.translate(0, 0.5, 0);
    inst = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05, envMapIntensity: 0.45 }), cons.length);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const pos = cons.map((c) => {
      const x = (c.hex.col + 0.5 * (c.hex.row % 2)) * SQRT3 * r;
      const z = c.hex.row * 1.5 * r;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      return [x, z];
    });
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    extent = Math.max(maxX - minX, maxZ - minZ);
    cons.forEach((c, i) => {
      const it = { con: c, index: i, x: pos[i][0] - cx, z: pos[i][1] - cz, cur: 0.1, target: 0.1, colour: new THREE.Color('#333') };
      items.push(it);
      byId.set(c.id, it);
    });
    scene.add(inst);
  }

  function buildGeo(gj) {
    mode = 'geo';
    geoGroup = new THREE.Group();
    const feats = gj.features || [];
    const all = [];
    const rings = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
    feats.forEach((f) => rings(f.geometry || {}).forEach((poly) => poly[0]?.forEach((p) => all.push(p))));
    if (!all.length) throw new Error('GeoJSON has no polygon features.');
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    all.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
    const lonlat = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90;
    const k = lonlat ? Math.cos(THREE.MathUtils.degToRad((minY + maxY) / 2)) : 1;
    const w = (maxX - minX) * k, h = maxY - minY;
    const scale = 30 / Math.max(w, h);
    const proj = ([x, y]) => new THREE.Vector2(((x - minX) * k - w / 2) * scale, (y - minY - h / 2) * scale);
    extent = 30;
    const byName = new Map(cons.map((c) => [c.name.toLowerCase(), c]));
    const byCid = new Map(cons.map((c) => [c.id, c]));
    feats.forEach((f) => {
      const p = f.properties || {};
      const con = byCid.get(p.id) || byCid.get(p.code) || byCid.get(p.constituency_id) || byName.get(String(p.name || '').toLowerCase());
      if (!con) return;
      const shapes = rings(f.geometry).map((poly) => {
        const s = new THREE.Shape(poly[0].map(proj));
        poly.slice(1).forEach((hole) => s.holes.push(new THREE.Path(hole.map(proj))));
        return s;
      });
      const geo = new THREE.ExtrudeGeometry(shapes, { depth: 1, bevelEnabled: false });
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.08 }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x05070c, transparent: true, opacity: 0.55 }));
      mesh.add(edges);
      mesh.userData.conId = con.id;
      geoGroup.add(mesh);
      const it = { con, mesh, cur: 0.1, target: 0.1, colour: new THREE.Color('#333') };
      items.push(it);
      byId.set(con.id, it);
    });
    scene.add(geoGroup);
    return items.length;
  }

  let matched = 0;
  if (opts.geojson) {
    try {
      matched = buildGeo(opts.geojson);
    } catch (err) {
      console.warn(err);
    }
  }
  if (!matched) buildHex();

  function refresh() {
    for (const it of items) {
      const s = styleOf(it.con);
      it.colour.set(s.colour);
      it.target = s.height;
      it.pulse = s.pulse || null;
    }
  }
  refresh();

  function frameCam(force) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max((extent * 0.5) / t / Math.min(1, camera.aspect), 12);
    if (force || !camera.userData.placed) {
      camera.position.set(0, d * 0.82, d * 0.6);
      controls.target.set(0, 0, 0);
      camera.userData.placed = true;
    }
    controls.update();
  }
  stage.onResize(() => frameCam(false));

  function onMove(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    pointer.clientX = e.clientX;
    pointer.clientY = e.clientY;
  }
  let downAt = null;
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('pointerleave', () => {
    pointer.set(9, 9);
    hoverId = null;
    opts.onHover?.(null);
  });
  renderer.domElement.addEventListener('pointerdown', (e) => (downAt = [e.clientX, e.clientY]));
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
    onMove(e);
    const id = pick();
    if (id) opts.onClick?.(byId.get(id).con);
  });

  function pick() {
    if (pointer.x > 2) return null;
    raycaster.setFromCamera(pointer, camera);
    if (mode === 'hex') {
      const hit = raycaster.intersectObject(inst, false)[0];
      return hit ? items[hit.instanceId].con.id : null;
    }
    const hit = raycaster.intersectObjects(geoGroup.children, false)[0];
    return hit ? hit.object.userData.conId : null;
  }

  let frame = 0;
  stage.onFrame((dt, time) => {
    controls.update();
    if (frame++ % 3 === 0) {
      const id = pick();
      if (id !== hoverId) {
        hoverId = id;
        opts.onHover?.(id ? byId.get(id).con : null, { x: pointer.clientX, y: pointer.clientY });
      } else if (id) opts.onHover?.(byId.get(id).con, { x: pointer.clientX, y: pointer.clientY }, true);
    }
    for (const it of items) {
      const dimmed = dimSet && !dimSet.has(it.con.id);
      const tgt = (dimmed ? 0.06 : it.target) + (it.con.id === hoverId || it.con.id === focusId ? 0.45 : 0);
      it.cur += (tgt - it.cur) * Math.min(1, dt * 5);
      tmpC.copy(it.colour);
      if (it.pulse) tmpC.lerp(new THREE.Color(it.pulse), (Math.sin(time * 4) + 1) * 0.3);
      if (dimmed) tmpC.multiplyScalar(0.25);
      if (it.con.id === hoverId) tmpC.lerp(new THREE.Color(1, 1, 1), 0.25);
      if (mode === 'hex') {
        tmpM.makeScale(1, Math.max(0.02, it.cur), 1).setPosition(it.x, 0, it.z);
        inst.setMatrixAt(it.index, tmpM);
        inst.setColorAt(it.index, tmpC);
      } else {
        it.mesh.scale.y = Math.max(0.02, it.cur * 1.4);
        it.mesh.material.color.copy(tmpC);
      }
    }
    if (mode === 'hex') {
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    }
  });

  return {
    stage,
    mode: () => mode,
    refresh,
    highlight(ids) {
      dimSet = ids ? new Set(ids) : null;
    },
    focus(id) {
      focusId = id;
      const it = byId.get(id);
      if (!it) return;
      const p = mode === 'hex' ? new THREE.Vector3(it.x, 0, it.z) : new THREE.Box3().setFromObject(it.mesh).getCenter(new THREE.Vector3()).setY(0);
      const from = controls.target.clone();
      const camFrom = camera.position.clone();
      const off = camFrom.clone().sub(from).setLength(16);
      stage.tween({
        dur: 1.2,
        ease: ease.inOutCubic,
        update: (t) => {
          controls.target.lerpVectors(from, p, t);
          camera.position.lerpVectors(camFrom, p.clone().add(off), t);
        },
      });
    },
    resetView() {
      focusId = null;
      frameCam(true);
    },
    dispose: () => {
      controls.dispose();
      stage.dispose();
    },
  };
}

// ---------------------------------------------------------------- DECLARATION
/** sr: calc.seatResult output; party(id) -> party; opts.title / opts.subtitle */
export async function declarationScene(container, sr, party, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 30, bloomStrength: 0.22, exposure: 0.92 });
  const { scene, camera } = stage;
  scene.background = col('#070a12');
  addStudioLights(scene, { key: 1.4, fill: 0.45 });
  const winner = party(sr.winnerParty);

  const badge = makeHexBadge({ colour: winner.colour, name: winner.short, value: 0, radius: 1.15, style: 'colour' });
  badge.position.set(-3.2, 0.15, 0);
  badge.scale.setScalar(0.001);
  scene.add(badge);
  const tag = textPlane(sr.outcome === 'GAIN' ? `${winner.short.toUpperCase()} GAIN` : `${winner.short.toUpperCase()} HOLD`, { height: 0.42, weight: 800, bg: winner.colour, padX: 0.3 });
  tag.position.set(-3.2, -1.5, 0.1);
  tag.material.opacity = 0;
  scene.add(tag);

  const rows = sr.ranked.slice(0, 5);
  const maxShare = Math.max(1, ...rows.map((r) => r.share));
  const L = 5.2;
  const bars = rows.map((c, i) => {
    const p = party(c.party);
    const y = 1.4 - i * 0.72;
    const g = new THREE.Group();
    g.position.set(-1.35, y, 0);
    const geo = new RoundedBoxGeometry(1, 0.34, 0.26, 3, 0.05);
    geo.translate(0.5, 0, 0);
    const box = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ color: col(p.colour), roughness: 0.38, clearcoat: 0.8, envMapIntensity: 0.4, emissive: col(p.colour), emissiveIntensity: i === 0 ? 0.18 : 0.04 }));
    box.scale.x = 0.0001;
    g.add(box);
    const nm = textPlane(`${c.name}`, { height: 0.24, weight: 700 });
    nm.position.set(nm.userData.width / 2 + 0.02, 0.33, 0.2);
    const pn = textPlane(c.party === 'IND' ? c.label || 'Independent' : p.name, { height: 0.17, weight: 500, family: SANS, color: '#b9c0cc' });
    pn.position.set(nm.userData.width + 0.16 + pn.userData.width / 2, 0.325, 0.2);
    const vv = textPlane(`${c.votes.toLocaleString('en-GB')}  ·  ${c.share.toFixed(1)}%`, { height: 0.24, weight: 700, color: '#ffffff' });
    vv.material.opacity = 0;
    g.add(nm, pn, vv);
    scene.add(g);
    return { g, box, vv, len: Math.max(0.05, (c.share / maxShare) * L) };
  });

  stage.onResize(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(11, 5.4 / (t * camera.aspect), 2.6 / t);
    camera.position.set(0.6, -0.2, d);
    camera.lookAt(0.6, -0.85, 0);
  });

  const ov = stage.overlay('dec-overlay');
  (async () => {
    await stage.tween({ dur: 1.0, ease: ease.outBack, update: (t) => { badge.scale.setScalar(Math.max(0.001, t)); badge.rotation.y = (1 - t) * Math.PI; } });
    countTo(stage, badge, sr.winnerParty ? sr.majority : 0, 1.4);
    badge.userData.setName('Majority');
    for (const [i, b] of bars.entries()) {
      stage.tween({
        dur: 1.1,
        delay: i * 0.18,
        ease: ease.outCubic,
        update: (t) => {
          b.box.scale.x = Math.max(0.0001, b.len * t);
          b.vv.position.set(b.len * t + 0.15 + b.vv.userData.width / 2, 0, 0.2);
          b.vv.material.opacity = t;
        },
      });
    }
    stage.tween({ dur: 0.5, delay: 1, update: (t) => (tag.material.opacity = t) });
  })();
  const t0 = stage.time;
  stage.onFrame((dt, time) => {
    badge.rotation.y = Math.sin((time - t0) * 0.7) * 0.12;
  });
  return { stage, overlay: ov, dispose: () => stage.dispose() };
}

// ---------------------------------------------------------------- VICTORY
export async function victoryScene(container, partyObj, value, opts = {}) {
  await fontsReady();
  const stage = createStage(container, { fov: 32, bloomStrength: 0.3, exposure: 0.92 });
  const { scene, camera } = stage;
  scene.background = col('#05070c');
  addStudioLights(scene, { key: 1.4, fill: 0.35 });
  const badge = makeHexBadge({ colour: partyObj.colour, name: partyObj.short, value: 0, radius: 1.6 });
  badge.position.y = 0.7;
  scene.add(badge);

  // confetti
  const N = 500;
  const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.08, 0.14), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.5, metalness: 0.3 }), N);
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push({ p: new THREE.Vector3((Math.random() - 0.5) * 14, 5 + Math.random() * 8, (Math.random() - 0.5) * 6), v: 0.6 + Math.random() * 1.2, r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), s: Math.random() * 3 });
    conf.setColorAt(i, new THREE.Color(i % 3 === 0 ? '#ffffff' : i % 3 === 1 ? partyObj.colour : '#ffd34d'));
  }
  scene.add(conf);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.02, 8, 120), new THREE.MeshBasicMaterial({ color: col(partyObj.colour), toneMapped: false }));
  ring.position.y = 0.7;
  ring.position.z = -0.4;
  scene.add(ring);

  stage.onResize(() => {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = Math.max(10, 3.4 / (t * camera.aspect), 3.4 / t);
    camera.position.set(0, 0.4, d);
    camera.lookAt(0, 0.1, 0);
  });
  const ov = stage.overlay('vic-overlay');
  badge.scale.setScalar(0.001);
  stage.tween({ dur: 1.4, ease: ease.outBack, update: (t) => { badge.scale.setScalar(Math.max(0.001, t)); badge.rotation.y = (1 - t) * Math.PI * 2; } });
  countTo(stage, badge, value, 1.8, 0.5);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  stage.onFrame((dt, time) => {
    badge.rotation.y = Math.sin(time * 0.6) * 0.15;
    ring.scale.setScalar(1 + Math.sin(time * 2) * 0.02);
    for (let i = 0; i < N; i++) {
      const c = parts[i];
      c.p.y -= c.v * dt;
      c.p.x += Math.sin(time + c.s) * dt * 0.3;
      if (c.p.y < -3) c.p.y = 6;
      c.r.x += dt * 2;
      c.r.y += dt * 1.3;
      m.compose(c.p, q.setFromEuler(c.r), one);
      conf.setMatrixAt(i, m);
    }
    conf.instanceMatrix.needsUpdate = true;
  });
  return { stage, overlay: ov, dispose: () => stage.dispose() };
}
