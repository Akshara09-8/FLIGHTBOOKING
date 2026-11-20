type Client = Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>;

export type ActivePlan = { plan: string; planName: string; endsAt: string } | null;

/** The user's current plan (latest end date among active, unexpired subscriptions). */
export async function getActivePlan(supabase: Client, userId: string): Promise<ActivePlan> {
  const { data } = await supabase
    .from("subscriptions")
    .select("plan, ends_at, plans(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .gt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const plans = data.plans as unknown as { name: string } | null;
  return { plan: data.plan as string, planName: plans?.name ?? (data.plan as string), endsAt: data.ends_at as string };
}
