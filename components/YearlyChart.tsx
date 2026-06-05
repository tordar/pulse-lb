"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type YearPoint = { year: number; plays: number; hours: number };
type EnrichedPoint = YearPoint & {
  projected: number | null;
  projectedHours: number | null;
  remainder: number;
};

// Pace-based projection for the current year: plays so far ÷ days elapsed ×
// 365, rendered as a dimmed extension stacked on the actual bar. Skipped in
// the first two weeks of January, where the extrapolation is mostly noise.
function enrich(data: YearPoint[]): EnrichedPoint[] {
  const now = new Date();
  const year = now.getUTCFullYear();
  const dayOfYear =
    Math.floor((now.getTime() - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return data.map((d) => {
    if (d.year !== year || dayOfYear < 14 || d.plays === 0) {
      return { ...d, projected: null, projectedHours: null, remainder: 0 };
    }
    const projected = Math.round((d.plays / dayOfYear) * 365);
    const projectedHours = Math.round((d.hours / dayOfYear) * 365);
    return { ...d, projected, projectedHours, remainder: Math.max(0, projected - d.plays) };
  });
}

function YearTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: EnrichedPoint }[];
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
      <div style={{ fontWeight: 600 }}>{p.year}</div>
      <div>
        {p.plays.toLocaleString()} plays · {Math.round(p.hours).toLocaleString()}h
      </div>
      {p.projected != null && (
        <div style={{ color: "var(--color-muted-foreground)", marginTop: 2 }}>
          ≈ {p.projected.toLocaleString()} plays · {(p.projectedHours ?? 0).toLocaleString()}h
          projected by year end
        </div>
      )}
    </div>
  );
}

export function YearlyChart({
  data,
  height = 220,
}: {
  data: YearPoint[];
  height?: number;
}) {
  const enriched = enrich(data);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={enriched} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<YearTooltip />} />
        <Bar dataKey="plays" stackId="y" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
        <Bar
          dataKey="remainder"
          stackId="y"
          fill="var(--color-primary)"
          fillOpacity={0.25}
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
