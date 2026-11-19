"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SeatMeter } from "@/components/SeatMeter";

/**
 * Seat counter that updates without a reload (T2.9).
 * Uses Supabase Realtime; if the live channel can't connect, polls every 5 seconds.
 */
export function LiveSeats({
  poolId,
  initialSeats,
  minSeats,
  maxSeats,
}: {
  poolId: string;
  initialSeats: number;
  minSeats: number;
  maxSeats: number;
}) {
  const [seats, setSeats] = useState(initialSeats);
  const [live, setLive] = useState(false);

  // A server refresh (after join/leave) brings a new initial value.
  useEffect(() => setSeats(initialSeats), [initialSeats]);

  useEffect(() => {
    const supabase = createClient();
    let poll: ReturnType<typeof setInterval> | undefined;

    const fetchNow = async () => {
      const { data } = await supabase.from("pools").select("seats_filled").eq("id", poolId).maybeSingle();
      if (data && typeof data.seats_filled === "number") setSeats(data.seats_filled);
    };
    const startPolling = () => {
      if (!poll) poll = setInterval(fetchNow, 5000);
    };

    const channel = supabase
      .channel(`pool-${poolId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "pools", filter: `id=eq.${poolId}` },
        (payload) => {
          const n = (payload.new as { seats_filled?: unknown }).seats_filled;
          if (typeof n === "number") setSeats(n);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLive(true);
          if (poll) {
            clearInterval(poll);
            poll = undefined;
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setLive(false);
          startPolling();
        }
      });

    return () => {
      if (poll) clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [poolId]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-semibold">Seats</p>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`h-2 w-2 rounded-full ${live ? "bg-ok" : "bg-line"}`} aria-hidden />
          {live ? "Live" : "Updating every 5 s"}
        </span>
      </div>
      <SeatMeter seatsFilled={seats} minSeats={minSeats} maxSeats={maxSeats} />
    </div>
  );
}
