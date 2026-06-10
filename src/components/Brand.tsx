export function Logo({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-2xl bg-accent text-background font-bold tracking-tight ${className}`}
      aria-hidden
    >
      LA
    </div>
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-10 w-10 text-lg" />
      <div className="leading-tight">
        <div className="text-base font-semibold">LACC Sign-In</div>
        <div className="text-xs text-muted">Studio attendance</div>
      </div>
    </div>
  );
}
