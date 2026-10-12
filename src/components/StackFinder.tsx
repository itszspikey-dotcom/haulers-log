import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, Layers, Loader2, X } from "lucide-react";
import { useStore } from "../state/store";
import { toOptimizerContracts, useDistanceFn, useSelectedShip, usePlanStore } from "../state/planner";
import { findBestStack, type StackPick } from "../lib/stackFinder";
import type { LocationInfo } from "../lib/shipAdvisor";
import { fmt, gm } from "../lib/format";
import { toast } from "./ui";

/** "Which contracts should I take?" — picks the best set to stack from everything on the list. */
export function StackFinder() {
  const contracts = useStore((s) => s.contracts);
  const start = useStore((s) => s.start);
  const returnToStart = useStore((s) => s.returnToStart);
  const pads = useStore((s) => s.padOverrides);
  const update = useStore((s) => s.updateContract);
  const ship = useSelectedShip();
  const dist = useDistanceFn();
  const fetching = usePlanStore((s) => s.fetchingDistances);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<StackPick | null>(null);

  const candidates = useMemo(() => toOptimizerContracts(contracts.map((c) => ({ ...c, enabled: true }))), [contracts]);
  if (candidates.length < 2 && !pick) return null;

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      const info: Record<string, LocationInfo> = {};
      for (const [k, v] of Object.entries(pads)) info[k] = { maxPad: v };
      const r = findBestStack(candidates, ship, dist, { start: start ?? undefined, returnToStart, locationInfo: info });
      setPick(r);
      setBusy(false);
      if (!r) toast(ship ? `None of these contracts work with your ${ship.name}` : "Couldn't find a stack");
    }, 30);
  };

  const apply = () => {
    if (!pick) return;
    for (const c of contracts) {
      const want = pick.chosen.includes(c.id);
      if (c.enabled !== want) update(c.id, { enabled: want });
    }
    toast(`Stack set: ${pick.chosen.length} contracts switched on`);
    setPick(null);
  };

  const title = (id: string) => contracts.find((c) => c.id === id)?.title ?? id;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!pick && (
        <button className="btn white shimmer" onClick={run} disabled={busy || fetching} style={{ width: "100%" }}>
          {busy || fetching ? <Loader2 size={16} className="spin" /> : <Layers size={16} />}
          {busy ? "Finding the best stack…" : fetching ? "Loading distances…" : "Which ones should I take?"}
        </button>
      )}

      <AnimatePresence>
        {pick && (
          <motion.div className="glass beam" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="eyebrow" style={{ color: "var(--cyan)" }}>Best stack{ship ? ` for your ${ship.name}` : ""}</div>
                <div className="display" style={{ fontWeight: 700, fontSize: 22, marginTop: 2 }}>
                  Take {pick.chosen.length} of {candidates.length}
                </div>
              </div>
              <button className="icon-btn ghost" onClick={() => setPick(null)} aria-label="Close"><X size={16} /></button>
            </div>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <div><div className="stat-value" style={{ color: "var(--gold)", fontSize: 19 }}>{fmt(pick.payout)}</div><div className="stat-label">aUEC</div></div>
              <div><div className="stat-value" style={{ fontSize: 19 }}>~{fmt(pick.minutes)} min</div><div className="stat-label">{gm(pick.plan.totalDistance)} Gm</div></div>
              <div><div className="stat-value" style={{ fontSize: 19 }}>{fmt(Math.round(pick.perHour / 1000))}k</div><div className="stat-label">aUEC / hour</div></div>
            </div>

            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>{pick.why}</p>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {pick.chosen.map((id) => (
                <div key={id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                  <Check size={15} color="var(--green)" style={{ flex: "none" }} />
                  <span className="contract-id">{id}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title(id)}</span>
                </div>
              ))}
              {pick.skipped.map((s) => (
                <div key={s.contractId} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13 }} className="muted">
                  <X size={15} color="var(--red)" style={{ flex: "none", marginTop: 2 }} />
                  <span><span className="contract-id">{s.contractId}</span>Skip: {s.reason}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn white" style={{ flex: 1 }} onClick={apply}>Use this stack</button>
              <button className="btn quiet" onClick={() => setPick(null)}>Not now</button>
            </div>
            <div className="faint" style={{ fontSize: 11 }}>Time is an estimate: quantum travel plus about 4 minutes per stop.</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
