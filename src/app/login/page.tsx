import { getSupabaseEnv } from "@/lib/env";
import { safeNextPath } from "@/lib/routes";
import { SetupNotice } from "@/components/SetupNotice";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Log in · GroupFly" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (!getSupabaseEnv()) return <SetupNotice />;
  const { next, error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-2xl font-bold">Log in or sign up</h1>
      <p className="mt-1 text-sm text-muted">New here? Your account is created when you confirm the code.</p>
      <div className="card mt-6">
        <LoginForm next={safeNextPath(next)} oauthError={Boolean(error)} />
      </div>
    </div>
  );
}
