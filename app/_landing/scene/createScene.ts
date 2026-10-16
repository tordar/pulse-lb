// app/_landing/scene/createScene.ts
import type * as T from "three";
import type { Prepared } from "@/lib/landing/derive";
import { buildPositions, livePosition, W } from "./positions";

export type SceneHandle = {
  setFilter(u: { uF: number; uA: number; uB: number }): void;
  rotate(dx: number, dy: number): void;
  setScroll(fraction: number): void;
  project(x: number, y: number, z: number): [number, number] | null;
  pick(sx: number, sy: number, radius: number, accept?: (i: number) => boolean): number;
  pointAt(i: number): [number, number, number];
  /** A listen that arrived after the payload: added hidden, shown by light(). Returns -1 when full. */
  addLive(day: number, minute: number, artist: number): number;
  /** Show a live point; fresh ones glow in the accent and fade to white. */
  light(slot: number, fresh: boolean): void;
  livePointAt(slot: number): [number, number, number];
  onFrame(cb: () => void): () => void;
  destroy(): void;
};

const VERT = /* glsl */ `
  attribute float aDay, aMin, aArt, aRnd, aBorn;
  uniform float uTime, uNow, uMotion, uF, uA, uB, uBaseWd, uSize, uDpr, uDim;
  uniform vec3 uAccent;
  varying vec3 vCol; varying float vA;
  void main() {
    vec3 p = position;
    float hl = 1.0;
    if (uF > 0.5 && uF < 1.5) hl = step(abs(mod(aDay + uBaseWd, 7.0) - uA), 0.1) * step(abs(floor(aMin / 60.0) - uB), 0.1);
    else if (uF > 1.5 && uF < 2.5) hl = step(uA, aDay) * step(aDay, uB - 0.5);
    else if (uF > 2.5) hl = step(abs(aArt - uA), 0.1);
    bool filtered = uF > 0.5;
    // A live point is hidden until lit (aBorn = HIDDEN), then glows and fades to white over 8s.
    float fresh = filtered ? 0.0 : clamp(1.0 - (uNow - aBorn) / 8.0, 0.0, 1.0);
    vCol = mix(vec3(0.92), uAccent, filtered ? hl : fresh);
    vA = (filtered ? (hl > 0.5 ? 0.9 : 0.035) : mix(0.30, 0.9, fresh)) * uDim * (1.0 - step(1e8, aBorn));
    // Wind: every point sways around its true spot; waves travel along the time axis.
    float t = uTime;
    float ph = p.x * 1.4 - t * 0.32;
    float sway = sin(ph + aRnd * 0.9) * 0.5 + sin(p.x * 3.1 + p.z * 2.3 - t * 0.51 + aRnd * 2.0) * 0.35 + sin(p.z * 5.0 + t * 0.23) * 0.15;
    float lift = 0.25 + clamp(p.y, 0.0, 1.5);
    p.x += uMotion * (sway * 0.025 + sin(t * 0.6 + aRnd * 6.283) * 0.006);
    p.y += uMotion * sin(ph * 0.8 + p.z * 1.7 + aRnd * 0.5) * 0.028 * lift;
    p.z += uMotion * cos(ph * 0.6 + aRnd * 1.3) * 0.03;
    float crest = smoothstep(0.55, 1.0, sin(p.x * 0.9 - t * 0.42)) * 0.9 + smoothstep(0.8, 1.0, sin(p.x * 2.3 + p.z * 1.1 - t * 0.7)) * 0.5;
    vA *= 1.0 + crest * uMotion;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * uDpr * (filtered && hl > 0.5 ? 1.6 : 1.0 + fresh * 3.0) * clamp(4.0 / -mv.z, 0.6, 2.2);
    gl_Position = projectionMatrix * mv;
  }`;

const FRAG = /* glsl */ `
  varying vec3 vCol; varying float vA;
  void main() { vec2 c = gl_PointCoord - 0.5; if (dot(c, c) > 0.25) discard; gl_FragColor = vec4(vCol * vA, 1.0); }`;

const LIVE_MAX = 2048, HIDDEN = 1e9, OLD = -1e6;

