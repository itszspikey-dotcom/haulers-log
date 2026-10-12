import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowDown, ArrowUp, Info, Loader2, Sparkles } from "lucide-react";
import type { RoutePlan } from "../lib/optimizer";
import { usePlanStore, useSelectedShip } from "../state/planner";
import { useStore } from "../state/store";
import { useData } from "../state/data";
import { demoStack } from "../state/demo";
import { crates, gm } from "../lib/format";
import { placeIndex } from "../state/planner";

export function RoutePanel() {
  const plan = usePlanStore((s) => s.plan);
  const computing = usePlanStore((s) => s.computing);
  const fetching = usePlanStore((s) => s.fetchingDistances);
  const contracts = useStore((s) => s.contracts);
  const ship = useSelectedShip();

  const payout = useMemo(
    () => contracts.filter((c) => c.enabled).reduce((n, c) => n + (c.payout || 0), 0),
    [contracts]
  );

  if (!plan || !plan.stops.length) {
    return (
      <section className="col-mid" aria-label="Route">
        <EmptyRoute busy={computing || fetching} hasContracts={contracts.length > 0} />
      </section>
    );
  }

  const perGm = plan.totalDistance > 0 ? Math.round(payout / plan.totalDistance) : 0;
  const capacity = ship?.scu ?? plan.capacity;

  return (
    <section className="col-mid" aria-label="Route">
      <div className="hero" style={{ padding: "0 4px" }}>
        <div className="eyebrow" style={{ color: "var(--cyan)", display: "flex", alignItems: "center", gap: 8 }}>
          Your route
          {(computing || fetching) && <Loader2 size={13} className="spin" aria-label="Updating" />}
        </div>
        <h1>
          <NumberFlow value={plan.stops.length} /> stops, <NumberFlow value={plan.totalDistance} format={{ maximumFractionDigits: plan.totalDistance >= 10 ? 1 : 2 }} /> Gm
        </h1>
        <div className="stats">
          <Stat value={payout} label="aUEC payout" color="var(--gold)" />
          <Stat value={perGm} label="aUEC per Gm" />
          <Stat value={plan.totalScu} suffix=" SCU" label="cargo moved" />
          <Stat value={plan.peakScu} suffix={` / ${capacity}`} label="peak on board" color={plan.peakScu / capacity > 0.85 ? "var(--orange)" : undefined} />
        </div>
      </div>

      {plan.warnings.length > 0 && (
        <div className="banner warn" role="status">
          <Info size={16} style={{ flex: "none" }} />
          <span>{plan.warnings.join(" ")}</span>
        </div>
      )}

      <CargoChart plan={plan} capacity={capacity} />
      <StopList plan={plan} />
    </section>
  );
}

function Stat({ value, label, color, suffix }: { value: number; label: string; color?: string; suffix?: string }) {
  return (
    <div>
      <div className="stat-value" style={{ color }}>
        <NumberFlow value={value} format={{ maximumFractionDigits: 0 }} suffix={suffix} />
      </div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function CargoChart({ plan, capacity }: { plan: RoutePlan; capacity: number }) {
  const W = 600, H = 120, TOP = 10, BOT = 110;
  const n = plan.stops.length;
  const step = W / n;
  const maxV = Math.max(capacity, plan.peakScu, 1);
  const y = (v: number) => BOT - (v / maxV) * (BOT - TOP);
  let d = "";
  plan.stops.forEach((s, i) => {
    const x0 = i * step, x1 = (i + 1) * step;
    d += `${i === 0 ? "M" : "L"}${x0} ${y(s.scuAfter)} L${x1} ${y(s.scuAfter)} `;
  });
  const peakIdx = plan.stops.findIndex((s) => s.scuAfter === plan.peakScu);
  const capY = y(capacity);
  const key = plan.stops.map((s) => s.scuAfter).join(",");

  return (
    <figure className="glass chart">
      <figcaption style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }} className="muted">
        <span style={{ fontWeight: 600, color: "var(--text)" }}>Cargo on board</span>
        <span>{capacity} SCU hold</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" style={{ display: "block", marginTop: 10, overflow: "visible" }}
        aria-label={`SCU on board after each stop: ${plan.stops.map((s) => s.scuAfter).join(", ")}`}>
        <line x1="0" y1={capY} x2={W} y2={capY} stroke="rgba(255,159,10,0.5)" strokeDasharray="3 5" />
        <motion.path key={`f${key}`} d={`${d} L${W} ${BOT} L0 ${BOT} Z`} fill="rgba(100,210,255,0.14)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.5 }} />
        <motion.path key={`l${key}`} d={d} fill="none" stroke="var(--cyan)" strokeWidth={2.5} strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: [0.3, 0.7, 0.2, 1] }} />
        {peakIdx >= 0 && plan.peakScu > 0 && (
          <g>
            <motion.circle cx={(peakIdx + 0.5) * step} cy={y(plan.peakScu)} r={5} fill="none" stroke="var(--orange)" strokeWidth={2}
              animate={{ r: [5, 18], opacity: [0.9, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 1.4 }} />
            <circle cx={(peakIdx + 0.5) * step} cy={y(plan.peakScu)} r={5} fill="var(--orange)" />
          </g>
        )}
      </svg>
      <div className="chart-labels" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {plan.stops.map((s) => (
          <div key={s.index}>
            <span className="mono" style={{ color: s.scuAfter / capacity > 0.85 ? "var(--orange)" : "var(--text)" }}>{s.scuAfter}</span>
            {n <= 12 && <><br />Stop {s.index}</>}
          </div>
        ))}
      </div>
    </figure>
  );
}

