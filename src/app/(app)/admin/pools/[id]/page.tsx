import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/roles";
import {
  formatDateTimeIST,
  formatTimeIST,
  formatTravelDate,
  POOL_STATUS_LABELS,
  TIME_WINDOW_LABELS,
  type PoolStatus,
  type TimeWindow,
} from "@/lib/pools";
import { balanceDue, nextAction, OPS_STATUS_LABELS, paxMix, rfqEmail, type ManifestPassenger } from "@/lib/ops";
import { formatRupees } from "@/lib/payments/money";
import { formatPaymentDate } from "@/lib/payments/labels";
import { ActionForm } from "@/components/ActionForm";
import { CopyText } from "@/components/CopyText";
import { SeatMeter } from "@/components/SeatMeter";
import {
  acceptQuote,
  closePool,
  markCompleted,
  recordQuote,
  rejectQuote,
  saveTicket,
  sendRfq,
  submitNames,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pool operations · Admin · GroupFly" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pool = {
  id: string;
  origin: string;
  destination: string;
  travel_date: string;
  time_window: TimeWindow;
  status: PoolStatus;
  seats_filled: number;
  min_seats: number;
  max_seats: number;
  cut_off_at: string;
  target_fare_paise: number | null;
  deposit_paise: number;
  final_fare_paise: number | null;
  balance_due_at: string | null;
  festival: { name: string } | null;
  flight: { airline: string; flight_no: string; departs_at: string } | null;
};
type Member = {
  traveller_id: string;
  party_id: string;
  status: "held" | "confirmed" | "waitlisted";
  balance_paid_at: string | null;
  traveller: { full_name_as_on_id: string; date_of_birth: string; gender: ManifestPassenger["gender"] } | null;
  owner: { full_name: string | null; email: string | null } | null;
};
type Rfq = { id: string; airline: string; recipient_email: string | null; seats: number; sent_at: string };
type Quote = {
  id: string;
  airline: string;
  fare_per_seat_paise: number;
  valid_until: string | null;
  name_deadline: string | null;
  seats: number | null;
  notes: string | null;
  status: "pending" | "accepted" | "rejected" | "expired";
  reject_reason: string | null;
  created_at: string;
};
type Ticket = { id: string; traveller_id: string; pnr: string | null; ticket_number: string | null; file_path: string | null };
type Audit = { id: number; action: string; created_at: string; after: Record<string, unknown> | null; actor: { email: string | null } | null };

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);

