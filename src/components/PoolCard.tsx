import Link from "next/link";
import {
  cutOffInfo,
  formatInr,
  formatTimeIST,
  formatTravelDate,
  savings,
  TIME_WINDOW_LABELS,
  type PoolWithRefs,
} from "@/lib/pools";
import { SeatMeter } from "./SeatMeter";

export function PoolCard({ pool }: { pool: PoolWithRefs }) {
  const save = savings(pool.market_fare_paise, pool.target_fare_paise);
  const cut = cutOffInfo(pool.cut_off_at);
  return (
    <Link href={`/pools/${pool.id}`} className="card flex flex-col gap-3 transition hover:border-brand">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">
            {pool.origin} → {pool.destination}
            {pool.flight && <span className="font-normal text-muted"> · {formatTimeIST(pool.flight.departs_at)}</span>}
          </p>
          <p className="text-sm text-muted">
            {formatTravelDate(pool.travel_date)} · {TIME_WINDOW_LABELS[pool.time_window].split(" ")[0]}
          </p>
        </div>
        {pool.festival && <span className="chip shrink-0">{pool.festival.name.replace(/\s\d{4}$/, "")}</span>}
      </div>
      <SeatMeter seatsFilled={pool.seats_filled} minSeats={pool.min_seats} maxSeats={pool.max_seats} size="sm" />
      <div className="flex items-end justify-between text-sm">
        <span className={cut.urgent ? "font-medium text-danger" : "text-muted"}>{cut.label}</span>
        <span className="text-right">
          {save && <span className="mr-1 text-muted line-through">{formatInr(pool.market_fare_paise)}</span>}
          <b className="text-brand">{formatInr(pool.target_fare_paise)}</b>
        </span>
      </div>
    </Link>
  );
}
