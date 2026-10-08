"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function saveConnection(form: FormData) {
  const chain = String(form.get("chain_id"));
  const provider = String(form.get("provider"));
  const key = String(form.get("api_key") ?? "").trim();
  const endpoint = String(form.get("endpoint_url") ?? "").trim() || null;
  const back = `/connections?chain=${encodeURIComponent(chain)}&`;
  const supabase = await createClient();
  const { data: orgs } = await supabase.from("orgs").select("id").order("created_at").limit(1);
  const orgId = orgs?.[0]?.id;
  if (!orgId) redirect(back + "error=" + "no_org");

  const { data: existing } = await supabase.from("provider_connections").select("id").eq("chain_id", chain).maybeSingle();
  if (endpoint && !/^https:\/\//.test(endpoint)) redirect(back + "error=" + "https");
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await supabase.from("provider_connections")
      .insert({ org_id: orgId, chain_id: chain, provider, name: provider, endpoint_url: endpoint }).select("id").single();
    if (error) redirect(back + "error=" + encodeURIComponent(error.message));
    id = data.id;
  } else {
    const { error } = await supabase.from("provider_connections").update({ name: provider, endpoint_url: endpoint }).eq("id", id);
    if (error) redirect(back + "error=" + encodeURIComponent(error.message));
  }
  if (key) {
    const { error } = await supabase.rpc("set_connection_api_key", { connection_id: id, api_key: key });
    if (error) redirect(back + "error=" + encodeURIComponent(error.message));
  }
  revalidatePath("/connections");
  redirect(back + "saved=" + chain);
}

export async function deleteApiKey(form: FormData) {
  const chain = String(form.get("chain_id"));
  const supabase = await createClient();
  const { data: conn } = await supabase.from("provider_connections").select("id").eq("chain_id", chain).maybeSingle();
  const back = `/connections?chain=${encodeURIComponent(chain)}&`;
  if (!conn) redirect(back + "error=" + "no_conn");
  const { error } = await supabase.rpc("set_connection_api_key", { connection_id: conn.id, api_key: "" });
  if (error) redirect(back + "error=" + encodeURIComponent(error.message));
  revalidatePath("/connections");
  redirect(back + "deleted=" + chain);
}