export async function createScene(canvas: HTMLCanvasElement, p: Prepared, opts: { reducedMotion: boolean }): Promise<SceneHandle> {
  const THREE = await import("three");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: "high-performance" }); // throws without WebGL
  renderer.setClearColor(0x050505);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  const n = p.day.length, pos = buildPositions(p), rnd = new Float32Array(n);
  for (let i = 0, s = 1; i < n; i++) { s = (s * 16807) % 2147483647; rnd[i] = s / 2147483647; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aDay", new THREE.BufferAttribute(Float32Array.from(p.day), 1));
  geo.setAttribute("aMin", new THREE.BufferAttribute(Float32Array.from(p.minute), 1));
  geo.setAttribute("aArt", new THREE.BufferAttribute(Float32Array.from(p.payload.artist), 1));
  geo.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
  geo.setAttribute("aBorn", new THREE.BufferAttribute(new Float32Array(n).fill(OLD), 1));
  const U = {
    uTime: { value: 0 }, uNow: { value: 0 }, uMotion: { value: opts.reducedMotion ? 0 : 1 },
    uF: { value: 0 }, uA: { value: 0 }, uB: { value: 0 }, uBaseWd: { value: p.baseWeekday },
    uSize: { value: 1.6 }, uDpr: { value: 1 }, uDim: { value: 1 }, uAccent: { value: new THREE.Color(0xff4a2e) },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // Listens that arrive while the page is open: a fixed-size buffer drawn up to `live`.
  const liveGeo = new THREE.BufferGeometry(), lp = new Float32Array(LIVE_MAX * 3);
  const liveAttr = (name: string, a: Float32Array) => { const b = new THREE.BufferAttribute(a, a === lp ? 3 : 1); liveGeo.setAttribute(name, b); return b; };
  const lPos = liveAttr("position", lp), lDay = liveAttr("aDay", new Float32Array(LIVE_MAX)), lMin = liveAttr("aMin", new Float32Array(LIVE_MAX));
  const lArt = liveAttr("aArt", new Float32Array(LIVE_MAX)), lBorn = liveAttr("aBorn", new Float32Array(LIVE_MAX).fill(HIDDEN));
  liveAttr("aRnd", Float32Array.from({ length: LIVE_MAX }, (_, i) => rnd[i % Math.max(1, n)] ?? 0.5));
  let live = 0;
  liveGeo.setDrawRange(0, 0);
  const livePoints = new THREE.Points(liveGeo, mat);
  livePoints.frustumCulled = false;
  scene.add(livePoints);
  const floor = new THREE.GridHelper(W * 1.1, 32, 0x2a2a2a, 0x1a1a1a);
  floor.scale.z = 0.5;
  (floor.material as T.Material).transparent = true;
  (floor.material as T.Material).opacity = 0.12;
  floor.renderOrder = -1;
  scene.add(floor);

  let userYaw = 0, userPitch = 0, scroll = 0, raf = 0, last = performance.now(), first = true;
  const cam = { yaw: 0, pitch: 0, dist: 8, ty: 0 };
  const frameCbs = new Set<() => void>();

  const portrait = () => canvas.clientHeight > canvas.clientWidth;
  function target() {
    const t = Math.tan((camera.fov / 2) * Math.PI / 180), a = camera.aspect;
    const fit = (bw: number, bh: number) => Math.max(bh / 2 / t, bw / 2 / (t * a));
    const clampP = (x: number) => Math.max(-0.2, Math.min(1.2, x));
    return portrait()
      ? { yaw: 1.0 + userYaw, pitch: clampP(0.62 + userPitch), dist: fit(2.8, 2.8) * 0.72, ty: 0.42 }
      : { yaw: -0.25 + userYaw, pitch: clampP(0.5 + userPitch), dist: fit(W + 0.3, 2.4), ty: 0.3 };
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    // iOS can report a 0×0 canvas mid-transition; sizing to it would leave a NaN camera aspect.
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); U.uDpr.value = dpr;
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, now - last); last = now;
    if (document.hidden) return;
    U.uTime.value += (dt / 1000) * U.uMotion.value;
    U.uNow.value = now / 1000;
    const t = target(), k = first || opts.reducedMotion ? 1 : 0.08; first = false;
    cam.yaw += (t.yaw - cam.yaw) * k; cam.pitch += (t.pitch - cam.pitch) * k; cam.dist += (t.dist - cam.dist) * k; cam.ty += (t.ty - cam.ty) * k;
    U.uDim.value = 1 - scroll * 0.45;
    camera.position.set(Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, cam.ty + Math.sin(cam.pitch) * cam.dist, Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
    camera.lookAt(0, cam.ty - scroll * 0.3, 0);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    frameCbs.forEach((cb) => cb());
  }
  raf = requestAnimationFrame(frame);

  const m = new THREE.Matrix4(), v = new THREE.Vector4();
  return {
    setFilter(u) { U.uF.value = u.uF; U.uA.value = u.uA; U.uB.value = u.uB; },
    rotate(dx, dy) { userYaw -= dx * 0.005; userPitch += dy * 0.003; },
    setScroll(f) { scroll = Math.max(0, Math.min(1, f)); },
    project(x, y, z) {
      v.set(x, y, z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
      if (!(v.w > 1e-6) || !canvas.clientWidth || !canvas.clientHeight) return null;
      return [(v.x / v.w + 1) * canvas.clientWidth / 2, (1 - v.y / v.w) * canvas.clientHeight / 2];
    },
    pick(sx, sy, radius, accept) {
      m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const e = m.elements, hw = canvas.clientWidth / 2, hh = canvas.clientHeight / 2;
      let best = -1, bd = radius * radius, bz = Infinity;
      for (let i = 0; i < n; i++) {
        if (accept && !accept(i)) continue;
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const cw = e[3] * x + e[7] * y + e[11] * z + e[15]; if (cw <= 0) continue;
        const px = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / cw + 1) * hw;
        const py = (1 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw) * hh;
        const d = (px - sx) ** 2 + (py - sy) ** 2;
        if (d < bd || (d === bd && cw < bz)) { bd = d; best = i; bz = cw; }
      }
      return best;
    },
    pointAt(i) { return [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; },
    addLive(day, minute, artist) {
      if (live >= LIVE_MAX) return -1;
      const i = live++;
      lp.set(livePosition(p, day, minute), i * 3);
      (lDay.array as Float32Array)[i] = day; (lMin.array as Float32Array)[i] = minute; (lArt.array as Float32Array)[i] = artist;
      for (const a of [lPos, lDay, lMin, lArt]) a.needsUpdate = true;
      liveGeo.setDrawRange(0, live);
      return i;
    },
    light(slot, fresh) {
      if (slot < 0) return;
      (lBorn.array as Float32Array)[slot] = fresh ? performance.now() / 1000 : OLD;
      lBorn.needsUpdate = true;
    },
    livePointAt(slot) { return [lp[slot * 3], lp[slot * 3 + 1], lp[slot * 3 + 2]]; },
    onFrame(cb) { frameCbs.add(cb); return () => frameCbs.delete(cb); },
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      geo.dispose(); liveGeo.dispose(); mat.dispose(); floor.geometry.dispose(); (floor.material as T.Material).dispose();
      renderer.dispose();
    },
  };
}
