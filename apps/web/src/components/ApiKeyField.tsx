"use client";

import { fmt } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { useEffect, useState } from "react";
import { deleteApiKey } from "@/app/connections/actions";
import { createClient } from "@/lib/supabase/client";
import { ConfirmDialog } from "./ConfirmDialog";
import { OtpDialog } from "./OtpDialog";
import { toast } from "./Toaster";

const VISIBLE_SEC = 60;

const Eye = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
    <path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    {off && <path d="M3.5 3.5l13 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />}
  </svg>
);

// Saved API key: masked by default. Showing it needs a fresh email OTP (enforced in the DB by
// reveal_api_key); once shown it can be copied, and it hides itself again after a minute.
export function ApiKeyField({ chain, email }: { chain: string; email: string }) {
  const t = useT();
  const [key, setKey] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [otp, setOtp] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => {
      if (left <= 1) setKey(null); // auto-hide
      setLeft((s) => s - 1);
    }, 1000);
    return () => clearTimeout(t);
  }, [key, left]);

  const reveal = async () => {
    setBusy(true); setError("");
    const { data, error } = await createClient().rpc("reveal_api_key", { p_chain: chain });
    setBusy(false);
    if (error?.code === "P0401") { setOtp(true); return; }
    if (error) { setError(error.code === "42501" ? t.key.adminOnly : error.message); return; }
    setKey(data ?? ""); setLeft(VISIBLE_SEC);
  };

  const toggle = () => (key ? setKey(null) : reveal());
  const copy = async () => {
    if (!key) return;
    await navigator.clipboard.writeText(key);
    toast(t.common.copied);
  };

  return (
    <div className="stack-sm">
      <div className={`secret${key ? " is-shown" : ""}`}>
        <span className="secret-value mono" aria-live="polite">{key ?? "••••••••••••••••••••••••"}</span>
        {key && <span className="caption subdued secret-timer">{fmt(t.key.hideIn, { n: left })}</span>}
        <div className="secret-actions">
          <button type="button" className="icon-btn" onClick={toggle} disabled={busy} aria-pressed={!!key} aria-label={key ? t.key.hideAria : t.key.showAria} title={key ? t.key.hide : t.key.show}>
            <Eye off={!!key} />
          </button>
          {key && (
            <button type="button" className="icon-btn" onClick={copy} aria-label={t.key.copyAria} title={t.common.copy}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><rect x="7" y="7" width="9" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M13 7V5.5A1.5 1.5 0 0011.5 4h-6A1.5 1.5 0 004 5.5v6A1.5 1.5 0 005.5 13H7" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
            </button>
          )}
          {key && (
            <button type="button" className="icon-btn icon-danger" onClick={() => setConfirmDelete(true)} aria-label={t.key.deleteAria} title={t.common.delete}>
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          )}
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <OtpDialog open={otp} email={email} onClose={() => setOtp(false)} onVerified={() => { setOtp(false); reveal(); }} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t.key.deleteTitle}
        body={t.key.deleteBody}
        confirmLabel={t.key.deleteConfirm}
        danger
        action={deleteApiKey}
        fields={{ chain_id: chain }}
      />
    </div>
  );
}
