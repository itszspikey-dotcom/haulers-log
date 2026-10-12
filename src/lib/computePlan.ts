/**
 * Pure planning step (route + ship advice + drop suggestions).
 * Runs in a Web Worker in the browser; importable directly in tests.
 */
import { optimizeRoute, type Contract, type RoutePlan } from "./optimizer";
import { adviseShips, suggestDrops, type AdviceResult, type DropSuggestion, type LocationInfo, type Ship, type ShipVerdict } from "./shipAdvisor";
import { distKey } from "../../shared/api";

export interface PlanJob {
  id: number;
  contracts: Contract[];
  placeIds: Record<string, number>;
  distances: Record<string, number | null>;
  start?: string;
  returnToStart: boolean;
  ship: Ship | null;
  ships: Ship[];
  ownedIds: string[];
  locationInfo: Record<string, LocationInfo>;
}

export interface PlanResult {
  id: number;
  plan: RoutePlan | null;
  basePlan: RoutePlan | null;
  advice: AdviceResult | null;
  drops: DropSuggestion[];
  tooSmallOwned: ShipVerdict[];
  ms: number;
  error?: string;
}

export function computePlan(job: PlanJob): Omit<PlanResult, "id" | "ms"> {
  const { contracts } = job;
  const dist = (a: string, b: string) => {
    const ia = job.placeIds[a];
    const ib = job.placeIds[b];
    if (ia === undefined || ib === undefined) return undefined;
    const v = job.distances[distKey(ia, ib)];
    return v === null ? undefined : v;
  };
  const legs = contracts.reduce((n, c) => n + c.legs.length, 0);
  if (!legs) return { plan: null, basePlan: null, advice: null, drops: [], tooSmallOwned: [] };
  const restarts = legs > 40 ? 4 : legs > 24 ? 8 : 12;
  const totalScu = contracts.reduce((n, c) => n + c.legs.reduce((m, l) => m + l.scu, 0), 0);

  // Best possible route (as if the hold were infinite).
  const basePlan = optimizeRoute(contracts, dist, {
    capacity: Math.max(totalScu, 1), start: job.start, returnToStart: job.returnToStart, restarts,
  });

  // Route for the chosen ship.
  let plan: RoutePlan = basePlan;
  if (job.ship) {
    if (job.ship.scu >= basePlan.peakScu) plan = { ...basePlan, capacity: job.ship.scu };
    else
      plan = optimizeRoute(contracts, dist, {
        capacity: job.ship.scu, start: job.start, returnToStart: job.returnToStart,
        restarts: job.ship.scu < totalScu / 8 ? 3 : restarts,
      });
  }

  // Ship advice: ships that fly the whole stack in one run, plus your own ships.
  const owned = new Set(job.ownedIds);
  const tooSmallOwned: ShipVerdict[] = [];
  const candidates = job.ships.filter((s) => {
    if (job.ship && s.id === job.ship.id) return true;
    if (s.scu >= basePlan.peakScu) return true;
    if (!owned.has(s.id)) return false;
    if (s.scu >= totalScu / 6) return true;
    tooSmallOwned.push({
      ship: s, status: "unfit", extraLoads: 0, warnings: [],
      reasons: [`Hold too small: ${s.scu} SCU for a ${totalScu} SCU stack would take many trips.`],
    });
    return false;
  });
  const advice = adviseShips(contracts, candidates, dist, {
    start: job.start, returnToStart: job.returnToStart, locationInfo: job.locationInfo, basePlan, restarts: 4,
  });

  // What to drop for the chosen ship (only worth it with 2+ contracts).
  let drops: DropSuggestion[] = [];
  if (job.ship && contracts.length >= 2 && contracts.length <= 16) {
    drops = suggestDrops(contracts, job.ship, dist, {
      start: job.start, returnToStart: job.returnToStart, locationInfo: job.locationInfo, restarts: 3,
    });
  }
  return { plan, basePlan, advice, drops, tooSmallOwned };
}
