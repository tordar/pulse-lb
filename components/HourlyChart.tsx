"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function HourlyChart({
  data,
  height = 220,
}: {
  data: { hour: number; plays: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="hour"
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: "#e5e7eb" }}
          tickFormatter={(h) => (h % 3 === 0 ? `${h}:00` : "")}
          interval={0}
        />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
          formatter={(v) => [`${v} plays`, "plays"]}
          labelFormatter={(h) => `${String(h).padStart(2, "0")}:00`}
        />
        <Bar dataKey="plays" fill="#0f172a" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
