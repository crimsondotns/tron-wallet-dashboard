"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/login/actions";
import { ConfirmDialog } from "./ConfirmDialog";

// Sidebar account button + popover menu (opens upward on desktop, downward on mobile).
export function AccountMenu({ email, plan = "Free" }: { email?: string; plan?: string }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const initial = (email?.[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };

  return (
    <div className="account" ref={root}>
      <button
        ref={button}
        type="button"
        className="account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`บัญชี ${email ?? ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="avatar" aria-hidden="true">{initial}</span>
        <span className="account-text">
          <span className="account-email">{email}</span>
          <span className="account-plan">แพ็กเกจ {plan}</span>
        </span>
        <svg className="account-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M5 6l3-3 3 3M5 10l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div ref={menu} role="menu" aria-label="บัญชี" className="account-menu" onKeyDown={onMenuKey}>
          <div className="account-menu-head">
            <span className="avatar" aria-hidden="true">{initial}</span>
            <span className="account-text">
              <span className="account-email" title={email}>{email}</span>
              <span className="account-plan">แพ็กเกจ {plan}</span>
            </span>
          </div>
          <div className="account-sep" role="separator" />
          <span role="menuitem" aria-disabled="true" className="menu-item" title="เร็ว ๆ นี้">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
            <span>ตั้งค่าบัญชี</span>
            <span className="menu-soon">เร็ว ๆ นี้</span>
          </span>
          <button type="button" role="menuitem" className="menu-item" tabIndex={-1} onClick={() => { setOpen(false); setConfirming(true); }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2.5H3.5a1 1 0 00-1 1v9a1 1 0 001 1H6M10.5 11l3-3-3-3M13.5 8H6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>ออกจากระบบ</span>
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="ออกจากระบบ?"
        body={<>คุณจะต้องเข้าสู่ระบบอีกครั้งด้วย {email}</>}
        confirmLabel="ออกจากระบบ"
        action={signOut}
      />
    </div>
  );
}
