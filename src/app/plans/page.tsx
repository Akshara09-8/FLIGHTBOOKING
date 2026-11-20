import Link from "next/link";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SetupNotice } from "@/components/SetupNotice";
import { CheckoutButton } from "@/components/CheckoutButton";
import { formatRupees, gstBreakup } from "@/lib/payments/money";
import { getActivePlan } from "@/lib/subscription";
import { startSubscription } from "@/app/payments/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans · GroupFly" };

type Plan = { code: string; name: string; description: string; price_paise: number; days: number };

const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(iso),
  );

export default async function PlansPage() {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const supabase = await createClient();
  const [{ data: planRows }, { data: auth }] = await Promise.all([
    supabase.from("plans").select("code, name, description, price_paise, days").eq("active", true).order("sort"),
    supabase.auth.getUser(),
  ]);
  const plans = (planRows ?? []) as Plan[];
  const active = auth.user ? await getActivePlan(supabase, auth.user.id) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Plans</h1>
        <p className="text-sm text-muted">
          A plan lets you join group pools. Browsing pools is always free. Prices include 18% GST.
        </p>
      </div>

      {active && (
        <div className="card border-ok">
          <p className="font-semibold">Your {active.planName} plan is active until {fmtDate(active.endsAt)}.</p>
          <p className="text-sm text-muted">Buying again now adds the new days after this date.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {plans.map((p) => {
          const g = gstBreakup(Number(p.price_paise));
          return (
            <div key={p.code} className="card flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-semibold">{p.name}</h2>
                <p className="text-sm text-muted">{p.description}</p>
              </div>
              <p>
                <span className="text-3xl font-bold text-brand">{formatRupees(Number(p.price_paise))}</span>
                <span className="text-sm text-muted"> / {p.days} days</span>
              </p>
              <p className="text-xs text-muted">
                {formatRupees(g.basePaise)} + {formatRupees(g.gstPaise)} GST
              </p>
              <ul className="space-y-1 text-sm">
                <li>Join any public pool or private pool you&apos;re invited to</li>
                <li>Seats held while you pay the refundable deposit</li>
                <li>Waitlist priority when seats free up</li>
              </ul>
              <div className="mt-auto">
                {auth.user ? (
                  <CheckoutButton start={startSubscription.bind(null, p.code)} label={active ? `Extend with ${p.name}` : `Get ${p.name}`} />
                ) : (
                  <Link href="/login?next=/plans" className="btn-primary w-full">
                    Log in to subscribe
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted">Test mode: payments use test cards or UPI and no real money is charged.</p>
    </div>
  );
}
