import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card max-w-lg">
      <h1 className="text-xl font-bold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The link may be old, or the item belongs to another account.</p>
      <Link href="/dashboard" className="btn-ghost mt-4">
        Go to dashboard
      </Link>
    </div>
  );
}
