"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { adminOrgId } from "@/lib/org";
import { normalizeAddress } from "@/lib/sync/address";
import { isSupportedChain } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/server";

// Redirect with an error code only; the page translates it. Never pass database messages through.
const fail = (code: string) => redirect(`/?error=${encodeURIComponent(code)}`);
const logError = (where: string, error: { code?: string; message: string }) =>
  console.error(`[wallets] ${where} failed:`, error.code, error.message);

export async function addWallet(form: FormData) {
  const chain = String(form.get("chain_id") ?? "");
  if (!isSupportedChain(chain)) fail("chain");
  const address = normalizeAddress(chain, String(form.get("address") ?? ""));
  if (!address) fail("bad_address");
  const supabase = await createClient();
  const orgId = await adminOrgId(supabase, String(form.get("org_id") ?? ""));
  if (!orgId) fail("not_allowed");
  const { error } = await supabase.from("wallets").insert({
    org_id: orgId!,
    chain_id: chain,
    address: address!,
    label: String(form.get("label") ?? "").trim(),
  });
  if (error) {
    if (error.code === "23514") fail("bad_address");
    if (error.code === "23505") fail("duplicate");
    logError("addWallet", error);
    fail("generic");
  }
  revalidatePath("/");
}

export async function deleteWallet(form: FormData) {
  const supabase = await createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) fail("not_allowed");
  const { error } = await supabase.from("wallets").delete().eq("id", String(form.get("id"))).eq("org_id", orgId!);
  if (error) { logError("deleteWallet", error); fail("generic"); }
  revalidatePath("/");
}

// Only the label is editable: chain and address define the wallet's history.
export async function renameWallet(form: FormData) {
  const supabase = await createClient();
  const orgId = await adminOrgId(supabase);
  if (!orgId) fail("not_allowed");
  const { error } = await supabase.from("wallets")
    .update({ label: String(form.get("label") ?? "").trim().slice(0, 80) })
    .eq("id", String(form.get("id"))).eq("org_id", orgId!);
  if (error) { logError("renameWallet", error); fail("generic"); }
  revalidatePath("/");
}
