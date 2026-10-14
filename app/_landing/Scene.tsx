// app/_landing/Scene.tsx
"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { callouts, dayStr, filterUniforms, matches, minStr, type Filter, type Prepared } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import type { SceneHandle } from "./scene/createScene";
import { topOf } from "./scene/positions";
import { fetchListen } from "./listen";
import s from "./landing.module.css";

// x/y: the point on screen (crosshair). px/py: where the pointer was (the box opens there).
type Readout = { i: number; x: number; y: number; px: number; py: number; pinned: boolean; listen: ListenAt | null; f: Filter | null };

export function Scene({ data, error, user, filter, children }: {
  data: Prepared | null; error: boolean; user: string; filter: Filter | null; children: ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const calloutRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const filterRef = useRef<Filter | null>(filter);
  const [status, setStatus] = useState<"idle" | "ready" | "nogl">("idle");
  const [readout, setReadout] = useState<Readout | null>(null);
  const readoutRef = useRef<Readout | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { readoutRef.current = readout?.f === filter ? readout : null; });
  const facts = useMemo(() => (data ? callouts(data) : []), [data]);

  // Open the box beside the pointer, flipping left/up and clamping so it never leaves the screen.
  useLayoutEffect(() => {
    const box = boxRef.current, hero = heroRef.current;
    if (!box || !hero || !readout) return;
    const vw = window.innerWidth, vh = window.innerHeight, w = box.offsetWidth, h = box.offsetHeight, gap = 12, m = 8;
    let x = readout.px + gap, y = readout.py + gap;
    if (x + w > vw - m) x = readout.px - gap - w;
    if (y + h > vh - m) y = readout.py - gap - h;
    x = Math.max(m, Math.min(vw - m - w, x));
    y = Math.max(m, Math.min(vh - m - h, y));
    const top = hero.getBoundingClientRect().top;
    box.style.left = `${x}px`;
    box.style.top = `${y - top}px`;
  }, [readout]);

  // Mount the scene once data is in.
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    let handle: SceneHandle | null = null, dead = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    import("./scene/createScene")
      .then(({ createScene }) => createScene(canvasRef.current!, data, { reducedMotion: reduced }))
      .then((h) => { if (dead) { h.destroy(); return; } handle = handleRef.current = h; h.setFilter(filterUniforms(filterRef.current)); setStatus("ready"); })
      .catch(() => { if (!dead) setStatus("nogl"); });
    return () => { dead = true; handle?.destroy(); handleRef.current = null; };
  }, [data]);

  // Instruments → shader.
  useEffect(() => {
    filterRef.current = filter;
    handleRef.current?.setFilter(filterUniforms(filter));
  }, [filter]);

  // Scroll dims the scene and fades callouts.
  useEffect(() => {
    const onScroll = () => handleRef.current?.setScroll(window.scrollY / window.innerHeight);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Callouts + readout follow the camera every frame.
  useEffect(() => {
    const h = handleRef.current, wrap = calloutRef.current;
    if (status !== "ready" || !h || !wrap || !data) return;
    const anchors = facts.map((f) => (f.index !== undefined ? h.pointAt(f.index) : topOf(data, f.day)));
    const labels = [...wrap.querySelectorAll<HTMLElement>("[data-callout]")];
    const lines = [...wrap.querySelectorAll<SVGLineElement>("line")];
    const dots = [...wrap.querySelectorAll<SVGCircleElement>("circle")];
    const OFF = [70, 110, 50];
    // Label sizes only change with the viewport; reading them every frame forced a layout per frame.
    let sizes: [number, number][] = [], sizedFor = "";
    let lastKey = "";
    return h.onFrame(() => {
      const sc = window.scrollY / window.innerHeight;
      const opacity = String(Math.max(0, 1 - sc * 3) * (filterRef.current ? 0 : 1));
      if (wrap.style.opacity !== opacity) wrap.style.opacity = opacity;
      const viewport = `${window.innerWidth}x${window.innerHeight}`;
      if (sizedFor !== viewport) { sizes = labels.map((el) => [el.offsetWidth, el.offsetHeight]); sizedFor = viewport; }
      const projected = anchors.map((a) => h.project(a[0], a[1], a[2]));
      // The camera is still most of the time: skip all DOM writes when nothing moved.
      const key = viewport + projected.map((p) => (p ? `${Math.round(p[0])},${Math.round(p[1])}` : "-")).join("|");
      if (key !== lastKey) {
        lastKey = key;
        const portrait = window.innerHeight > window.innerWidth, topMin = portrait ? 96 : 110;
        const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
        anchors.forEach((_, k) => {
          const p = projected[k], el = labels[k];
          if (!el) return;
          // Hide a callout whose anchor isn't on screen instead of pinning it to a corner.
          const visible = !!p && Number.isFinite(p[0]) && Number.isFinite(p[1])
            && p[0] >= -24 && p[0] <= window.innerWidth + 24 && p[1] >= topMin && p[1] <= window.innerHeight;
          for (const node of [el, lines[k], dots[k]]) node.style.visibility = visible ? "" : "hidden";
          if (!visible) return;
          const [ax, ay] = p, [w, ht] = sizes[k];
          const lx = Math.min(window.innerWidth - w - 12, Math.max(12, ax - 6));
          let ly = Math.max(topMin, ay - (OFF[k] ?? 60) - ht);
          // Push down past any label already placed in the same horizontal band.
          for (const b of placed) if (lx < b.x1 && lx + w > b.x0 && ly < b.y1 && ly + ht > b.y0) ly = b.y1 + 6;
          placed.push({ x0: lx, x1: lx + w, y0: ly, y1: ly + ht });
          el.style.transform = `translate(${lx}px, ${ly}px)`;
          const bx = Math.min(Math.max(ax, lx), lx + w);
          lines[k].setAttribute("x1", String(bx)); lines[k].setAttribute("y1", String(ly + ht + 3));
          lines[k].setAttribute("x2", String(ax)); lines[k].setAttribute("y2", String(ay - 3));
          dots[k].setAttribute("cx", String(ax)); dots[k].setAttribute("cy", String(ay));
        });
      }
      const r = readoutRef.current;
      if (r) {
        const q = h.project(...h.pointAt(r.i));
        if (q && (Math.abs(q[0] - r.x) > 0.5 || Math.abs(q[1] - r.y) > 0.5)) setReadout({ ...r, x: q[0], y: q[1] });
      }
    });
  }, [status, facts, data]);

  // Pointer: hover (mouse) after 150ms rest, tap pins, desktop drag rotates, touch drags scroll.
  useEffect(() => {
    const hero = heroRef.current;
    if (status !== "ready" || !hero || !data) return;
    let drag: { x: number; y: number; moved: boolean; id: number } | null = null;
    let hoverTimer = 0, hoverFrame = 0, hoverAt: { x: number; y: number } | null = null;
    const accept = (i: number) => !filterRef.current || matches(filterRef.current, data, i);
    // The crosshair and date/artist show at once; the track name (a server round trip) follows
    // once the pointer has rested, so sweeping the cursor never queues dozens of lookups.
    const show = (i: number, x: number, y: number, px: number, py: number, pinned: boolean, fetchDelay = 0) => {
      if (readoutRef.current?.i === i && readoutRef.current.pinned === pinned) return;
      setReadout({ i, x, y, px, py, pinned, listen: null, f: filterRef.current });
      const load = () => fetchListen(data.payload.ts[i]).then((listen) =>
        setReadout((cur) => (cur && cur.i === i ? { ...cur, listen } : cur)));
      window.clearTimeout(hoverTimer);
      // A tap fetches right away: on touch, pointerleave follows pointerup and clears hoverTimer.
      if (fetchDelay) hoverTimer = window.setTimeout(load, fetchDelay); else load();
    };
    const hoverPick = () => {
      hoverFrame = 0;
      const h = handleRef.current, at = hoverAt;
      if (!h || !at || readoutRef.current?.pinned) return;
      const i = h.pick(at.x, at.y, 12, accept);
      if (i < 0) { window.clearTimeout(hoverTimer); setReadout(null); return; }
      const q = h.project(...h.pointAt(i)); if (q) show(i, q[0], q[1], at.x, at.y, false, 120);
    };
    const isUi = (t: EventTarget | null) => t instanceof Element && !!t.closest("a,button");
    const down = (e: PointerEvent) => { if (!isUi(e.target)) drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; };
    const move = (e: PointerEvent) => {
      const h = handleRef.current; if (!h) return;
      if (drag && e.pointerId === drag.id) {
        if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
          if (e.pointerType === "touch") { drag = null; return; } // phones: drags scroll the page
          drag.moved = true; hero.setPointerCapture(e.pointerId); setReadout(null);
        }
        if (drag?.moved) { h.rotate(e.movementX, e.movementY); return; }
      }
      if (e.pointerType !== "mouse" || readoutRef.current?.pinned) return;
      if (window.scrollY > 8 || isUi(e.target) || !(e.target instanceof Node && hero.contains(e.target))) {
        hoverAt = null; window.clearTimeout(hoverTimer); setReadout(null);
        return;
      }
      // At most one pick per frame, however fast the pointer events arrive.
      hoverAt = { x: e.clientX, y: e.clientY };
      if (!hoverFrame) hoverFrame = requestAnimationFrame(hoverPick);
    };
    const up = (e: PointerEvent) => {
      const h = handleRef.current;
      if (twoFinger) { drag = null; return; }
      if (!drag || e.pointerId !== drag.id || !h) return;
      const click = !drag.moved; drag = null;
      if (!click) return;
      const i = h.pick(e.clientX, e.clientY, e.pointerType === "touch" ? 28 : 14, accept);
      const q = i >= 0 ? h.project(...h.pointAt(i)) : null;
      const cur = readoutRef.current;
      if (q && !(cur?.pinned && cur.i === i)) show(i, q[0], q[1], e.clientX, e.clientY, true); else setReadout(null);
    };
    const cancel = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved && hero.hasPointerCapture(e.pointerId)) hero.releasePointerCapture(e.pointerId);
      drag = null;
    };
    // Phones: one finger scrolls the page as usual; two fingers turn the mountain.
    let twoFinger = false, mid: { x: number; y: number } | null = null;
    const midOf = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const touchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      twoFinger = true; drag = null; mid = midOf(e.touches);
      window.clearTimeout(hoverTimer); setReadout(null);
    };
    const touchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !mid) return;
      e.preventDefault(); // keep the browser from scrolling or zooming during the turn
      const m = midOf(e.touches);
      handleRef.current?.rotate((m.x - mid.x) * 1.4, (m.y - mid.y) * 1.4);
      mid = m;
    };
    const touchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) mid = null;
      if (e.touches.length === 0) twoFinger = false;
    };
    const leave = () => { hoverAt = null; window.clearTimeout(hoverTimer); if (!readoutRef.current?.pinned) setReadout(null); };
    hero.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    hero.addEventListener("pointerleave", leave);
    hero.addEventListener("touchstart", touchStart, { passive: true });
    hero.addEventListener("touchmove", touchMove, { passive: false });
    hero.addEventListener("touchend", touchEnd);
    hero.addEventListener("touchcancel", touchEnd);
    return () => {
      hero.removeEventListener("touchstart", touchStart);
      hero.removeEventListener("touchmove", touchMove);
      hero.removeEventListener("touchend", touchEnd);
      hero.removeEventListener("touchcancel", touchEnd);
      cancelAnimationFrame(hoverFrame);
      window.clearTimeout(hoverTimer);
      hero.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      hero.removeEventListener("pointerleave", leave);
    };
  }, [status, data]);

  const r = readout?.f === filter ? readout : null;
  return (
    <>
      <canvas ref={canvasRef} className={s.canvas} aria-hidden="true" />
      <div ref={calloutRef} className={s.callouts} aria-hidden="true" style={{ opacity: 0 }}>
        <svg>{facts.map((f) => <g key={f.key}><line /><circle r={3} /></g>)}</svg>
        {facts.map((f) => (
          <div key={f.key} data-callout className={s.callout}><span className={s.dim}>{f.label}</span><b>{f.value}</b></div>
        ))}
      </div>
      <div ref={heroRef} className={s.hero}>
        {children}
        {status === "nogl" && <p className={s.msg}>WebGL unavailable</p>}
        {error && <p className={s.msg}>Data unavailable</p>}
        {r && data && (
          <>
            <div className={s.cross} style={{ left: r.x, top: r.y }} />
            <div
              ref={boxRef}
              className={`${s.readout} ${r.pinned ? s.pinned : ""}`}
              style={{ left: r.px + 12, top: r.py + 12 }}
            >
              <div className={s.dim}>{dayStr(data.baseMs, data.day[r.i])} · {minStr(data.minute[r.i])}</div>
              <div><b>
                {r.listen?.recordingMbid
                  ? <a href={`/u/${encodeURIComponent(user)}/songs/${r.listen.recordingMbid}`}>{r.listen.track}</a>
                  : r.listen?.track ?? "…"}
              </b></div>
              <div>
                {r.listen?.artistMbid
                  ? <a href={`/u/${encodeURIComponent(user)}/artists/${r.listen.artistMbid}`}>{r.listen.artist}</a>
                  : r.listen?.artist ?? data.payload.header.artists[data.payload.artist[r.i]] ?? ""}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
