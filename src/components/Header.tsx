import { motion } from "motion/react";
import { ChevronDown, Copy, FolderOpen, MapPin, Play } from "lucide-react";
import { useStore } from "../state/store";
import { usePlanStore, useSelectedShip } from "../state/planner";
import { PlacePicker } from "./PlacePicker";
import { crates, fmt, gm } from "../lib/format";
import { toast } from "./ui";

export function Header({ onOpenFleet, onOpenRuns }: { onOpenFleet: () => void; onOpenRuns: () => void }) {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const start = useStore((s) => s.start);
  const setStart = useStore((s) => s.setStart);
  const returnToStart = useStore((s) => s.returnToStart);
  const setReturn = useStore((s) => s.setReturnToStart);
  const ship = useSelectedShip();
  const plan = usePlanStore((s) => s.plan);

  const copy = async () => {
    if (!plan) return;
    const lines = [
      `**Hauling run** — ${plan.stops.length} stops, ${gm(plan.totalDistance)} Gm${ship ? `, ${ship.name}` : ""}`,
      ...plan.stops.map((s) =>
        `${s.index}. **${s.location}** — ` +
        s.actions.map((a) => `${a.type === "load" ? "⬆ load" : "⬇ unload"} ${a.scu} ${a.commodity} (${a.contractId}, ${crates(a.crates)})`).join("; ") +
        ` → ${fmt(s.scuAfter)} SCU aboard`
      ),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast("Run copied — paste it in Discord");
    } catch {
      toast("Couldn't access the clipboard");
    }
  };

  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.5L12 3l9 4.5-9 4.5-9-4.5z" /><path d="M3 12.5l9 4.5 9-4.5" /><path d="M3 17l9 4 9-4" />
          </svg>
        </div>
        <span className="brand-name">Hauler's Log</span>
      </div>

      <nav className="segmented" aria-label="Mode">
        {(["plan", "fly"] as const).map((v) => (
          <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
            {view === v && <motion.span layoutId="seg" className="thumb" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
            {v === "plan" ? "Plan" : "Fly"}
          </button>
        ))}
      </nav>

      <div className="header-actions">
        {view === "plan" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <MapPin size={15} color="var(--cyan)" aria-hidden="true" />
              <PlacePicker label="Start location" value={start ?? ""} placeholder="Where are you?" onPick={(p) => setStart(p?.name ?? null)} className="start-picker" />
            </div>
            <label className="muted" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={returnToStart} onChange={(e) => setReturn(e.target.checked)} /> Return
            </label>
            <button className="pill" onClick={onOpenFleet}>
              {ship ? ship.name : "Pick ship"} <ChevronDown size={13} strokeWidth={2.4} />
            </button>
            <button className="icon-btn" onClick={copy} disabled={!plan} aria-label="Copy run for Discord" title="Copy run for Discord"><Copy size={16} /></button>
            <button className="icon-btn" onClick={onOpenRuns} aria-label="Saved runs" title="Saved runs"><FolderOpen size={16} /></button>
          </>
        )}
        <button className={`pill primary ${view === "plan" && plan ? "shimmer" : ""}`} disabled={!plan} onClick={() => setView(view === "plan" ? "fly" : "plan")}>
          {view === "plan" ? <><Play size={14} fill="currentColor" /> Start Flight</> : "Back to plan"}
        </button>
      </div>
    </header>
  );
}
