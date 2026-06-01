"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function YearlyChart({
  data,
  height = 220,
}: {
  data: { year: number; plays: number; hours: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
        <XAxis dataKey="year" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#e5e7eb" }} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
        <Tooltip
          cursor={{ fill: "rgba(0,0,0,0.04)" }}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
          formatter={(v, _name, item) => {
            const p = item?.payload as { plays: number; hours: number } | undefined;
            return [`${v} plays · ${p?.hours ?? 0}h`, item?.payload?.year];
          }}
          labelFormatter={() => ""}
        />
        <Bar dataKey="plays" fill="#0f172a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
