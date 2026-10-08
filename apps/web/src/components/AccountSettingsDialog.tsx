"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/i18n/client";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { TimeZonePicker } from "./TimeZonePicker";

// Account settings (opened from the account menu). Changes apply immediately, so there is
// only a Close button.
export function AccountSettingsDialog({ open, onClose, email }: { open: boolean; onClose: () => void; email?: string }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus();
      document.documentElement.classList.add("modal-open");
    } else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="confirm settings-dialog" tabIndex={-1} aria-labelledby="settings-title"
      onClose={() => { document.documentElement.classList.remove("modal-open"); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="confirm-body">
        <h2 id="settings-title">{t.account.settings}</h2>
        <dl className="settings-list">
          <div><dt>{t.auth.email}</dt><dd className="subdued">{email}</dd></div>
          <div><dt>{t.common.language}</dt><dd><LanguageSwitcher /></dd></div>
          <div><dt>{t.common.timeZone}</dt><dd><TimeZonePicker /></dd></div>
        </dl>
        <div className="confirm-actions">
          <button type="button" className="btn-tertiary" onClick={() => ref.current?.close()}>{t.common.close}</button>
        </div>
      </div>
    </dialog>
  );
}
