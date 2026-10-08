"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSupportedChain, isSupportedProvider } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/server";

// Redirects carry error codes only; the page translates them. Real errors are logged here.
const back = (chain: string) => `/connections?chain=${encodeURIComponent(chain)}&`;
function fail(chain: string, where: string, error: { code?: string; message: string }): never {
  console.error(`[connections] ${where} failed:`, error.code, error.message);
  redirect(back(chain) + "error=generic");
}

export async function saveConnection(form: FormData) {
  const chain = String(form.get("chain_id"));
  const provider = String(form.get("provider"));
  const key = String(form.get("api_key") ?? "").trim();
  const endpoint = String(form.get("endpoint_url") ?? "").trim() || null;
  if (!isSupportedChain(chain) || !isSupportedProvider(chain, provider)) redirect("/connections?error=chain");
  const supabase = await createClient();
  const { data: orgs, error: orgErr } = await supabase.from("orgs").select("id").order("created_at").limit(1);
  if (orgErr) fail(chain, "load org", orgErr);
  const orgId = orgs?.[0]?.id;
  if (!orgId) redirect(back(chain) + "error=no_org");

  const { data: existing, error: findErr } = await supabase.from("provider_connections").select("id").eq("chain_id", chain).maybeSingle();
  if (findErr) fail(chain, "find connection", findErr);
  if (endpoint && !/^https:\/\//.test(endpoint)) redirect(back(chain) + "error=https");
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await supabase.from("provider_connections")
      .insert({ org_id: orgId, chain_id: chain, provider, name: provider, endpoint_url: endpoint }).select("id").single();
    if (error) fail(chain, "insert connection", error);
    id = data.id;
  } else {
    const { error } = await supabase.from("provider_connections").update({ name: provider, endpoint_url: endpoint }).eq("id", id);
    if (error) fail(chain, "update connection", error);
  }
  if (key) {
    const { error } = await supabase.rpc("set_connection_api_key", { connection_id: id, api_key: key });
    if (error) fail(chain, "set api key", error);
  }
  revalidatePath("/connections");
  redirect(back(chain) + "saved=" + chain);
}

export async function deleteApiKey(form: FormData) {
  const chain = String(form.get("chain_id"));
  if (!isSupportedChain(chain)) redirect("/connections?error=chain");
  const supabase = await createClient();
  const { data: conn, error: findErr } = await supabase.from("provider_connections").select("id").eq("chain_id", chain).maybeSingle();
  if (findErr) fail(chain, "find connection", findErr);
  if (!conn) redirect(back(chain) + "error=no_conn");
  const { error } = await supabase.rpc("set_connection_api_key", { connection_id: conn.id, api_key: "" });
  if (error) fail(chain, "delete api key", error);
  revalidatePath("/connections");
  redirect(back(chain) + "deleted=" + chain);
}