function StopList({ plan }: { plan: RoutePlan }) {
  const places = useData((d) => d.places);
  const byName = useMemo(() => placeIndex(places), [places]);
  const ship = useSelectedShip();
  const capacity = ship?.scu ?? plan.capacity;
  return (
    <ol className="glass stops">
      <AnimatePresence initial={true}>
        {plan.stops.map((s, i) => {
          const p = byName.get(s.location);
          return (
            <motion.li
              key={`${s.index}-${s.location}`}
              layout
              className="stop"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: Math.min(i * 0.06, 0.6), ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="stop-num">{s.index}</div>
              <div style={{ minWidth: 0 }}>
                <div className="stop-name">{s.location}</div>
                <div className="muted" style={{ fontSize: 13 }}>{p ? [p.body, p.kind !== "other" ? p.kind : ""].filter(Boolean).join(" · ") : ""}</div>
              </div>
              <div className="muted" style={{ fontSize: 13, textAlign: "right" }}>
                {i === 0 && s.legDistance === 0 ? "Start" : `${gm(s.legDistance)} Gm`}
                <div className="mono" style={{ marginTop: 2, color: s.scuAfter / capacity > 0.85 ? "var(--orange)" : "rgba(235,240,245,0.75)" }}>
                  {s.scuAfter} SCU
                </div>
              </div>
              <div className="stop-actions">
                {s.actions.map((a) => (
                  <span key={`${a.type}${a.partId}`} className={`action ${a.type}`}>
                    {a.type === "load" ? <ArrowUp size={14} strokeWidth={2.4} /> : <ArrowDown size={14} strokeWidth={2.4} />}
                    <span>{a.type === "load" ? "Load" : "Unload"} <b style={{ fontWeight: 600 }}>{a.scu}</b> {a.commodity}</span>
                    <span className="meta">{a.contractId} · {crates(a.crates)}</span>
                  </span>
                ))}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function EmptyRoute({ busy, hasContracts }: { busy: boolean; hasContracts: boolean }) {
  const places = useData((d) => d.places);
  const add = useStore((s) => s.addContracts);
  return (
    <motion.div className="glass empty" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      {busy ? (
        <>
          <Loader2 size={28} className="spin" color="var(--cyan)" />
          <h3>Planning your route…</h3>
        </>
      ) : hasContracts ? (
        <>
          <Info size={28} color="var(--orange)" />
          <h3>Almost there</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 380 }}>
            Switch a contract on, or fix the locations and SCU marked in orange, and the route appears here.
          </p>
        </>
      ) : (
        <>
          <Sparkles size={28} color="var(--cyan)" />
          <h3>Your route appears here</h3>
          <p className="muted" style={{ margin: 0, maxWidth: 420 }}>
            Add contract screenshots on the left. The best order of stops, what to load and unload where, and the right ship update live as you go.
          </p>
          <button className="pill" style={{ marginTop: 6 }} disabled={!places.length} onClick={() => add(demoStack(places))}>
            Try an example stack
          </button>
        </>
      )}
    </motion.div>
  );
}
