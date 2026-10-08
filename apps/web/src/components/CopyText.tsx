"use client";

import { useT } from "@/i18n/client";
import { toast } from "./Toaster";

// Shortened value (e.g. an address) or a name for it that copies the full text on click and
// confirms with a toast. `name` = show the display as a label (UI font, bold) instead of mono.
export function CopyText({ text, display, name = false }: { text: string; display: string; name?: boolean }) {
  const t = useT();
  return (
    <button type="button" className={`copy-text${name ? " copy-text-name" : " mono"}`} title={`${text}\n${t.common.clickToCopy}`}
      aria-label={`${t.common.copy} ${text}`}
      onClick={async () => { await navigator.clipboard.writeText(text); toast(t.common.copied); }}>
      <span>{display}</span>
      <svg className="copy-text-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /><path d="M10.5 5.5V4a1.5 1.5 0 00-1.5-1.5H4A1.5 1.5 0 002.5 4v5A1.5 1.5 0 004 10.5h1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>
    </button>
  );
}
