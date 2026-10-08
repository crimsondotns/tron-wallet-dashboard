"use client";

import { fmt } from "@/i18n/config";
import { useT } from "@/i18n/client";
import { rich } from "@/i18n/rich";
import { useEffect, useRef, useState } from "react";
import { renameWallet, deleteWallet } from "@/app/actions";
import { ConfirmDialog } from "./ConfirmDialog";
import { requestSync } from "./SyncRunner";
import { useContainScroll } from "./useContainScroll";
import { usePopoverPlacement } from "./usePopoverPlacement";

// Row actions behind a ⋮ button: edit label, delete (both through a dialog).
export function WalletRowMenu({ id, label, display }: { id: string; label: string; display: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"edit" | "delete" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  usePopoverPlacement(menu, open);
  useContainScroll(menu, menu, open);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Escape") { setOpen(false); button.current?.focus(); }
    else if (e.key === "Tab") setOpen(false);
    else return;
    if (e.key !== "Tab") e.preventDefault();
  };
  const pick = (d: "edit" | "delete") => { setOpen(false); setDialog(d); };

  return (
    <div className="row-menu" ref={root}>
      <button ref={button} type="button" className="icon-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label={fmt(t.wallets.manage, { name: display })} onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="3" r="1.5" fill="currentColor" /><circle cx="8" cy="8" r="1.5" fill="currentColor" /><circle cx="8" cy="13" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div ref={menu} role="menu" aria-label={fmt(t.wallets.manage, { name: display })} className="row-menu-pop" onKeyDown={onKey}>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => { setOpen(false); requestSync(id); }}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 01-9.6 3.7M2.5 8a5.5 5.5 0 019.6-3.7M12.5 2v2.6H9.9M3.5 14v-2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{t.sync.syncNow}</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item" onClick={() => pick("edit")}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
            <span>{t.wallets.rename}</span>
          </button>
          <button type="button" role="menuitem" tabIndex={-1} className="menu-item menu-item-danger" onClick={() => pick("delete")}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{t.common.delete}</span>
          </button>
        </div>
      )}
      <ConfirmDialog open={dialog === "edit"} onClose={() => setDialog(null)} title={t.wallets.renameTitle}
        body={<>{t.wallets.renameBody}<input className="input dialog-input" name="label" defaultValue={label} maxLength={80} placeholder={t.wallets.labelPh} aria-label={t.wallets.label} /></>}
        confirmLabel={t.common.save} action={renameWallet} fields={{ id }} />
      <ConfirmDialog open={dialog === "delete"} onClose={() => setDialog(null)} title={t.wallets.deleteTitle}
        body={rich(t.wallets.deleteBody, { name: <strong className="in">{display}</strong> })}
        confirmLabel={t.wallets.deleteConfirm} danger action={deleteWallet} fields={{ id }} />
    </div>
  );
}
