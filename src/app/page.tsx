import Link from "next/link";

export default function HomePage() {
  return (
    <div className="space-y-10">
      <section className="rounded-2xl bg-brand px-6 py-10 text-white">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">Diwali · Chhath · Christmas</p>
        <h1 className="mt-2 max-w-2xl text-3xl font-bold sm:text-4xl">Fly home for the festival together</h1>
        <p className="mt-3 max-w-xl text-white/85">
          Join a group of 30–40 people on the same flight and pay a negotiated group fare instead of the festival
          price.
        </p>
        <Link href="/login" className="btn-primary mt-6">
          Create your free account
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["Join a pool", "Pick your route, date and time window. Your seat is held with a small refundable deposit."],
          ["We negotiate", "When the pool fills, we request a group fare from the airline."],
          ["Fly together", "Pay the balance, confirm names as on ID, and get your e-ticket."],
        ].map(([title, body]) => (
          <div key={title} className="card">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        ))}
      </section>
      <p className="text-xs text-muted">Demo build: payments run in test mode and fares are example data.</p>
    </div>
  );
}
