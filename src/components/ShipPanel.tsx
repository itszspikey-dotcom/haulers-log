import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ChevronDown, Rocket, Sparkles, Star } from "lucide-react";
import type { PadSize, ShipVerdict } from "../lib/shipAdvisor";
import { usePlanStore, useSelectedShip } from "../state/planner";
import { useStore } from "../state/store";
import { useData } from "../state/data";
import { fmt, gm } from "../lib/format";
import { Ring, toast } from "./ui";

export function ShipPanel({ onOpenFleet }: { onOpenFleet: () => void }) {
  const ship = useSelectedShip();
  const advice = usePlanStore((s) => s.advice);
  const plan = usePlanStore((s) => s.plan);
  const basePlan = usePlanStore((s) => s.basePlan);
  const tooSmallOwned = usePlanStore((s) => s.tooSmallOwned);
  const setShip = useStore((s) => s.setShip);
  const source = useData((d) => d.shipsSource);
  const status = useData((d) => d.status);

  const mine = ship ? advice?.verdicts.find((v) => v.ship.id === ship.id) : undefined;
  const others = useMemo(() => {
    if (!advice) return [] as ShipVerdict[];
    const fit = advice.verdicts.filter((v) => v.status !== "unfit" && v.ship.id !== ship?.id);
    const ownedFit = fit.filter((v) => v.ship.owned);
    const best = fit.filter((v) => !v.ship.owned).slice(0, 3);
    const ownedUnfit = [...advice.verdicts.filter((v) => v.status === "unfit" && v.ship.owned && v.ship.id !== ship?.id), ...tooSmallOwned];
    return [...ownedFit, ...best, ...ownedUnfit].slice(0, 6);
  }, [advice, ship, tooSmallOwned]);

  return (
    <aside className="col-right" aria-label="Ship and advice">
      {plan ? (
        <ShipCard verdict={mine} onOpenFleet={onOpenFleet} />
      ) : (
        <motion.div className="glass ship-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
          <div className="eyebrow" style={{ alignSelf: "flex-start" }}>Ship</div>
          <Rocket size={34} color="var(--cyan)" style={{ margin: "18px 0 6px" }} />
          <div className="display" style={{ fontWeight: 700, fontSize: 20 }}>{ship?.name ?? "No ship picked"}</div>
          <p className="muted" style={{ margin: "4px 0 12px", fontSize: 13 }}>
            Add contracts and the best ships for the stack show up here.
          </p>
          <button className="pill small" onClick={onOpenFleet}>{ship ? "Change ship" : "Pick your ships"}</button>
        </motion.div>
      )}

      {plan && others.length > 0 && (
        <motion.div className="glass list" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <div className="eyebrow" style={{ padding: "8px 14px 6px" }}>{ship ? "Other ships" : "Best ships for this stack"}</div>
          {others.map((v) => (
            <button key={v.ship.id} className="list-row" onClick={() => { setShip(v.ship.id); toast(`Flying the ${v.ship.name}`); }}>
              <span className="dot" style={{ background: v.status === "unfit" ? "var(--red)" : v.extraLoads > 0 ? "var(--gold)" : "var(--green)" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  {v.ship.name} {v.ship.owned && <Star size={12} fill="var(--gold)" color="var(--gold)" aria-label="yours" />}
                </span>
                <span className="muted" style={{ fontSize: 13, display: "block" }}>{shortReason(v, basePlan?.totalDistance)}</span>
              </span>
              <span className="mono muted" style={{ fontSize: 12 }}>{v.ship.scu}</span>
            </button>
          ))}
        </motion.div>
      )}

      <SmarterStack />
      {plan && <PadEditor />}

      <div className="footer-note">
        {source === "uex" ? "Locations, distances and ships from UEX (uexcorp.space)." : "Using built-in demo data."}
        {status?.gameVersion ? ` Star Citizen ${status.gameVersion}.` : ""} Not affiliated with Cloud Imperium Games.
      </div>
    </aside>
  );
}

function shortReason(v: ShipVerdict, bestGm?: number) {
  if (v.status === "unfit") return v.reasons[0];
  if (v.extraLoads > 0) return `${v.extraLoads} extra pickup run${v.extraLoads > 1 ? "s" : ""} · ${gm(v.plan?.totalDistance ?? 0)} Gm`;
  const spare = v.utilization !== undefined ? Math.round((1 - v.utilization) * 100) : null;
  if (bestGm && v.plan && v.plan.totalDistance > bestGm * 1.03) return `Fits · ${gm(v.plan.totalDistance)} Gm`;
  return spare !== null && spare > 40 ? `Fits easily · ${spare}% spare` : "Fits the whole stack";
}

function ShipCard({ verdict, onOpenFleet }: { verdict?: ShipVerdict; onOpenFleet: () => void }) {
  const ship = useSelectedShip();
  const plan = usePlanStore((s) => s.plan);
  const advice = usePlanStore((s) => s.advice);
  const setShip = useStore((s) => s.setShip);
  if (!plan) return null;

  if (!ship) {
    const best = advice?.best;
    return (
      <motion.div className="glass ship-card beam" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
        <div className="eyebrow" style={{ alignSelf: "flex-start" }}>Recommended ship</div>
        {best ? (
          <>
            <Ring value={best.plan?.peakScu ?? 0} max={best.ship.scu} label={`Peak load ${best.plan?.peakScu} of ${best.ship.scu} SCU`} color="var(--cyan)" track="rgba(100,210,255,0.16)">
              <div className="display" style={{ fontWeight: 700, fontSize: 42, lineHeight: 1 }}><NumberFlow value={best.plan?.peakScu ?? 0} /></div>
              <div className="muted" style={{ fontSize: 13 }}>of {best.ship.scu} SCU peak</div>
            </Ring>
            <div className="display" style={{ fontWeight: 700, fontSize: 22 }}>{best.ship.name}</div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>{best.reasons[0]}</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn white" onClick={() => setShip(best.ship.id)}>Fly this</button>
              <button className="btn quiet" onClick={onOpenFleet}>My ships</button>
            </div>
          </>
        ) : (
          <p className="muted">No ship in the list can carry this stack. Check crate sizes and landing pads.</p>
        )}
      </motion.div>
    );
  }

  const unfit = verdict?.status === "unfit";
  const peak = plan.peakScu;
  const pct = ship.scu ? peak / ship.scu : 0;
  const badge = unfit
    ? <span className="badge red">Won't work</span>
    : verdict?.status === "recommended"
      ? <span className="badge green">Best fit</span>
      : verdict && verdict.extraLoads > 0
        ? <span className="badge yellow">Extra runs</span>
        : <span className="badge cyan">Fits</span>;

  return (
    <motion.div className="glass ship-card beam" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div style={{ alignSelf: "stretch", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="eyebrow">Ship</span>
        {badge}
      </div>
      <div style={{ margin: "10px 0 4px" }}>
        <Ring value={peak} max={ship.scu} label={`Peak load ${peak} of ${ship.scu} SCU`}
          color={unfit ? "var(--red)" : pct > 0.85 ? "var(--orange)" : "var(--cyan)"}
          track={unfit ? "rgba(255,105,97,0.16)" : pct > 0.85 ? "rgba(255,159,10,0.18)" : "rgba(100,210,255,0.16)"}>
          <div className="display" style={{ fontWeight: 700, fontSize: 44, lineHeight: 1 }}><NumberFlow value={peak} /></div>
          <div className="muted" style={{ fontSize: 13 }}>of {fmt(ship.scu)} SCU peak</div>
        </Ring>
      </div>
      <button className="display" onClick={onOpenFleet}
        style={{ fontWeight: 700, fontSize: 22, background: "transparent", border: 0, display: "flex", alignItems: "center", gap: 6 }}>
        {ship.name} <ChevronDown size={18} />
      </button>
      <div className="muted" style={{ fontSize: 13 }}>
        {unfit ? verdict!.reasons[0] : verdict?.reasons[0] ?? ""}
      </div>
      {verdict && verdict.warnings.length > 0 && !unfit && (
        <div style={{ fontSize: 12, color: "var(--orange-text)", marginTop: 6 }}>{verdict.warnings[0]}</div>
      )}
    </motion.div>
  );
}

function SmarterStack() {
  const drops = usePlanStore((s) => s.drops);
  const advice = usePlanStore((s) => s.advice);
  const plan = usePlanStore((s) => s.plan);
  const ship = useSelectedShip();
  const contracts = useStore((s) => s.contracts);
  const toggle = useStore((s) => s.toggleContract);
  const dismissed = useStore((s) => s.dismissedTips);
  const dismiss = useStore((s) => s.dismissTip);

  const tip = useMemo(() => {
    if (!plan || !ship || !drops.length) return null;
    const enabled = contracts.filter((c) => c.enabled);
    const sig = enabled.map((c) => c.id).sort().join(",");
    const payout = enabled.reduce((n, c) => n + c.payout, 0);
    const mine = advice?.verdicts.find((v) => v.ship.id === ship.id);
    const nowPerGm = plan.totalDistance > 0 ? payout / plan.totalDistance : 0;
    for (const d of drops) {
      const key = `${sig}|${d.contractId}`;
      if (dismissed.includes(key)) continue;
      const c = enabled.find((x) => x.id === d.contractId);
      if (!c) continue;
      if (mine?.status === "unfit" && d.fitsAfterDrop)
        return { key, c, text: `Skip ${c.id} “${c.title}” and your ${ship.name} can fly the rest.` };
      if (mine?.status !== "unfit" && d.aUECperGmAfter && nowPerGm > 0 && d.aUECperGmAfter > nowPerGm * 1.5 && d.distanceSaved > plan.totalDistance * 0.3) {
        const payShare = Math.round((c.payout / Math.max(payout, 1)) * 100);
        const distShare = Math.round((d.distanceSaved / plan.totalDistance) * 100);
        const factor = (d.aUECperGmAfter / nowPerGm).toFixed(1);
        return { key, c, text: `“${c.title}” pays ${payShare}% of the total but adds ${distShare}% of the flying. Skip it and you earn ${factor}× more per Gm.` };
      }
    }
    return null;
  }, [drops, advice, plan, ship, contracts, dismissed]);

  return (
    <AnimatePresence>
      {tip && (
        <motion.div key={tip.key} className="glass tip" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ delay: 0.4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="tip-icon"><Sparkles size={18} /></span>
            <span style={{ fontWeight: 600, fontSize: 15 }}>Smarter stack</span>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.5, color: "rgba(245,235,215,0.85)" }}>{tip.text}</p>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn orange" style={{ flex: 1 }} onClick={() => { toggle(tip.c.id); toast(`${tip.c.id} skipped`); }}>Skip it</button>
            <button className="btn quiet" style={{ flex: 1 }} onClick={() => dismiss(tip.key)}>Keep</button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const PADS: PadSize[] = ["XS", "S", "M", "L", "XL"];

function PadEditor() {
  const [open, setOpen] = useState(false);
  const plan = usePlanStore((s) => s.plan);
  const pads = useStore((s) => s.padOverrides);
  const setPad = useStore((s) => s.setPad);
  const names = useMemo(() => [...new Set(plan?.stops.map((s) => s.location) ?? [])], [plan]);
  if (!names.length) return null;
  return (
    <div className="glass" style={{ padding: 6 }}>
      <button className="list-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span style={{ flex: 1 }}>
          <span style={{ fontWeight: 600, display: "block" }}>Landing pads</span>
          <span className="muted" style={{ fontSize: 13 }}>Set the biggest pad at small outposts so big ships get ruled out</span>
        </span>
        <ChevronDown size={16} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} style={{ overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 10px 10px" }}>
              {names.map((n) => (
                <label key={n} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n}</span>
                  <select className="input" style={{ width: 96, minHeight: 32 }} value={pads[n] ?? ""}
                    onChange={(e) => setPad(n, (e.target.value || null) as PadSize | null)}>
                    <option value="">Unknown</option>
                    {PADS.map((p) => <option key={p} value={p}>{p} pad</option>)}
                  </select>
                </label>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
