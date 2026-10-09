"use client";

import { adminOrgId } from "@/lib/org";
import { refreshData } from "@/lib/nav";
import { createClient } from "@/lib/supabase/client";

const TYPES = ["PERSON", "EXCHANGE", "DEX", "CONTRACT"];

// Name / classify a counterparty for the caller's workspace (admins only, enforced by RLS).
export async function saveLabel(form: FormData) {
  const address = String(form.get("address") ?? "");
  const chain = String(form.get("chain_id") ?? "");
  const type = TYPES.includes(String(form.get("type"))) ? String(form.get("type")) : "PERSON";
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  const supabase = createClient();
  const org = await adminOrgId(supabase);
  if (!org || !address || !chain) return;
  const { error } = await supabase.from("address_labels")
    .upsert({ org_id: org, chain_id: chain, address, name, type, source: "manual", updated_at: new Date().toISOString() });
  if (error) {
    // Log the real cause; the UI only shows a generic message.
    console.error("[overview] saveLabel failed:", error.code, error.message);
    throw new Error("save_label_failed");
  }
  refreshData();
}
