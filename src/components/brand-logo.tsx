import { cn } from "@/lib/utils";

/**
 * App mark. Same artwork as public/brand/cuentix-icon.v2.svg
 * (black field, gradient C, orange x).
 */
export function BrandLogo({
  className,
  size = 40,
}: {
  className?: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- brand SVG, same file as the PWA icon
    <img
      src="/brand/cuentix-icon.v2.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn("shrink-0 rounded-[22%]", className)}
    />
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 font-semibold tracking-tight",
        className,
      )}
    >
      <BrandLogo size={32} />
      <span>Cuentix</span>
    </span>
  );
}
