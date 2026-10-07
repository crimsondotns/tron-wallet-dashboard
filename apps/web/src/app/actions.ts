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
  if (error) fail(error.code === "23514" ? "รูปแบบ address ไม่ตรงกับ chain" : error.code === "23505" ? "มี wallet นี้แล้ว" : error.message);
  revalidatePath("/");
}

export async function deleteWallet(form: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("wallets").delete().eq("id", String(form.get("id")));
  if (error) fail(error.message);
  revalidatePath("/");
}
