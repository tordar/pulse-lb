import { forwardRef } from "react";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  padding?: "sm" | "md" | "lg" | "none";
};

const padMap = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { className = "", padding = "md", ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`rounded-lg border border-card-border bg-card ${padMap[padding]} ${className}`}
      {...props}
    />
  );
});

export function CardTitle({ className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${className}`}
      {...props}
    />
  );
}
