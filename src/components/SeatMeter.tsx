import { poolProgress } from "@/lib/pools";

export function SeatMeter({
  seatsFilled,
  minSeats,
  maxSeats,
  size = "md",
}: {
  seatsFilled: number;
  minSeats: number;
  maxSeats: number;
  size?: "sm" | "md";
}) {
  const p = poolProgress(seatsFilled, minSeats, maxSeats);
  return (
    <div className="space-y-1">
      <div
        className={`relative overflow-hidden rounded-full bg-line ${size === "sm" ? "h-1.5" : "h-2.5"}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={maxSeats}
        aria-valuenow={seatsFilled}
        aria-label={`${seatsFilled} of ${maxSeats} seats filled`}
      >
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${p.percent}%` }} />
        <div
          className="absolute top-0 h-full w-0.5 bg-ink/40"
          style={{ left: `${p.minPercent}%` }}
          title={`Minimum ${minSeats} seats`}
        />
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums">
        <span>
          <b className="text-ink">{seatsFilled}</b> of {maxSeats} seats
        </span>
        <span>{p.minReached ? (p.isFull ? "Full · waitlist open" : `${p.seatsLeft} left`) : `${p.toMinimum} more to minimum`}</span>
      </div>
    </div>
  );
}
