"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const TYPES = ["PERSON", "EXCHANGE", "DEX", "CONTRACT"];

// Name / classify a counterparty for the caller's workspace (admins only, enforced by RLS).
export async function saveLabel(form: FormData) {
  const address = String(form.get("address") ?? "");
  const chain = String(form.get("chain_id") ?? "");
  const type = TYPES.includes(String(form.get("type"))) ? String(form.get("type")) : "PERSON";
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const supabase = await createClient();
  const { data: orgs } = await supabase.from("orgs").select("id").order("created_at").limit(1);
  const org = orgs?.[0]?.id;
  if (!org || !address || !chain) return;
  const { error } = await supabase.from("address_labels")
    .upsert({ org_id: org, chain_id: chain, address, name, type, source: "manual", updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  revalidatePath("/overview");
}
