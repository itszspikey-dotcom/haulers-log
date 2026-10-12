import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Info } from "lucide-react";
import { Header } from "./components/Header";
import { ContractsPanel } from "./components/ContractsPanel";
import { RoutePanel } from "./components/RoutePanel";
import { ShipPanel } from "./components/ShipPanel";
import { FlightView } from "./components/FlightView";
import { FleetDialog } from "./components/FleetDialog";
import { RunsDialog } from "./components/RunsDialog";
import { Toasts } from "./components/ui";
import { useData } from "./state/data";
import { useStore } from "./state/store";
import { useAutoPlanner } from "./state/planner";
import { importImages } from "./state/importer";

function Background() {
  const stars = useMemo(() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 80 }, () => ({
      left: `${(rnd() * 100).toFixed(2)}%`, top: `${(rnd() * 100).toFixed(2)}%`,
      size: rnd() < 0.85 ? 1 : 2, dur: `${(3 + rnd() * 5).toFixed(1)}s`, delay: `${(-rnd() * 6).toFixed(1)}s`,
    }));
  }, []);
  return (
    <div className="bg" aria-hidden="true">
      <div className="blob a" /><div className="blob b" /><div className="blob c" />
      {stars.map((s, i) => (
        <span key={i} className="star" style={{ left: s.left, top: s.top, width: s.size, height: s.size, animationDuration: s.dur, animationDelay: s.delay }} />
      ))}
    </div>
  );
}

export default function App() {
  const load = useData((d) => d.load);
  const status = useData((d) => d.status);
  const placesSource = useData((d) => d.placesSource);
  const error = useData((d) => d.error);
  const view = useStore((s) => s.view);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [runsOpen, setRunsOpen] = useState(false);

  useEffect(() => { load(); }, [load]);
  useAutoPlanner();

  // Paste screenshots anywhere
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!useData.getState().status?.gemini) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const imgs = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith("image/")).map((i) => i.getAsFile()).filter(Boolean) as File[];
      if (imgs.length) { e.preventDefault(); importImages(imgs); useStore.getState().setView("plan"); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <Background />
      <div className="app">
        <Header onOpenFleet={() => setFleetOpen(true)} onOpenRuns={() => setRunsOpen(true)} />

        {error && <div className="banner warn" role="alert"><Info size={16} /> {error}</div>}
        {!error && placesSource === "demo" && (
          <div className="banner info"><Info size={16} style={{ flex: "none" }} />
            Demo mode: a small set of Stanton locations with approximate distances. Add a UEX_TOKEN on the server for every real location, distance and ship.
          </div>
        )}
        {status && !status.gemini && (
          <div className="banner info"><Info size={16} style={{ flex: "none" }} />
            Screenshot reading is off (no GEMINI_API_KEY on the server). You can still type contracts in.
          </div>
        )}

        <AnimatePresence mode="wait">
          {view === "plan" ? (
            <motion.main key="plan" className="cols" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <ContractsPanel />
              <RoutePanel />
              <ShipPanel onOpenFleet={() => setFleetOpen(true)} />
            </motion.main>
          ) : (
            <motion.main key="fly" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
              <FlightView />
            </motion.main>
          )}
        </AnimatePresence>
      </div>
      <FleetDialog open={fleetOpen} onClose={() => setFleetOpen(false)} />
      <RunsDialog open={runsOpen} onClose={() => setRunsOpen(false)} />
      <Toasts />
    </MotionConfig>
  );
}
