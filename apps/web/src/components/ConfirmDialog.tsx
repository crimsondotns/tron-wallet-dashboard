"use client";

import { useT } from "@/i18n/client";
import { useEffect, useRef, useState } from "react";

// Modal confirm built on native <dialog> (focus trap, Esc, top layer). Confirm submits
// `action` with the given hidden fields. The page behind does not scroll while open.
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  danger = false,
  action,
  fields = {},
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  action: (form: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus(); // focus the dialog itself: no ring on a button until the user tabs
      document.documentElement.classList.add("modal-open");
    } else if (!open && d.open) d.close();
    return () => document.documentElement.classList.remove("modal-open");
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="confirm"
      tabIndex={-1}
      aria-labelledby="confirm-title"
      onClose={() => {
        document.documentElement.classList.remove("modal-open");
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) ref.current.close(); // click on backdrop
      }}
    >
      <form
        action={async (form) => {
          await action(form);
          ref.current?.close(); // success without a redirect (e.g. rename): close the dialog
        }}
        className="confirm-body"
      >
        {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <h2 id="confirm-title">{title}</h2>
        {body && <div className="subdued small">{body}</div>}
        <div className="confirm-actions">
          <button type="button" className="btn-tertiary" onClick={() => ref.current?.close()}>{t.common.cancel}</button>
          <button className={danger ? "btn-danger" : "btn-primary"}>{confirmLabel}</button>
        </div>
      </form>
    </dialog>
  );
}

// Trigger button + its confirm dialog, for use from server components.
export function ConfirmButton({
  children,
  className,
  ariaLabel,
  ...dialog
}: Omit<React.ComponentProps<typeof ConfirmDialog>, "open" | "onClose"> & {
  children: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} aria-label={ariaLabel} onClick={() => setOpen(true)}>{children}</button>
      <ConfirmDialog {...dialog} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
