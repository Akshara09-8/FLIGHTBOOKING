"use client";

import { useEffect, useState } from "react";
import { cutOffInfo } from "@/lib/pools";

/** Re-renders every 30 s so the time left stays current without a reload. */
export function CutOffCountdown({ cutOffAt }: { cutOffAt: string }) {
  const [info, setInfo] = useState(() => cutOffInfo(cutOffAt));
  useEffect(() => {
    const t = setInterval(() => setInfo(cutOffInfo(cutOffAt)), 30_000);
    return () => clearInterval(t);
  }, [cutOffAt]);
  return <span className={info.closed || info.urgent ? "font-semibold text-danger" : "font-semibold"}>{info.label}</span>;
}
