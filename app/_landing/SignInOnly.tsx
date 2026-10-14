// app/_landing/SignInOnly.tsx

/** Today's landing: used while loading the shell fails or there is no showcase data. */
export function SignInOnly() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6">
      <a
        href="/auth/login"
        className="inline-flex items-center justify-center gap-2 font-medium transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-6 text-base rounded-md"
      >
        Sign in with ListenBrainz
      </a>
    </main>
  );
}