function Section({ title, children, muted }: { title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={`card space-y-3 ${muted ? "opacity-70" : ""}`}>
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function PoolOpsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { supabase, profile } = await requireUser();
  if (!canAccessAdmin(profile.role)) {
    return (
      <div className="card max-w-lg">
        <p className="text-sm font-semibold text-danger">403 · Admins only</p>
        <Link href="/dashboard" className="btn-ghost mt-4">Back to dashboard</Link>
      </div>
    );
  }

  const [{ data: poolRow }, { data: memberRows }, { data: rfqRows }, { data: quoteRows }, { data: ticketRows }, { data: auditRows }] =
    await Promise.all([
      supabase
        .from("pools")
        .select(
          "id, origin, destination, travel_date, time_window, status, seats_filled, min_seats, max_seats, cut_off_at, target_fare_paise, deposit_paise, final_fare_paise, balance_due_at, festival:festivals(name), flight:flights(airline, flight_no, departs_at)",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("pool_members")
        .select(
          "traveller_id, party_id, status, balance_paid_at, traveller:travellers(full_name_as_on_id, date_of_birth, gender), owner:profiles(full_name, email)",
        )
        .eq("pool_id", id)
        .neq("status", "left")
        .order("joined_at"),
      supabase.from("rfqs").select("id, airline, recipient_email, seats, sent_at").eq("pool_id", id).order("sent_at", { ascending: false }),
      supabase
        .from("quotes")
        .select("id, airline, fare_per_seat_paise, valid_until, name_deadline, seats, notes, status, reject_reason, created_at")
        .eq("pool_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("tickets").select("id, traveller_id, pnr, ticket_number, file_path").eq("pool_id", id),
      supabase
        .from("audit_log")
        .select("id, action, created_at, after, actor:profiles(email)")
        .eq("entity", "pools")
        .eq("entity_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
  const pool = poolRow as unknown as Pool | null;
  if (!pool) notFound();

  const members = (memberRows ?? []) as unknown as Member[];
  const confirmed = members.filter((m) => m.status === "confirmed");
  const rfqs = (rfqRows ?? []) as Rfq[];
  const quotes = (quoteRows ?? []) as Quote[];
  const tickets = new Map(((ticketRows ?? []) as Ticket[]).map((t) => [t.traveller_id, t]));
  const audit = (auditRows ?? []) as unknown as Audit[];
  const s = pool.status;
  const statusLabel = OPS_STATUS_LABELS[s] ?? POOL_STATUS_LABELS[s];

  // Fare request email text (T4.2)
  const mix = paxMix(
    confirmed.filter((m) => m.traveller).map((m) => ({ dateOfBirth: m.traveller!.date_of_birth })),
    pool.travel_date,
  );
  const replyBy = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(
    new Date(Date.now() + 3 * 86_400_000),
  );
  const email = rfqEmail({
    airline: rfqs[0]?.airline ?? pool.flight?.airline ?? "Airline",
    origin: pool.origin,
    destination: pool.destination,
    travelDate: pool.travel_date,
    timeWindowLabel: TIME_WINDOW_LABELS[pool.time_window],
    flight: pool.flight
      ? { airline: pool.flight.airline, flight_no: pool.flight.flight_no, departsAtIST: formatTimeIST(pool.flight.departs_at) }
      : null,
    seats: confirmed.length,
    mix,
    targetFareRupees: pool.target_fare_paise != null ? Math.round(pool.target_fare_paise / 100) : null,
    replyBy,
    contactEmail: profile.email ?? "",
  });
  const emailText = `Subject: ${email.subject}\n\n${email.lines.join("\n")}`;
  const mailto = rfqs[0]?.recipient_email
    ? `mailto:${rfqs[0].recipient_email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.lines.join("\n"))}`
    : null;

  // Balances by party (T4.3)
  const parties = [...new Set(confirmed.map((m) => m.party_id))].map((partyId) => {
    const ms = confirmed.filter((m) => m.party_id === partyId);
    return {
      partyId,
      seats: ms.length,
      owner: ms[0].owner,
      paid: ms.every((m) => m.balance_paid_at),
      amount: pool.final_fare_paise != null ? balanceDue(ms.length, pool.final_fare_paise, pool.deposit_paise) : 0,
    };
  });
  const unpaidParties = parties.filter((p) => !p.paid);
  const today = toDateInput(new Date());
  const afterRfq = ["rfq_sent", "quoted", "payment_due", "names_submitted", "ticketed", "completed"].includes(s);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/pools" className="text-sm text-brand hover:underline">← Operations</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">
              {pool.origin} → {pool.destination} · {formatTravelDate(pool.travel_date)}
            </h1>
            <p className="text-sm text-muted">
              {pool.festival?.name ?? "No festival"} · {TIME_WINDOW_LABELS[pool.time_window]}
              {pool.flight && ` · ${pool.flight.airline} ${pool.flight.flight_no}`} ·{" "}
              <Link href={`/pools/${pool.id}`} className="text-brand hover:underline">Member view</Link>
            </p>
          </div>
          <div className="text-right">
            <span className="chip">{statusLabel}</span>
            <p className="mt-1 text-sm text-muted">Next: {nextAction(s)}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <SeatMeter seatsFilled={pool.seats_filled} minSeats={pool.min_seats} maxSeats={pool.max_seats} />
          <p className="mt-2 text-sm text-muted">
            {confirmed.length} confirmed · {members.filter((m) => m.status === "held").length} deposit due ·{" "}
            {members.filter((m) => m.status === "waitlisted").length} waitlisted
          </p>
        </div>
        <div className="card text-sm">
          <p className="text-muted">Fares per seat</p>
          <p>Target {formatRupees(pool.target_fare_paise ?? 0)} · Deposit {formatRupees(pool.deposit_paise)}</p>
          <p className="font-semibold">Final {pool.final_fare_paise != null ? formatRupees(pool.final_fare_paise) : "not set"}</p>
        </div>
        <div className="card text-sm">
          <p className="text-muted">Deadlines</p>
          <p>Joining closes {formatDateTimeIST(pool.cut_off_at)}</p>
          {pool.balance_due_at && <p>Balance due {formatDateTimeIST(pool.balance_due_at)}</p>}
        </div>
      </div>

      {/* 1. Fare request */}
      <Section title="1. Fare request to the airline" muted={!(s === "min_reached" || afterRfq)}>
        {s === "open" && <p className="text-sm text-muted">Available once the pool reaches its minimum of {pool.min_seats} seats.</p>}
        {(s === "min_reached" || s === "rfq_sent") && (
          <ActionForm
            action={sendRfq.bind(null, pool.id)}
            submitLabel={s === "rfq_sent" ? "Log another fare request" : "Send fare request"}
            confirm={
              s === "min_reached"
                ? "This closes the pool to new members; unpaid holds and the waitlist are released. Continue?"
                : undefined
            }
            className="grid gap-3 sm:grid-cols-2"
          >
            <input name="airline" required placeholder="Airline, e.g. Demo Air" defaultValue={pool.flight?.airline ?? ""} className="input" aria-label="Airline" />
            <input name="recipientEmail" type="email" placeholder="Group desk email (optional)" className="input" aria-label="Group desk email" />
            <textarea name="message" placeholder="Internal note (optional)" className="input sm:col-span-2" rows={2} aria-label="Note" />
          </ActionForm>
        )}
        {(s === "min_reached" || afterRfq) && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Email to send (emails go out automatically from Phase 5):</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs">{emailText}</pre>
            <div className="flex flex-wrap gap-2">
              <CopyText text={emailText} label="Copy email" />
              {mailto && <a href={mailto} className="btn-ghost">Open in email app</a>}
              {rfqs[0] && (
                <a href={`/api/admin/pools/${pool.id}/rfq/${rfqs[0].id}`} className="btn-ghost" target="_blank" rel="noreferrer">
                  Download PDF
                </a>
              )}
            </div>
          </div>
        )}
        {rfqs.length > 0 && (
          <ul className="divide-y divide-line text-sm">
            {rfqs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {r.airline} · {r.seats} seats{r.recipient_email ? ` · ${r.recipient_email}` : ""}
                </span>
                <span className="text-muted">{formatPaymentDate(r.sent_at)} IST</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 2. Quotes */}
      <Section title="2. Airline quotes" muted={!afterRfq}>
        {(s === "rfq_sent" || s === "quoted") && (
          <ActionForm action={recordQuote.bind(null, pool.id)} submitLabel="Record quote" className="grid gap-3 sm:grid-cols-5">
            <input name="airline" required placeholder="Airline" defaultValue={rfqs[0]?.airline ?? ""} className="input sm:col-span-2" aria-label="Airline" />
            <input name="fareRupees" type="number" min={1} required placeholder="Fare per seat (₹)" className="input" aria-label="Fare per seat in rupees" />
            <label className="text-xs text-muted">
              Valid until
              <input name="validUntil" type="date" min={today} required className="input" />
            </label>
            <label className="text-xs text-muted">
              Names due to airline
              <input name="nameDeadline" type="date" min={today} max={pool.travel_date} required className="input" />
            </label>
            <input name="notes" placeholder="Terms, baggage, etc. (optional)" className="input sm:col-span-5" aria-label="Notes" />
          </ActionForm>
        )}
        {quotes.length === 0 ? (
          <p className="text-sm text-muted">No quotes yet.</p>
        ) : (
          <ul className="space-y-3">
            {quotes.map((q) => (
              <li key={q.id} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>{q.airline}</b> · {formatRupees(Number(q.fare_per_seat_paise))} per seat · {q.seats ?? "?"} seats
                  </span>
                  <span className={q.status === "accepted" ? "font-semibold text-ok" : q.status === "rejected" ? "text-danger" : "text-muted"}>
                    {q.status === "pending" ? "Waiting for decision" : q.status[0].toUpperCase() + q.status.slice(1)}
                  </span>
                </div>
                <p className="text-muted">
                  Received {formatPaymentDate(q.created_at)} · valid until {q.valid_until ? formatDateTimeIST(q.valid_until) : "—"} · names
                  due {q.name_deadline ? formatDateTimeIST(q.name_deadline) : "—"}
                </p>
                {q.notes && <p className="text-muted">{q.notes}</p>}
                {q.reject_reason && <p className="text-danger">Reason: {q.reject_reason}</p>}
                {q.status === "pending" && s === "quoted" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ActionForm
                      action={acceptQuote.bind(null, pool.id, q.id)}
                      submitLabel="Accept quote"
                      confirm="Members will be asked to pay the balance. Continue?"
                    >
                      <label className="block text-xs text-muted">
                        Balance due by
                        <input
                          name="balanceDueDate"
                          type="date"
                          min={today}
                          max={q.name_deadline?.slice(0, 10)}
                          required
                          className="input"
                        />
                      </label>
                      {pool.final_fare_paise == null && (
                        <p className="text-xs text-muted">
                          Balance per seat: {formatRupees(Math.max(0, Number(q.fare_per_seat_paise) - pool.deposit_paise))}
                        </p>
                      )}
                    </ActionForm>
                    <ActionForm action={rejectQuote.bind(null, pool.id, q.id)} submitLabel="Reject quote" danger>
                      <input name="reason" placeholder="Reason (optional)" className="input" aria-label="Reason" />
                    </ActionForm>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* 3. Balances */}
      <Section title="3. Balances and passenger names" muted={!["payment_due", "names_submitted", "ticketed", "completed"].includes(s)}>
        {parties.length > 0 && pool.final_fare_paise != null ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 font-medium">Booked by</th>
                  <th className="py-1 text-right font-medium">Seats</th>
                  <th className="py-1 text-right font-medium">Balance</th>
                  <th className="py-1 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {parties.map((p) => (
                  <tr key={p.partyId}>
                    <td className="py-1">{p.owner?.full_name ?? p.owner?.email ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">{p.seats}</td>
                    <td className="py-1 text-right tabular-nums">{formatRupees(p.amount)}</td>
                    <td className={`py-1 ${p.paid ? "text-ok" : "text-danger"}`}>{p.paid ? "Paid" : "Unpaid"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-sm text-muted">
              {parties.length - unpaidParties.length} of {parties.length} groups paid ·{" "}
              {formatRupees(parties.filter((p) => p.paid).reduce((a, p) => a + p.amount, 0))} collected
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">Balances are requested when a quote is accepted.</p>
        )}
        {s === "payment_due" && (
          <ActionForm
            action={submitNames.bind(null, pool.id)}
            submitLabel="Submit names to airline"
            confirm={
              unpaidParties.length > 0
                ? `${unpaidParties.length} group(s) haven't paid. Their seats will be released and deposits kept. Continue?`
                : "Lock the passenger list?"
            }
          >
            {unpaidParties.length > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="force" className="h-4 w-4 accent-brand" />
                Release unpaid seats even though the balance deadline hasn&apos;t passed
              </label>
            )}
          </ActionForm>
        )}
        {afterRfq && (
          <a href={`/api/admin/pools/${pool.id}/manifest`} className="btn-ghost">
            Download passenger manifest (CSV)
          </a>
        )}
      </Section>

      {/* 4. Tickets */}
      <Section title="4. Tickets" muted={!["names_submitted", "ticketed", "completed"].includes(s)}>
        {["names_submitted", "ticketed", "completed"].includes(s) ? (
          <ul className="space-y-3">
            {confirmed.map((m) => {
              const t = tickets.get(m.traveller_id);
              return (
                <li key={m.traveller_id} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                    <b>{m.traveller?.full_name_as_on_id}</b>
                    {t ? (
                      <span className="text-ok">
                        PNR {t.pnr}
                        {t.file_path && (
                          <>
                            {" · "}
                            <a href={`/api/tickets/${t.id}`} className="text-brand hover:underline" target="_blank" rel="noreferrer">
                              file
                            </a>
                          </>
                        )}
                      </span>
                    ) : (
                      <span className="text-danger">No ticket yet</span>
                    )}
                  </div>
                  <ActionForm action={saveTicket.bind(null, pool.id, m.traveller_id)} submitLabel={t ? "Update" : "Save ticket"} className="grid gap-2 sm:grid-cols-4">
                    <input name="pnr" required defaultValue={t?.pnr ?? ""} placeholder="PNR" className="input uppercase" aria-label="PNR" />
                    <input name="ticketNumber" defaultValue={t?.ticket_number ?? ""} placeholder="Ticket no. (optional)" className="input" aria-label="Ticket number" />
                    <input name="file" type="file" accept="application/pdf,image/png,image/jpeg" className="text-sm sm:col-span-2" aria-label="E-ticket file" />
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">Tickets are added after names are submitted.</p>
        )}
        {s === "ticketed" && (
          <ActionForm action={markCompleted.bind(null, pool.id)} submitLabel="Mark completed (after travel)" />
        )}
      </Section>

      {/* Danger zone */}
      {!["ticketed", "completed", "dissolved"].includes(s) && (
        <Section title="Close this pool">
          <p className="text-sm text-muted">Releases every seat and refunds every deposit and balance paid. This can&apos;t be undone.</p>
          <ActionForm action={closePool.bind(null, pool.id)} submitLabel="Close pool and refund" danger confirm="Close the pool and refund everyone?" />
        </Section>
      )}

      {/* Audit log (T4.6) */}
      <Section title="Activity log">
        {audit.length === 0 ? (
          <p className="text-sm text-muted">No admin actions yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="min-w-0 break-all">
                  <b>{a.action.replace(/_/g, " ")}</b>
                  {a.after && <span className="text-muted"> · {JSON.stringify(a.after)}</span>}
                </span>
                <span className="text-muted">
                  {a.actor?.email ?? "system"} · {formatPaymentDate(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
