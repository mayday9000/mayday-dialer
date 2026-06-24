import { cn } from "@/lib/utils";

/**
 * Wordmark — the hexagonal "crystal" mark + the name in Instrument Serif.
 * Text uses theme foreground so it reads in light and dark.
 */
export function Wordmark({
  className,
  size = 22,
  showName = true,
  product = "Dialer",
}: {
  className?: string;
  size?: number;
  showName?: boolean;
  /** Product sub-brand shown in sans next to the serif wordmark. */
  product?: string;
}) {
  return (
    <span className={cn("flex select-none items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 22 22"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <polygon
          points="11,1 21,6.5 21,15.5 11,21 1,15.5 1,6.5"
          fill="#cc5200"
          stroke="#ff8533"
          strokeWidth="1.2"
        />
        <polygon points="11,1 21,6.5 11,12 1,6.5" fill="#ff6600" stroke="#ff9a4d" strokeWidth="0.8" />
        <polygon points="1,6.5 11,12 11,21" fill="#e65c00" stroke="#ff8533" strokeWidth="0.8" />
        <polygon points="21,6.5 11,12 11,21" fill="#ff7a1a" stroke="#ff9a4d" strokeWidth="0.8" />
      </svg>
      {showName && (
        <span className="flex items-baseline gap-1.5 leading-none">
          <span className="font-(family-name:--font-instrument-serif) text-2xl tracking-tight text-foreground">
            Mayday AI
          </span>
          {product && (
            <span className="font-sans text-base font-medium tracking-tight text-muted-foreground">
              {product}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
