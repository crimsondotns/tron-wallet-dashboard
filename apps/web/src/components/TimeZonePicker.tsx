"use client";

import { useRouter } from "next/navigation";
import { useMemo, useTransition } from "react";
import { setTimeZone } from "@/i18n/actions";
import { useT, useTimeZone } from "@/i18n/client";
import { tzOffsetLabel } from "@/i18n/tz";
import { Dropdown } from "./Dropdown";

const Clock = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Every IANA zone with its current UTC offset, sorted by offset then name.
function zoneOptions(current: string) {
  const now = Date.now();
  const ids = Intl.supportedValuesOf("timeZone");
  if (!ids.includes(current)) ids.push(current); // e.g. "UTC" is not listed in every engine
  return ids
    .map((id) => {
      const off = tzOffsetLabel(id, now);
      return { id, off, label: `(${off}) ${id.replace(/_/g, " ")}`, key: Number(off.replace("−", "-").replace(/^UTC/, "").replace(":", ".") || 0) };
    })
    .sort((a, b) => a.key - b.key || a.id.localeCompare(b.id))
    .map((z) => ({ value: z.id, label: z.label }));
}

// Saves the zone (cookie + account), then re-renders server components with it.
export function TimeZonePicker() {
  const tz = useTimeZone();
  const t = useT();
  const router = useRouter();
  const [, start] = useTransition();
  const options = useMemo(() => zoneOptions(tz), [tz]);
  return (
    <div className="lang-switch tz-switch">
      <Dropdown key={tz} name="tz" label={t.common.timeZone} defaultValue={tz} leading={<Clock />} options={options}
        searchable searchPlaceholder={t.common.timeZoneSearch}
        onChange={(v) => start(async () => { await setTimeZone(v); router.refresh(); })} />
    </div>
  );
}
