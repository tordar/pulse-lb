import Link from "next/link";
import { Settings } from "lucide-react";

/**
 * Phone-only account button, top right of the header. Settings don't belong in
 * a tab bar next to the content sections — and with Search in there, six cells
 * was one too many for a 390px row. Desktop keeps Account in <PillNav>.
 */
export function AccountLink({ active = false }: { active?: boolean }) {
  return (
    <Link
      href="/account"
      aria-label="Account settings"
      aria-current={active ? "page" : undefined}
      className={`md:hidden shrink-0 flex h-9 w-9 items-center justify-center rounded-full transition active:scale-95 ${
        active ? "bg-primary/15 text-primary" : "text-muted-foreground"
      }`}
    >
      <Settings size={18} strokeWidth={1.9} />
    </Link>
  );
}
