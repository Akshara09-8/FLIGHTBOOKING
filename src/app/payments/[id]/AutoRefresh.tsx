"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a payment is waiting for confirmation, re-check every 3 s for up to 2 minutes. */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > 40) clearInterval(t);
      else router.refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
