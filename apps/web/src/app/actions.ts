"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const fail = (msg: string) => redirect(`/?error=${encodeURIComponent(msg)}`);

export async function addWallet(form: FormData) {
  const chain = String(form.get("chain_id") ?? "");
  let address = String(form.get("address") ?? "").trim();
  if (chain !== "tron") address = address.toLowerCase();
  const supabase = await createClient();
  const { error } = await supabase.from("wallets").insert({
    org_id: String(form.get("org_id")),
    chain_id: chain,
    address,
    label: String(form.get("label") ?? "").trim(),
  });
  if (error) fail(error.code === "23514" ? "bad_address" : error.code === "23505" ? "duplicate" : error.message);
  revalidatePath("/");
}

export async function deleteWallet(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("wallets").delete().eq("id", String(form.get("id")));
  if (error) fail(error.message);
  revalidatePath("/");
}

// Only the label is editable: chain and address define the wallet's history.
export async function renameWallet(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("wallets")
    .update({ label: String(form.get("label") ?? "").trim().slice(0, 80) })
    .eq("id", String(form.get("id")));
  if (error) fail(error.message);
  revalidatePath("/");
}
