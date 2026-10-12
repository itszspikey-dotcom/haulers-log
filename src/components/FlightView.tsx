import { useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, PartyPopper, RotateCcw } from "lucide-react";
import { usePlanStore, useSelectedShip, placeIndex } from "../state/planner";
import { useStore } from "../state/store";
import { useData } from "../state/data";
import { crates, fmt, gm } from "../lib/format";
import { Ring } from "./ui";

export function FlightView() {
  const plan = usePlanStore((s) => s.plan);
  const flight = useStore((s) => s.flight);
  const setFlight = useStore((s) => s.setFlight);
  const setView = useStore((s) => s.setView);
  const contracts = useStore((s) => s.contracts);
  const clear = useStore((s) => s.clearContracts);
  const places = useData((d) => d.places);
  const byName = useMemo(() => placeIndex(places), [places]);
  const ship = useSelectedShip();

  const signature = useMemo(
    () => plan?.stops.map((s) => `${s.location}:${s.actions.map((a) => a.type[0] + a.partId).join("+")}`).join("|") ?? "",
    [plan]
  );
  useEffect(() => {
    if (signature && flight.signature !== signature) setFlight({ signature, done: {}, stop: 0 });
  }, [signature, flight.signature, setFlight]);

  if (!plan || !plan.stops.length) {
    return (
      <div className="glass empty" style={{ minHeight: 400 }}>
        <h3>Nothing to fly yet</h3>
        <p className="muted" style={{ margin: 0 }}>Add contracts in Plan mode first.</p>
        <button className="pill" onClick={() => setView("plan")}><ArrowLeft size={15} /> Back to planning</button>
      </div>
    );
  }

  const idx = Math.min(flight.stop, plan.stops.length);
  const finished = idx >= plan.stops.length;
  const capacity = ship?.scu ?? plan.capacity;
  const payout = contracts.filter((c) => c.enabled).reduce((n, c) => n + c.payout, 0);

  const toggle = (key: string) => setFlight({ ...flight, signature, done: { ...flight.done, [key]: !flight.done[key] } });
  const advance = () => {
    const s = plan.stops[idx];
    const done = { ...flight.done };
    s.actions.forEach((a) => (done[`${idx}:${a.type}:${a.partId}`] = true));
    setFlight({ signature, done, stop: idx + 1 });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const back = () => setFlight({ ...flight, signature, stop: Math.max(0, idx - 1) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, justifyContent: "flex-end" }}>
        <div className="progress" aria-label={`Stop ${Math.min(idx + 1, plan.stops.length)} of ${plan.stops.length}`}>
          {plan.stops.map((_, i) => (
            <span key={i} className={i === idx ? "glow" : ""}
              style={{ width: i === idx ? 28 : 8, background: i === idx ? "var(--cyan)" : i < idx ? "rgba(235,240,245,0.55)" : "rgba(255,255,255,0.16)" }} />
          ))}
        </div>
        <span className="muted" style={{ fontSize: 15 }}>
          {finished ? "Run complete" : `Stop ${idx + 1} of ${plan.stops.length}`}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {finished ? (
          <motion.section key="done" className="glass beam flight-main" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 14 }}
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
            <PartyPopper size={44} color="var(--gold)" />
            <h1 className="flight-loc" style={{ fontSize: 56 }}>Run complete</h1>
            <div className="display" style={{ fontSize: 32, color: "var(--gold)" }}>
              <NumberFlow value={payout} /> <span style={{ fontSize: 18 }} className="muted">aUEC earned</span>
            </div>
            <p className="muted" style={{ margin: 0 }}>{plan.stops.length} stops · {gm(plan.totalDistance)} Gm · {fmt(plan.totalScu)} SCU moved</p>
            <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
              <button className="btn quiet" onClick={back}><RotateCcw size={16} /> Last stop</button>
              <button className="btn white" onClick={() => { clear(); setView("plan"); }}>Start a new stack</button>
            </div>
          </motion.section>
        ) : (
          <motion.div key={idx} className="flight" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}>
            <CurrentStop idx={idx} byName={byName} done={flight.done} onToggle={toggle} onAdvance={advance} onBack={idx > 0 ? back : undefined} />
            <aside className="flight-side">
              <div className="glass" style={{ borderRadius: 30, padding: 24, display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div className="eyebrow" style={{ alignSelf: "flex-start" }}>Leaving with</div>
                <div style={{ marginTop: 8 }}>
                  <Ring value={plan.stops[idx].scuAfter} max={capacity} size={170} stroke={16}
                    color={plan.stops[idx].scuAfter / capacity > 0.85 ? "var(--orange)" : "var(--cyan)"}
                    track="rgba(100,210,255,0.16)" label={`${plan.stops[idx].scuAfter} of ${capacity} SCU on board when leaving`}>
                    <div className="display" style={{ fontWeight: 700, fontSize: 42, lineHeight: 1 }}><NumberFlow value={plan.stops[idx].scuAfter} /></div>
                    <div className="muted" style={{ fontSize: 13 }}>of {capacity} SCU</div>
                  </Ring>
                </div>
              </div>
              <div className="glass" style={{ borderRadius: 30, padding: 8, flex: 1 }}>
                <div className="eyebrow" style={{ padding: "14px 16px 6px" }}>Up next</div>
                {plan.stops.slice(idx + 1, idx + 6).map((s, i) => (
                  <motion.div key={s.index} className="list-row" style={{ background: i === 0 ? "rgba(100,210,255,0.1)" : undefined }}
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + i * 0.07 }}>
                    <span className="stop-num" style={{ width: 32, height: 32 }}>{s.index}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="display" style={{ fontWeight: 600, fontSize: 17, display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.location}</span>
                      <span className="muted" style={{ fontSize: 13 }}>{summary(s.actions)}</span>
                    </span>
                    <span className="mono muted" style={{ fontSize: 13 }}>{gm(s.legDistance)} Gm</span>
                  </motion.div>
                ))}
                {idx + 1 >= plan.stops.length && <p className="muted" style={{ padding: "6px 16px" }}>This is the last stop.</p>}
              </div>
            </aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function summary(actions: { type: string; scu: number }[]) {
  const u = actions.filter((a) => a.type === "unload").reduce((n, a) => n + a.scu, 0);
  const l = actions.filter((a) => a.type === "load").reduce((n, a) => n + a.scu, 0);
  return [u ? `Unload ${u}` : "", l ? `Load ${l}` : ""].filter(Boolean).join(" · ");
}

function CurrentStop({
  idx, byName, done, onToggle, onAdvance, onBack,
}: {
  idx: number;
  byName: Map<string, { body: string; kind: string; hasFreightElevator?: boolean }>;
  done: Record<string, boolean>;
  onToggle: (k: string) => void;
  onAdvance: () => void;
  onBack?: () => void;
}) {
  const plan = usePlanStore((s) => s.plan)!;
  const s = plan.stops[idx];
  const next = plan.stops[idx + 1];
  const p = byName.get(s.location);
  return (
    <section className="glass beam flight-main" aria-label="Current stop">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div className="eyebrow" style={{ color: "var(--cyan)", fontSize: 14 }}>{idx === 0 ? "Start at" : "Fly to"}</div>
        {onBack && <button className="pill small" onClick={onBack}><ArrowLeft size={14} /> Previous</button>}
      </div>
      <h1 className="flight-loc">{s.location}</h1>
      <div className="muted" style={{ fontSize: 18, marginTop: 10 }}>
        {[p?.body, p?.kind !== "other" ? p?.kind : "", s.legDistance ? `${gm(s.legDistance)} Gm away` : ""].filter(Boolean).join(" · ")}
      </div>

      <div style={{ marginTop: 26 }}>
        {s.actions.map((a) => {
          const key = `${idx}:${a.type}:${a.partId}`;
          const isDone = !!done[key];
          const load = a.type === "load";
          return (
            <label key={key} className={`check-row ${isDone ? "done" : ""}`}>
              <input type="checkbox" checked={isDone} onChange={() => onToggle(key)} style={{ accentColor: load ? "var(--cyan)" : "var(--orange)" }} />
              <span className="action-icon" style={{ background: load ? "var(--cyan-soft)" : "var(--orange-soft)", color: load ? "var(--cyan)" : "var(--orange)" }}>
                {load ? <ArrowUp size={24} strokeWidth={2.4} /> : <ArrowDown size={24} strokeWidth={2.4} />}
              </span>
              <span className="big">{load ? "Load" : "Unload"} <b style={{ fontWeight: 600 }}>{a.scu} SCU</b> {a.commodity}</span>
              <span className="mono muted" style={{ fontSize: 16 }}>{a.contractId} · {crates(a.crates)}</span>
            </label>
          );
        })}
      </div>

      <div style={{ minHeight: 28, flex: "1 0 28px" }} />
      <button className="big-btn shimmer" onClick={onAdvance}>
        {next ? <>Done — fly to {next.location}</> : <>Done — finish run</>}
        <ArrowRight size={24} strokeWidth={2.4} />
      </button>
    </section>
  );
}
