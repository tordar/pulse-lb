import Link from "next/link";

export function SignInButton({
  returnTo,
  label = "Sign in with ListenBrainz",
}: {
  returnTo?: string;
  label?: string;
}) {
  const href = returnTo
    ? `/auth/login?return=${encodeURIComponent(returnTo)}`
    : "/auth/login";
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
    >
      {label}
    </Link>
  );
}
