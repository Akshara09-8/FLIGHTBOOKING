export function SetupNotice() {
  return (
    <div className="card max-w-2xl border-accent">
      <h2 className="text-lg font-semibold">Connect Supabase to continue</h2>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>Create a free project at supabase.com.</li>
        <li>Run <code>supabase/migrations/0001_init.sql</code> and then <code>supabase/seed.sql</code> in its SQL editor.</li>
        <li>Copy <code>.env.example</code> to <code>.env.local</code> and paste the project URL and anon key.</li>
        <li>Restart <code>npm run dev</code>.</li>
      </ol>
      <p className="mt-3 text-sm text-muted">Full steps are in README.md.</p>
    </div>
  );
}
