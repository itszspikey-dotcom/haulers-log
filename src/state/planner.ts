/**
 * Keeps the route and ship advice in sync with the stack:
 * fetches any missing distances, then re-plans in a Web Worker.
 */
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { Contract, RoutePlan } from "../lib/optimizer";
import type { AdviceResult, DropSuggestion, LocationInfo, Ship, ShipVerdict } from "../lib/shipAdvisor";
import { distKey, type Place } from "../../shared/api";
import { useStore, type AppContract } from "./store";
import { api, useData } from "./data";
import type { PlanJob, PlanResult } from "../lib/computePlan";

interface PlanState {
  plan: RoutePlan | null;
  basePlan: RoutePlan | null;
  advice: AdviceResult | null;
  drops: DropSuggestion[];
  tooSmallOwned: ShipVerdict[];
  computing: boolean;
  fetchingDistances: boolean;
  error: string | null;
  ms: number;
}

export const usePlanStore = create<PlanState>()(() => ({
  plan: null,
  basePlan: null,
  advice: null,
  drops: [],
  tooSmallOwned: [],
  computing: false,
  fetchingDistances: false,
  error: null,
  ms: 0,
}));

/** Ships with the user's overrides and owned flags applied. */
export function useShips(): Ship[] {
  const ships = useData((d) => d.ships);
  const owned = useStore((s) => s.ownedShipIds);
  const overrides = useStore((s) => s.shipOverrides);
  return useMemo(
    () =>
      ships.map((s) => ({
        ...s,
        ...(overrides[s.id] ?? {}),
        owned: owned.includes(s.id),
      })),
    [ships, owned, overrides]
  );
}

export function useSelectedShip(): Ship | null {
  const ships = useShips();
  const id = useStore((s) => s.shipId);
  return useMemo(() => ships.find((s) => s.id === id) ?? null, [ships, id]);
}

export const legReady = (l: AppContract["legs"][number]) => l.pickupOk && l.dropOk && l.scu > 0 && l.pickup !== l.drop;

/** Converts the app's contracts into the optimizer's format (only complete, enabled legs). */
export function toOptimizerContracts(contracts: AppContract[]): Contract[] {
  return contracts
    .filter((c) => c.enabled)
    .map((c) => ({
      id: c.id,
      title: c.title,
      company: c.company,
      payout: c.payout || 0,
      maxContainerSize: c.maxContainerSize || undefined,
      legs: c.legs.filter(legReady).map((l) => ({
        id: l.id, contractId: c.id, pickup: l.pickup, drop: l.drop, commodity: l.commodity || "Cargo", scu: l.scu,
      })),
    }))
    .filter((c) => c.legs.length > 0);
}

export function placeIndex(places: Place[]) {
  const m = new Map<string, Place>();
  for (const p of places) if (!m.has(p.name)) m.set(p.name, p);
  return m;
}

let worker: Worker | null = null;
let jobSeq = 0;
const failedPairs = new Set<string>();

