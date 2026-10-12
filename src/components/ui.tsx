import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { create } from "zustand";

// ───────── switch ─────────
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={onChange}>
      <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 34 }} className="knob" />
    </button>
  );
}

// ───────── ring ─────────
export function Ring({
  value, max, size = 190, stroke = 18, color = "var(--orange)", track, children, label,
}: {
  value: number; max: number; size?: number; stroke?: number; color?: string; track?: string; children?: ReactNode; label: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div style={{ position: "relative", width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track ?? "rgba(255,255,255,0.1)"} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.4, ease: [0.3, 0.7, 0.2, 1] }}
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        <div>{children}</div>
      </div>
    </div>
  );
}

// ───────── dialog ─────────
export function Dialog({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input, button")?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div
            ref={ref} className="dialog" role="dialog" aria-modal="true" aria-label={title}
            style={width ? { width: `min(${width}px, 100%)` } : undefined}
            initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="dialog-head">
              <h2>{title}</h2>
              <button className="icon-btn ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </div>
            <div className="dialog-body">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ───────── toasts ─────────
interface ToastState { toasts: { id: number; text: string }[] }
const useToasts = create<ToastState>()(() => ({ toasts: [] }));
let tid = 0;
export function toast(text: string) {
  const id = ++tid;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, text }] }));
  setTimeout(() => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 2800);
}
export function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ───────── animated entrance ─────────
export const rise = (i = 0) => ({
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay: Math.min(i * 0.06, 0.6), ease: [0.2, 0.8, 0.2, 1] as const },
});
