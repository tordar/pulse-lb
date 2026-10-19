"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { year: number; plays: number; hours: number };

// Missing years become zero bars so the axis reads as a continuous timeline.
function fillGaps(data: Point[]): Point[] {
  if (!data.length) return data;
  const byYear = new Map(data.map((d) => [d.year, d]));
  const out: Point[] = [];
  for (let y = data[0].year; y <= data[data.length - 1].year; y++) {
    out.push(byYear.get(y) ?? { year: y, plays: 0, hours: 0 });
  }
  return out;
}

function ReleaseTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        fontSize: 12,
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-card)",
        color: "var(--color-foreground)",
        padding: "8px 10px",
      }}
    >
      <div style={{ fontWeight: 600 }}>Released {p.year}</div>
      <div>
        {Math.round(p.hours).toLocaleString()}h · {p.plays.toLocaleString()} plays
      </div>
    </div>
  );
}

export function ReleaseYearChart({
  data,
  height = 220,
}: {
  data: Point[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={fillGaps(data)} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          minTickGap={16}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v) => `${v}h`}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ReleaseTooltip />} />
        <Bar dataKey="hours" fill="var(--color-primary)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
