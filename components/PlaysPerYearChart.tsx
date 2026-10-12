"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function PlaysPerYearChart({
  data,
  metric = "plays",
}: {
  data: { year: number; plays: number; hours: number }[];
  metric?: "plays" | "hours";
}) {
  const key = metric;
  // Years with no plays are as telling as the ones with plays, so fill every
  // year from the first play through this year with a zero bar.
  const byYear = new Map(data.map((d) => [d.year, d]));
  const first = Math.min(...byYear.keys());
  const last = Math.max(new Date().getFullYear(), ...byYear.keys());
  const filled = data.length
    ? Array.from({ length: last - first + 1 }, (_, i) => {
        const year = first + i;
        return byYear.get(year) ?? { year, plays: 0, hours: 0 };
      })
    : data;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={filled} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
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
          width={36}
          allowDecimals={metric === "hours"}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.04)" }}
          contentStyle={{
            fontSize: 12,
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-card)",
            color: "var(--color-foreground)",
          }}
          formatter={(v) => [metric === "hours" ? `${v} h` : `${v} plays`, metric]}
        />
        <Bar dataKey={key} fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
