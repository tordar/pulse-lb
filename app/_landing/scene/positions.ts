// app/_landing/scene/positions.ts
import { heightAt, type Prepared } from "@/lib/landing/derive";

/** World length of the date axis. Hour axis spans 2, height up to 1.25. */
export const W = 4;
const HEIGHT = 1.25;

// Deterministic per-point jitter in [-0.5, 0.5) so points don't sit on grid lines.
const jit = (i: number, k: number) => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };

export function buildPositions(p: Prepared): Float32Array {
  const n = p.day.length, out = new Float32Array(n * 3), span = p.maxDay + 1;
  for (let i = 0; i < n; i++) {
    const u = (p.day[i] + 0.5 + jit(i, 6) * 3) / span, v = (p.minute[i] + jit(i, 7) * 20) / 1440;
    out[i * 3] = (u - 0.5) * W;
    out[i * 3 + 1] = heightAt(p.hf, u, v) * HEIGHT + jit(i, 8) * 0.012;
    out[i * 3 + 2] = (v - 0.5) * 2;
  }
  return out;
}

/** A listen that arrived after the payload, sitting just on the surface (the heightfield isn't rebuilt). */
export function livePosition(p: Prepared, day: number, minute: number): [number, number, number] {
  const u = (day + 0.5) / (p.maxDay + 1), v = minute / 1440;
  return [(u - 0.5) * W, heightAt(p.hf, Math.min(1, u), v) * HEIGHT + 0.01, (v - 0.5) * 2];
}

/** Highest point of the surface along the hour axis at a given day. */
export function topOf(p: Prepared, day: number): [number, number, number] {
  const u = (day + 0.5) / (p.maxDay + 1);
  let bv = 0, bh = -1;
  for (let k = 0; k < 48; k++) { const v = (k + 0.5) / 48, h = heightAt(p.hf, u, v); if (h > bh) { bh = h; bv = v; } }
  return [(u - 0.5) * W, bh * HEIGHT, (bv - 0.5) * 2];
}
