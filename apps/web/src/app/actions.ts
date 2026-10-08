"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isSupportedChain } from "@/lib/sync/chains";
import { createClient } from "@/lib/supabase/server";

// Redirect with an error code only; the page translates it. Never pass database messages through.
const fail = (code: string) => redirect(`/?error=${encodeURIComponent(code)}`);
const logError = (where: string, error: { code?: string; message: string }) =>
  console.error(`[wallets] ${where} failed:`, error.code, error.message);

export async function addWallet(form: FormData) {
  const chain = String(form.get("chain_id") ?? "");
  if (!isSupportedChain(chain)) fail("chain");
  let address = String(form.get("address") ?? "").trim();
  if (chain !== "tron") address = address.toLowerCase();
  const supabase = await createClient();
  const { error } = await supabase.from("wallets").insert({
    org_id: String(form.get("org_id")),
    chain_id: chain,
    address,
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
  const { error } = await supabase.from("wallets").delete().eq("id", String(form.get("id")));
  if (error) { logError("deleteWallet", error); fail("generic"); }
  revalidatePath("/");
}

// Only the label is editable: chain and address define the wallet's history.
export async function renameWallet(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("wallets")
    .update({ label: String(form.get("label") ?? "").trim().slice(0, 80) })
    .eq("id", String(form.get("id")));
  if (error) { logError("renameWallet", error); fail("generic"); }
  revalidatePath("/");
}
