export function fmtHours(h: number): string {
  if (!isFinite(h) || h <= 0) return "—";
  if (h < 100) {
    // Round to whole minutes FIRST, then split into h/m. Deciding the unit or
    // splitting off the hours before rounding lets the remainder round up to a
    // full 60 and print nonsense — "1h 60m" for 1.9997h, "60m" for 0.9999h.
    const totalMin = Math.round(h * 60);
    const hr = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (hr === 0) return `${m}m`;
    return m ? `${hr}h ${m}m` : `${hr}h`;
  }
  return `${Math.round(h).toLocaleString()}h`;
}

export function fmtListeningTime(ms: number): string {
  return fmtHours(ms / 1000 / 3600);
}
