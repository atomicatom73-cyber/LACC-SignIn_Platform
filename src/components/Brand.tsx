import Image from "next/image";

/**
 * The studio's pot logo (public/logo.png, transparent background). Callers
 * size it with height/width classes; the adjacent heading text carries the
 * name, so the image itself stays decorative (empty alt).
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt=""
      width={256}
      height={256}
      priority
      aria-hidden
      className={`object-contain ${className}`}
    />
  );
}

export function Wordmark() {
  return (
    <div className="flex items-center gap-3">
      <Logo className="h-10 w-10" />
      <div className="leading-tight">
        <div className="text-base font-semibold">LACC Studio</div>
        <div className="text-xs text-muted">Los Alamos Community Ceramics</div>
      </div>
    </div>
  );
}
