"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_NAMES, LOCALES } from "@/i18n/config";
import { setLocale } from "@/i18n/actions";
import { useLocale, useT } from "@/i18n/client";
import { Dropdown } from "./Dropdown";

const Globe = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path d="M1.7 8h12.6M8 1.7c1.8 1.8 2.6 3.9 2.6 6.3S9.8 12.5 8 14.3M8 1.7C6.2 3.5 5.4 5.6 5.4 8s.8 4.5 2.6 6.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

// Saves the choice in a cookie, then re-renders server components in the new language.
export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useT();
  const router = useRouter();
  const [, start] = useTransition();
  return (
    <div className="lang-switch">
      <Dropdown key={locale} name="locale" label={t.common.language} defaultValue={locale} leading={<Globe />}
        options={LOCALES.map((l) => ({ value: l, label: LOCALE_NAMES[l] }))}
        onChange={(v) => start(async () => { await setLocale(v); router.refresh(); })} />
    </div>
  );
}
