"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChainIcon } from "./ChainIcon";
import { useContainScroll } from "./useContainScroll";
import { usePopoverPlacement } from "./usePopoverPlacement";

export type DropdownOption = { value: string; label: string; icon?: string; iconNode?: React.ReactNode };

// Design-system dropdown (replaces native <select>): pill trigger with the chevron
// inside, popover listbox, full keyboard support. Submits through a hidden input.
export function Dropdown({
  name,
  options,
  defaultValue,
  label,
  onChange,
  leading,
  placeholder,
  searchable,
  searchPlaceholder,
}: {
  name: string;
  options: DropdownOption[];
  defaultValue?: string;
  label: string;
  onChange?: (value: string) => void;
  leading?: React.ReactNode; // icon shown in the trigger before the value
  // With a placeholder the value may be empty: the trigger shows the placeholder, and
  // choosing the selected option again clears it.
  placeholder?: string;
  searchable?: boolean; // search box at the top of the list (long lists)
  searchPlaceholder?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? (placeholder !== undefined ? "" : options[0]?.value ?? ""));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const q = query.trim().toLowerCase();
  // Indexes into `options` that match the search (all when not searching).
  const shown = options.map((o, i) => ({ o, i })).filter(({ o }) => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const id = useId();
  useContainScroll(pop, list, open);
  usePopoverPlacement(pop, open);
  const selected = options.find((o) => o.value === value) ?? (placeholder !== undefined ? undefined : options[0]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    (searchable ? search.current : list.current)?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, searchable]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setQuery("");
    setOpen(true);
  };
  const choose = (i: number) => {
    const next = placeholder !== undefined && options[i].value === value ? "" : options[i].value;
    setValue(next);
    onChange?.(next);
    setOpen(false);
    button.current?.focus();
  };

  const onListKey = (e: React.KeyboardEvent) => {
    // Arrow keys walk the visible (filtered) options.
    const pos = shown.findIndex((x) => x.i === active);
    const at = (p: number) => shown[Math.max(0, Math.min(shown.length - 1, p))]?.i ?? active;
    if (e.key === "ArrowDown") setActive(at(pos + 1));
    else if (e.key === "ArrowUp") setActive(at(pos - 1));
    else if (e.key === "Home" && !searchable) setActive(at(0));
    else if (e.key === "End" && !searchable) setActive(at(shown.length - 1));
    else if (e.key === "Enter" || (e.key === " " && !searchable)) { if (shown.some((x) => x.i === active)) choose(active); }
    else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") button.current?.focus();
      return;
    } else if (e.key.length === 1 && !searchable) {
      // Type-ahead: jump to the next option starting with that letter.
      const k = e.key.toLowerCase();
      const from = options.findIndex((o, i) => i > active && o.label.toLowerCase().startsWith(k));
      const i = from >= 0 ? from : options.findIndex((o) => o.label.toLowerCase().startsWith(k));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
    e.stopPropagation();
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
        aria-label={`${label}: ${selected?.label ?? placeholder ?? ""}`}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            show();
          }
        }}
      >
        {leading}
        {selected?.iconNode ?? (selected?.icon && <ChainIcon chain={selected.icon} />)}
        <span className="dropdown-value">{selected?.label ?? placeholder}</span>
        <svg className="dropdown-chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        // Blur lives on this wrapper: backdrop-filter is dropped on a scrolling element.
        <div className="dropdown-pop" ref={pop}>
        {searchable && (
          <div className="dropdown-search">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            <input ref={search} type="text" value={query} placeholder={searchPlaceholder ?? label} aria-label={searchPlaceholder ?? label}
              aria-controls={`${id}-list`} aria-activedescendant={`${id}-${active}`} autoComplete="off" spellCheck={false}
              onChange={(e) => { setQuery(e.target.value); const v = e.target.value.trim().toLowerCase(); const first = options.findIndex((o) => !v || o.label.toLowerCase().includes(v) || o.value.toLowerCase().includes(v)); if (first >= 0) setActive(first); }}
              onKeyDown={onListKey} />
          </div>
        )}
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
          {searchable && !shown.length && <li className="dropdown-empty" role="presentation">—</li>}
          {shown.map(({ o, i }) => (
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
              {o.iconNode ?? (o.icon && <ChainIcon chain={o.icon} />)}
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
