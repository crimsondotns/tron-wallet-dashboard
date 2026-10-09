"use client";

import { adminOrgId } from "@/lib/org";
import { go, refreshData } from "@/lib/nav";
import { normalizeAddress } from "@/lib/sync/address";
import { isSupportedChain } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/client";

// Navigate with an error code only; the page translates it. Never pass database messages through.
const fail = (code: string) => go(`/?error=${encodeURIComponent(code)}`);
const logError = (where: string, error: { code?: string; message: string }) =>
  console.error(`[wallets] ${where} failed:`, error.code, error.message);

export async function addWallet(form: FormData) {
  const chain = String(form.get("chain_id") ?? "");
  if (!isSupportedChain(chain)) return fail("chain");
  const address = normalizeAddress(chain, String(form.get("address") ?? ""));
  if (!address) return fail("bad_address");
  const supabase = createClient();
  const orgId = await adminOrgId(supabase, String(form.get("org_id") ?? ""));
  if (!orgId) return fail("not_allowed");
  const { error } = await supabase.from("wallets").insert({
    org_id: orgId,
    chain_id: chain,
    address,
    label: String(form.get("label") ?? "").trim(),
  });
  if (error) {
    if (error.code === "23514") return fail("bad_address");
    if (error.code === "23505") return fail("duplicate");
    logError("addWallet", error);
    return fail("generic");
  }
  go("/");
  refreshData();
}

export async function deleteWallet(form: FormData) {
  const supabase = createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) return fail("not_allowed");
  const { error } = await supabase.from("wallets").delete().eq("id", String(form.get("id"))).eq("org_id", orgId);
  if (error) { logError("deleteWallet", error); return fail("generic"); }
  refreshData();
}

// Only the label is editable: chain and address define the wallet's history.
export async function renameWallet(form: FormData) {
  const supabase = createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) return fail("not_allowed");
  const { error } = await supabase.from("wallets")
    .update({ label: String(form.get("label") ?? "").trim().slice(0, 80) })
    .eq("id", String(form.get("id"))).eq("org_id", orgId);
  if (error) { logError("renameWallet", error); return fail("generic"); }
  refreshData();
}
