import { requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Profile · GroupFly" };

export default async function ProfilePage() {
  const { profile } = await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Your profile</h1>
        <p className="text-sm text-muted">
          Account type: <span className="chip">{ROLE_LABELS[profile.role]}</span>
        </p>
      </div>
      <ProfileForm fullName={profile.full_name ?? ""} phone={profile.phone ?? ""} email={profile.email ?? ""} />
    </div>
  );
}
