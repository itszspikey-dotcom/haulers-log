import { useMemo, useState } from "react";
import { Check, Search, Star } from "lucide-react";
import { useShips } from "../state/planner";
import { useStore } from "../state/store";
import { useData } from "../state/data";
import { Dialog, toast } from "./ui";

export function FleetDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ships = useShips();
  const shipId = useStore((s) => s.shipId);
  const setShip = useStore((s) => s.setShip);
  const toggleOwned = useStore((s) => s.toggleOwned);
  const overrides = useStore((s) => s.shipOverrides);
  const setOverride = useStore((s) => s.setShipOverride);
  const source = useData((d) => d.shipsSource);
  const [q, setQ] = useState("");
  const [cargoOnly, setCargoOnly] = useState(true);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ships
      .filter((s) => !needle || s.name.toLowerCase().includes(needle))
      .filter((s) => !cargoOnly || s.owned || s.scu >= 20)
      .sort((a, b) => Number(!!b.owned) - Number(!!a.owned) || a.scu - b.scu || a.name.localeCompare(b.name));
  }, [ships, q, cargoOnly]);

  return (
    <Dialog open={open} onClose={onClose} title="Your ships" width={620}>
      <p className="muted" style={{ margin: "0 6px 12px", fontSize: 13 }}>
        Star the ships you own so advice uses them first. Click a ship to fly it.
        {source === "demo" && " (Demo list — add a UEX token on the server for every ship in the game.)"}
      </p>
      <div style={{ display: "flex", gap: 8, margin: "0 6px 10px", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <Search size={15} style={{ position: "absolute", left: 11, top: 12, color: "var(--text-3)" }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search ships" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search ships" />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }} className="muted">
          <input type="checkbox" checked={cargoOnly} onChange={(e) => setCargoOnly(e.target.checked)} /> Haulers only (20+ SCU)
        </label>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {list.map((s) => {
          const ov = overrides[s.id];
          const selected = s.id === shipId;
          return (
            <div key={s.id} className="list-row" style={{ background: selected ? "rgba(100,210,255,0.1)" : undefined }}>
              <button className="icon-btn ghost" onClick={() => toggleOwned(s.id)} aria-pressed={!!s.owned} aria-label={`${s.owned ? "Unmark" : "Mark"} ${s.name} as owned`}>
                <Star size={17} fill={s.owned ? "var(--gold)" : "none"} color={s.owned ? "var(--gold)" : "currentColor"} />
              </button>
              <button
                style={{ flex: 1, minWidth: 0, background: "transparent", border: 0, textAlign: "left", padding: 0 }}
                onClick={() => { setShip(s.id); toast(`Flying the ${s.name}`); onClose(); }}
              >
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {s.name} {selected && <Check size={14} color="var(--cyan)" />}
                </span>
                <span className="muted" style={{ fontSize: 12 }}>
                  {s.containerSizes.length ? `crates ${Math.min(...s.containerSizes)}–${Math.max(...s.containerSizes)} SCU` : "crates unknown"}
                  {s.padSize ? ` · ${s.padSize} pad` : ""}{s.minCrew ? ` · ${s.minCrew}${s.maxCrew && s.maxCrew > s.minCrew ? `–${s.maxCrew}` : ""} crew` : ""}
                </span>
              </button>
              <label style={{ display: "flex", alignItems: "center", gap: 4 }} title="Fix the SCU if the data is wrong after a patch">
                <input
                  className="input mono" style={{ width: 74, minHeight: 32, textAlign: "right", borderColor: ov?.scu ? "var(--cyan)" : undefined }}
                  inputMode="numeric" aria-label={`${s.name} cargo SCU`}
                  value={s.scu}
                  onChange={(e) => {
                    const v = Number(e.target.value.replace(/\D/g, ""));
                    setOverride(s.id, v > 0 ? { ...ov, scu: v } : null);
                  }}
                />
                <span className="muted" style={{ fontSize: 12 }}>SCU</span>
              </label>
            </div>
          );
        })}
        {!list.length && <p className="muted" style={{ textAlign: "center" }}>No ships match.</p>}
      </div>
    </Dialog>
  );
}
