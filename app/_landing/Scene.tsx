// app/_landing/Scene.tsx
"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { callouts, dayStr, filterUniforms, matches, minStr, type Filter, type Prepared } from "@/lib/landing/derive";
import type { ListenAt } from "@/lib/landing/query";
import type { SceneHandle } from "./scene/createScene";
import { topOf } from "./scene/positions";
import { fetchListen } from "./listen";
import s from "./landing.module.css";

type Readout = { i: number; x: number; y: number; pinned: boolean; listen: ListenAt | null; f: Filter | null };

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
  useLayoutEffect(() => { readoutRef.current = readout?.f === filter ? readout : null; });
  const facts = useMemo(() => (data ? callouts(data) : []), [data]);

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
    return h.onFrame(() => {
      const sc = window.scrollY / window.innerHeight;
      wrap.style.opacity = String(Math.max(0, 1 - sc * 3) * (filterRef.current ? 0 : 1));
      const portrait = window.innerHeight > window.innerWidth, topMin = portrait ? 96 : 110;
      anchors.forEach((a, k) => {
        const p = h.project(a[0], a[1], a[2]), el = labels[k];
        if (!p || !el) return;
        const [ax, ay] = p, w = el.offsetWidth, ht = el.offsetHeight;
        const lx = Math.min(window.innerWidth - w - 12, Math.max(12, ax - 6)), ly = Math.max(topMin, ay - (OFF[k] ?? 60) - ht);
        el.style.transform = `translate(${lx}px, ${ly}px)`;
        const bx = Math.min(Math.max(ax, lx), lx + w);
        lines[k].setAttribute("x1", String(bx)); lines[k].setAttribute("y1", String(ly + ht + 3));
        lines[k].setAttribute("x2", String(ax)); lines[k].setAttribute("y2", String(ay - 3));
        dots[k].setAttribute("cx", String(ax)); dots[k].setAttribute("cy", String(ay));
      });
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
    let hoverTimer = 0;
    const accept = (i: number) => !filterRef.current || matches(filterRef.current, data, i);
    const show = (i: number, x: number, y: number, pinned: boolean) => {
      setReadout({ i, x, y, pinned, listen: null, f: filterRef.current });
      fetchListen(data.payload.ts[i]).then((listen) =>
        setReadout((cur) => (cur && cur.i === i ? { ...cur, listen } : cur)));
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
      window.clearTimeout(hoverTimer);
      if (window.scrollY > 8 || isUi(e.target) || !(e.target instanceof Node && hero.contains(e.target))) {
        setReadout(null);
        return;
      }
      hoverTimer = window.setTimeout(() => {
        const i = h.pick(e.clientX, e.clientY, 12, accept);
        if (i < 0) { setReadout(null); return; }
        const q = h.project(...h.pointAt(i)); if (q) show(i, q[0], q[1], false);
      }, 150);
    };
    const up = (e: PointerEvent) => {
      const h = handleRef.current;
      if (!drag || e.pointerId !== drag.id || !h) return;
      const click = !drag.moved; drag = null;
      if (!click) return;
      const i = h.pick(e.clientX, e.clientY, e.pointerType === "touch" ? 28 : 14, accept);
      const q = i >= 0 ? h.project(...h.pointAt(i)) : null;
      if (q && i !== readoutRef.current?.i) show(i, q[0], q[1], true); else setReadout(null);
    };
    const cancel = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved && hero.hasPointerCapture(e.pointerId)) hero.releasePointerCapture(e.pointerId);
      drag = null;
    };
    const leave = () => { window.clearTimeout(hoverTimer); if (!readoutRef.current?.pinned) setReadout(null); };
    hero.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    hero.addEventListener("pointerleave", leave);
    return () => {
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
              className={`${s.readout} ${r.pinned ? s.pinned : ""}`}
              style={{ left: Math.min(window.innerWidth - 290, Math.max(8, r.x + 14)), top: r.y + 14 + 90 > window.innerHeight ? r.y - 104 : r.y + 14 }}
            >
              <div className={s.dim}>{dayStr(data.baseMs, data.day[r.i])} · {minStr(data.minute[r.i])}</div>
              <div><b>{r.listen?.track ?? "…"}</b></div>
              <div>{r.listen?.artist ?? data.payload.header.artists[data.payload.artist[r.i]] ?? ""}</div>
              {r.pinned && r.listen?.recordingMbid && (
                <a href={`/u/${encodeURIComponent(user)}/songs/${r.listen.recordingMbid}`}>→ song page</a>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
