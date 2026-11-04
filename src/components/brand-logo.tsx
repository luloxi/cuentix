import { cn } from "@/lib/utils";

/**
 * App mark. Same artwork as public/brand/tarask-icon.v4.svg
 * (black plate, ticket, check past the right edge).
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
      src="/brand/tarask-icon.v4.svg"
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
      <span>Tarask</span>
    </span>
  );
}
