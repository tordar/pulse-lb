import type { LucideIcon } from "lucide-react";

/** The bordered value-over-label tile used for headline numbers (stats, concerts). */
export function StatTile({
  icon: Icon,
  value,
  label,
  shortLabel,
  big = false,
  className = "",
}: {
  icon?: LucideIcon;
  // A node, not a string: the numeric tiles pass <AnimatedNumber>, which counts
  // from the old figure to the new one when a sync lands fresh aggregates.
  value: React.ReactNode;
  label: string;
  // Narrower label for the 3-column phone grid, where the full one wraps.
  shortLabel?: string;
  big?: boolean;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-card-border bg-card p-3 sm:p-4 space-y-1 sm:space-y-2 min-w-0 ${className}`}>
      {Icon && <Icon size={16} className="text-primary hidden sm:block" />}
      <div className={`tabular-nums font-semibold text-base truncate ${big ? "sm:text-2xl" : "sm:text-xl"}`}>{value}</div>
      <div className="text-[10px] sm:text-xs text-muted-foreground uppercase tracking-wide truncate">
        {shortLabel ? (
          <>
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </div>
    </div>
  );
}
