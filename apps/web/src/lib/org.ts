import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

// The caller's memberships, oldest first (the personal org created at sign-up comes first).
export async function myOrgs(db: Db): Promise<{ org_id: string; role: string }[]> {
  const { data: session } = await db.auth.getSession();
  const uid = session.session?.user.id;
  if (!uid) return [];
  const { data } = await db.from("org_members").select("org_id, role").eq("user_id", uid).order("created_at");
  return data ?? [];
}

export const isAdminRole = (role?: string | null) => role === "owner" || role === "admin";

// Org the caller administers (owner/admin), or null. Client actions write only into this org,
// and every lookup they do is filtered by it.
export async function adminOrgId(db: Db, orgId?: string | null): Promise<string | null> {
  const orgs = (await myOrgs(db)).filter((m) => isAdminRole(m.role));
  if (orgId) return orgs.some((m) => m.org_id === orgId) ? orgId : null;
  return orgs[0]?.org_id ?? null;
}

// Role in a given org (null when not a member).
export async function roleIn(db: Db, orgId: string): Promise<string | null> {
  return (await myOrgs(db)).find((m) => m.org_id === orgId)?.role ?? null;
}
