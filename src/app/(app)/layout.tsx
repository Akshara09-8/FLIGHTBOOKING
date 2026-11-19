import { getSupabaseEnv } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";

// Signed-in area. The middleware already redirects visitors without a session to /login.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!getSupabaseEnv()) return <SetupNotice />;
  return <>{children}</>;
}
