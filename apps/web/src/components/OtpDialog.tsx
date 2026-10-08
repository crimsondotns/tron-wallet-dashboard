"use client";

import { fmt } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const LEN = 6;
const RESEND_SEC = 60;

// Email OTP step-up: sends a 6-digit code to the signed-in user's email and verifies it.
// A verified code refreshes the session with an "otp" entry in its `amr`, which the database
// checks before revealing secrets.
export function OtpDialog({ open, email, onClose, onVerified }: { open: boolean; email: string; onClose: () => void; onVerified: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const [phase, setPhase] = useState<"send" | "code">("send");
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setPhase("send"); setDigits(Array(LEN).fill("")); setError("");
      d.showModal();
      d.focus();
      document.documentElement.classList.add("modal-open");
    } else if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!cooldown) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = async () => {
    setBusy(true); setError("");
    const { error } = await createClient().auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    setBusy(false);
    if (error) { setError(error.status === 429 ? t.otp.errTooMany : error.message); return; }
    setPhase("code"); setCooldown(RESEND_SEC);
    setTimeout(() => boxes.current[0]?.focus(), 50);
  };

  const verify = async (code: string) => {
    setBusy(true); setError("");
    const { error } = await createClient().auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (error) {
      setError(/expired/i.test(error.message) ? t.otp.errExpired : t.otp.errWrong);
      setDigits(Array(LEN).fill(""));
      boxes.current[0]?.focus();
      return;
    }
    ref.current?.close();
    onVerified();
  };

  const setAt = (i: number, v: string) => {
    const clean = v.replace(/\D/g, "");
    if (!clean) { setDigits((d) => d.map((x, j) => (j === i ? "" : x))); return; }
    // Typing one digit advances; pasting fills from this box onward.
    const next = [...digits];
    clean.slice(0, LEN - i).split("").forEach((c, k) => { next[i + k] = c; });
    setDigits(next);
    const filled = Math.min(LEN - 1, i + clean.length);
    boxes.current[filled]?.focus();
    if (next.every(Boolean)) verify(next.join(""));
  };

  return (
    <dialog
      ref={ref}
      className="confirm"
      tabIndex={-1}
      aria-labelledby="otp-title"
      onClose={() => { document.documentElement.classList.remove("modal-open"); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}
    >
      <div className="confirm-body">
        <h2 id="otp-title">{t.otp.title}</h2>
        {phase === "send" ? (
          <>
            <p className="subdued small">{rich(t.otp.sendBody, { email: <strong className="in">{email}</strong> })}</p>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="confirm-actions">
              <button type="button" className="btn-tertiary" onClick={() => ref.current?.close()}>{t.common.cancel}</button>
              <button type="button" className="btn-primary" onClick={send} disabled={busy}>{busy ? t.otp.sending : t.otp.send}</button>
            </div>
          </>
        ) : (
          <>
            <p className="subdued small">{rich(t.otp.codeBody, { email: <strong className="in">{email}</strong> })}</p>
            <div className="otp" role="group" aria-label={t.otp.group}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { boxes.current[i] = el; }}
                  className="otp-box"
                  inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  maxLength={LEN}
                  value={d}
                  disabled={busy}
                  aria-label={fmt(t.otp.digit, { n: i + 1 })}
                  onChange={(e) => setAt(i, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus();
                    if (e.key === "ArrowLeft" && i > 0) boxes.current[i - 1]?.focus();
                    if (e.key === "ArrowRight" && i < LEN - 1) boxes.current[i + 1]?.focus();
                  }}
                />
              ))}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <div className="confirm-actions">
              <button type="button" className="btn-ghost" onClick={send} disabled={busy || cooldown > 0}>
                {cooldown > 0 ? fmt(t.otp.resendIn, { n: cooldown }) : t.otp.resend}
              </button>
              <button type="button" className="btn-primary" onClick={() => verify(digits.join(""))} disabled={busy || !digits.every(Boolean)}>
                {busy ? t.otp.verifying : t.otp.verify}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
