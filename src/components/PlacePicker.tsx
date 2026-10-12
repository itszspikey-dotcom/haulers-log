import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useData } from "../state/data";
import { searchPlaces } from "../lib/match";
import type { Place } from "../../shared/api";

const sub = (p: Place) => [p.body, p.system].filter(Boolean).join(" · ");

/** Searchable location field. `ok=false` shows the value as unmatched (orange). */
export function PlacePicker({
  value, ok = true, raw, onPick, placeholder = "Search location", label, className = "",
}: {
  value: string;
  ok?: boolean;
  raw?: string;
  onPick: (place: Place | null) => void;
  placeholder?: string;
  label: string;
  className?: string;
}) {
  const places = useData((d) => d.places);
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setQ(value), [value]);
  const results = useMemo(() => (open ? searchPlaces(q === value && ok ? "" : q, places, 8) : []), [open, q, value, ok, places]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const pick = (p: Place) => {
    onPick(p);
    setQ(p.name);
    setOpen(false);
  };

  return (
    <div className={`combo ${className}`} ref={wrap}>
      <input
        className={`input ${ok ? "" : "warn"}`}
        value={q}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        title={!ok && raw ? `Read from screenshot: "${raw}"` : undefined}
        onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && results[active]) { e.preventDefault(); pick(results[active]); }
          else if (e.key === "Escape") { setOpen(false); setQ(value); }
        }}
      />
      {open && results.length > 0 && (
        <div className="combo-list" id={listId} role="listbox">
          {results.map((p, i) => (
            <button
              key={p.name} type="button" role="option" aria-selected={i === active} className="combo-item"
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)} onMouseEnter={() => setActive(i)}
            >
              <span>{p.name}</span>
              <small>{sub(p)}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
