"use client";

import { useRouter } from "next/navigation";
import { useT } from "@/i18n/client";
import { Dropdown } from "./Dropdown";

// Mobile replacement for the chain list: same choices, navigates on change.
export function ChainPicker({ chains, current }: { chains: { id: string; name: string; note: string }[]; current: string }) {
  const router = useRouter();
  const t = useT();
  return (
    <Dropdown name="chain" label={t.common.chain} defaultValue={current}
      options={chains.map((c) => ({ value: c.id, label: `${c.name} · ${c.note}`, icon: c.id }))}
      onChange={(v) => router.push(`/connections/?chain=${v}`)} />
  );
}
