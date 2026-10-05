const at = (d: string) => new Date(`${d}T00:00:00Z`);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  at(d).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });

export const fmtConcertDate = (d: string) => fmt(d, { day: "numeric", month: "short", year: "numeric" });

export const fmtDay = (d: string) =>
  `${fmt(d, { weekday: "short" })} ${fmt(d, { day: "numeric", month: "short" })}`;

export function fmtRange(start: string, end: string): string {
  if (start === end) return fmtConcertDate(start);
  const [sy, sm] = start.split("-");
  const [ey, em] = end.split("-");
  if (sy !== ey) return `${fmtConcertDate(start)} – ${fmtConcertDate(end)}`;
  if (sm !== em) return `${fmt(start, { day: "numeric", month: "short" })} – ${fmtConcertDate(end)}`;
  return `${Number(start.slice(8))}–${fmtConcertDate(end)}`;
}
