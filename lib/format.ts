export function fmtHours(h: number): string {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 100) {
    const hr = Math.floor(h);
    const m = Math.round((h - hr) * 60);
    return m ? `${hr}h ${m}m` : `${hr}h`;
  }
  return `${Math.round(h).toLocaleString()}h`;
}

export function fmtListeningTime(ms: number): string {
  return fmtHours(ms / 1000 / 3600);
}
