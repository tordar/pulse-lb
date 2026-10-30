import { fmtDate } from "@/lib/format";

const weekday = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });

export const fmtConcertDate = (d: string) => fmtDate(d);

/** A festival day: weekday plus DD/MM, or the full date when `withYear`. */
export const fmtDay = (d: string, withYear = false) =>
  `${weekday(d)} ${withYear ? fmtDate(d) : `${d.slice(8, 10)}/${d.slice(5, 7)}`}`;

export function fmtRange(start: string, end: string): string {
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}
