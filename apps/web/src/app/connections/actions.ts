"use client";

import { adminOrgId } from "@/lib/org";
import { go, refreshData } from "@/lib/nav";
import { isSupportedChain, isSupportedProvider } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/client";

// Navigations carry error codes only; the page translates them. Real errors are logged here.
const back = (chain: string) => `/connections/?chain=${encodeURIComponent(chain)}&`;
function fail(chain: string, where: string, error: { code?: string; message: string }) {
  console.error(`[connections] ${where} failed:`, error.code, error.message);
  go(back(chain) + "error=generic");
}

// Tronscan only serves its own hosts; TronGrid-compatible providers (QuickNode, GetBlock, ...)
// may use any https URL. Changing the endpoint drops the saved key in the DB (connection_guard).
const ALLOWED_HOSTS: Record<string, string[]> = {
  tronscan: ["apilist.tronscanapi.com", "apilist.tronscan.org"],
};
const endpointOk = (provider: string, url: string) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    const hosts = ALLOWED_HOSTS[provider];
    return !hosts || hosts.includes(u.hostname);
  } catch {
    return false;
  }
};

export async function saveConnection(form: FormData) {
  const chain = String(form.get("chain_id"));
  const provider = String(form.get("provider"));
  const key = String(form.get("api_key") ?? "").trim();
  const endpoint = String(form.get("endpoint_url") ?? "").trim() || null;
  if (!isSupportedChain(chain) || !isSupportedProvider(chain, provider)) return go("/connections/?error=chain");
  const supabase = createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) return go(back(chain) + "error=no_org");
  if (endpoint && !/^https:\/\//.test(endpoint)) return go(back(chain) + "error=https");
  if (endpoint && !endpointOk(provider, endpoint)) return go(back(chain) + "error=endpoint_host");

  const { data: existing, error: findErr } = await supabase.from("provider_connections").select("id")
    .eq("org_id", orgId).eq("chain_id", chain).maybeSingle();
  if (findErr) return fail(chain, "find connection", findErr);
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await supabase.from("provider_connections")
      .insert({ org_id: orgId, chain_id: chain, provider, name: provider, endpoint_url: endpoint }).select("id").single();
    if (error) return fail(chain, "insert connection", error);
    id = data.id;
  } else {
    const { error } = await supabase.from("provider_connections")
      .update({ provider, name: provider, endpoint_url: endpoint }).eq("id", id).eq("org_id", orgId);
    if (error) return fail(chain, "update connection", error);
  }
  if (key) {
    const { error } = await supabase.rpc("set_connection_api_key", { connection_id: id, api_key: key });
    if (error) return fail(chain, "set api key", error);
  }
  go(back(chain) + "saved=" + chain);
  refreshData();
}

export async function deleteApiKey(form: FormData) {
  const chain = String(form.get("chain_id"));
  if (!isSupportedChain(chain)) return go("/connections/?error=chain");
  const supabase = createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) return go(back(chain) + "error=no_org");
  const { data: conn, error: findErr } = await supabase.from("provider_connections").select("id")
    .eq("org_id", orgId).eq("chain_id", chain).maybeSingle();
  if (findErr) return fail(chain, "find connection", findErr);
  if (!conn) return go(back(chain) + "error=no_conn");
  const { error } = await supabase.rpc("set_connection_api_key", { connection_id: conn.id, api_key: "" });
  if (error) return fail(chain, "delete api key", error);
  go(back(chain) + "deleted=" + chain);
  refreshData();
}
