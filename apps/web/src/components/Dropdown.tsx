"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChainIcon } from "./ChainIcon";
import { useContainScroll } from "./useContainScroll";

export type DropdownOption = { value: string; label: string; icon?: string };

// Design-system dropdown (replaces native <select>): pill trigger with the chevron
// inside, popover listbox, full keyboard support. Submits through a hidden input.
export function Dropdown({
  name,
  options,
  defaultValue,
  label,
}: {
  name: string;
  options: DropdownOption[];
  defaultValue?: string;
  label: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0]?.value ?? "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  useContainScroll(pop, list, open);
  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    list.current?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    setValue(options[i].value);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const last = options.length - 1;
    if (e.key === "ArrowDown") setActive((a) => Math.min(last, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(last);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") button.current?.focus();
      return;
    } else if (e.key.length === 1) {
      // Type-ahead: jump to the next option starting with that letter.
      const k = e.key.toLowerCase();
      const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const i = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  };

  return (
    <div className="dropdown" ref={root}>
      <input type="hidden" name={name} value={value} />
      <button
        ref={button}
        type="button"
        className="input dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${selected?.label}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
      >
        {selected?.icon && <ChainIcon chain={selected.icon} />}
        <span className="dropdown-value">{selected?.label}</span>
        <svg className="dropdown-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // Blur lives on this wrapper: backdrop-filter is dropped on a scrolling element.
        <div className="dropdown-pop" ref={pop}>
        <ul
          ref={list}
          id={`${id}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          aria-activedescendant={`${id}-${active}`}
          className="dropdown-list"
          onKeyDown={onListKey}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-i={i}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "is-active" : undefined}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(i)}
            >
              {o.icon && <ChainIcon chain={o.icon} />}
              <span>{o.label}</span>
              {o.value === value && (
                <svg className="dropdown-check" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                  <path d="M9.47 2.07L11 3.61 4.73 9.93 3.23 8.4 9.47 2.07z" fill="currentColor" />
                  <path d="M1 6.14l1.53-1.54 3.4 3.44-1.53 1.55L1 6.14z" fill="currentColor" />
                </svg>
              )}
            </li>
          ))}
        </ul>
        </div>
      )}
    </div>
  );
}