/** Mount once (in App). */
export function useAutoPlanner() {
  const contracts = useStore((s) => s.contracts);
  const start = useStore((s) => s.start);
  const returnToStart = useStore((s) => s.returnToStart);
  const ownedIds = useStore((s) => s.ownedShipIds);
  const padOverrides = useStore((s) => s.padOverrides);
  const distCache = useStore((s) => s.distCache);
  const mergeDistances = useStore((s) => s.mergeDistances);
  const places = useData((d) => d.places);
  const ships = useShips();
  const ship = useSelectedShip();
  const latest = useRef(0);

  const optContracts = useMemo(() => toOptimizerContracts(contracts), [contracts]);
  // Distances are fetched for every contract on the list (switched on or not), so "best stack" can compare them.
  const allContracts = useMemo(() => toOptimizerContracts(contracts.map((c) => ({ ...c, enabled: true }))), [contracts]);
  const byName = useMemo(() => placeIndex(places), [places]);

  // Which places are involved, and which distance pairs are still missing?
  const { placeIds, missing } = useMemo(() => {
    const names = new Set<string>();
    for (const c of allContracts) for (const l of c.legs) { names.add(l.pickup); names.add(l.drop); }
    if (start) names.add(start);
    const ids: Record<string, number> = {};
    for (const n of names) {
      const p = byName.get(n);
      if (p) ids[n] = p.terminalId;
    }
    const list = Object.values(ids);
    const miss: [number, number][] = [];
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const k = distKey(list[i], list[j]);
        if (!(k in distCache) && !failedPairs.has(k)) miss.push([list[i], list[j]]);
      }
    return { placeIds: ids, missing: miss };
  }, [allContracts, start, byName, distCache]);

  // Fetch missing distances
  useEffect(() => {
    if (!missing.length) {
      usePlanStore.setState({ fetchingDistances: false });
      return;
    }
    let cancelled = false;
    usePlanStore.setState({ fetchingDistances: true });
    api
      .distances(missing)
      .then(({ distances }) => {
        if (cancelled) return;
        const known: Record<string, number | null> = {};
        for (const [k, v] of Object.entries(distances)) {
          if (v === null) failedPairs.add(k); // unknown for this session; optimizer falls back
          else known[k] = v;
        }
        for (const [a, b] of missing) if (!(distKey(a, b) in distances)) failedPairs.add(distKey(a, b));
        mergeDistances(known);
        usePlanStore.setState({ fetchingDistances: false });
      })
      .catch(() => {
        for (const [a, b] of missing) failedPairs.add(distKey(a, b));
        if (!cancelled) usePlanStore.setState({ fetchingDistances: false, error: "Couldn't load some distances." });
        mergeDistances({});
      });
    return () => { cancelled = true; };
  }, [missing, mergeDistances]);

  // Re-plan in the worker (debounced)
  useEffect(() => {
    if (missing.length) return; // wait for distances
    if (!optContracts.length) {
      usePlanStore.setState({ plan: null, basePlan: null, advice: null, drops: [], tooSmallOwned: [], computing: false });
      return;
    }
    const locationInfo: Record<string, LocationInfo> = {};
    for (const name of Object.keys(placeIds)) {
      const p = byName.get(name);
      locationInfo[name] = {
        system: p?.system,
        hasLoadingDock: p?.hasLoadingDock,
        maxPad: padOverrides[name],
      };
    }
    const job: PlanJob = {
      id: ++jobSeq,
      contracts: optContracts,
      placeIds,
      distances: distCache,
      start: start && placeIds[start] !== undefined ? start : undefined,
      returnToStart,
      ship,
      ships,
      ownedIds,
      locationInfo,
    };
    latest.current = job.id;
    const t = setTimeout(() => {
      if (!worker) {
        worker = new Worker(new URL("../worker/planner.worker.ts", import.meta.url), { type: "module" });
      }
      worker.onmessage = (e: MessageEvent<PlanResult>) => {
        if (e.data.id !== latest.current) return; // stale
        usePlanStore.setState({
          plan: e.data.plan,
          basePlan: e.data.basePlan,
          advice: e.data.advice,
          drops: e.data.drops,
          tooSmallOwned: e.data.tooSmallOwned,
          computing: false,
          error: e.data.error ?? null,
          ms: e.data.ms,
        });
      };
      usePlanStore.setState({ computing: true });
      worker.postMessage(job);
    }, 120);
    return () => clearTimeout(t);
  }, [optContracts, placeIds, missing, distCache, start, returnToStart, ship, ships, ownedIds, padOverrides, byName]);
}

/** Synchronous distance lookup (Gm) from the cached distances; undefined when unknown. */
export function useDistanceFn() {
  const places = useData((d) => d.places);
  const distCache = useStore((s) => s.distCache);
  return useMemo(() => {
    const byName = placeIndex(places);
    return (a: string, b: string) => {
      const pa = byName.get(a);
      const pb = byName.get(b);
      if (!pa || !pb) return undefined;
      if (pa.terminalId === pb.terminalId) return 0;
      const v = distCache[distKey(pa.terminalId, pb.terminalId)];
      return v === null ? undefined : v;
    };
  }, [places, distCache]);
}
