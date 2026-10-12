/**
 * shipAdvisor.ts — recommends which ship to fly for a hauling stack
 *
 * For every candidate ship it checks hard constraints (crate sizes, landing
 * pads, crew), runs the route optimizer with that ship's capacity, and ranks
 * the ships that can do the job. It can also tell you which contract to drop
 * when a stack doesn't fit a ship you own.
 *
 * Depends only on ./optimizer. Pure TypeScript, deterministic.
 */

import { Contract, DistanceFn, RoutePlan, optimizeRoute } from "./optimizer";

// ───────────────────────── Types ─────────────────────────

export type PadSize = "XS" | "S" | "M" | "L" | "XL";
const PAD_RANK: Record<PadSize, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };

export interface Ship {
  id: string;
  name: string;
  scu: number;
  /** Crate sizes the cargo grid accepts, e.g. [1,2,4,8,16,32]. Empty = unknown. */
  containerSizes: number[];
  padSize?: PadSize;
  minCrew?: number;
  maxCrew?: number;
  quantumFuel?: number; // SCU
  /** Loads at cargo loading docks instead of freight elevators (e.g. Hull-C). */
  usesLoadingDock?: boolean;
  owned?: boolean;
}

export interface LocationInfo {
  /** Largest landing pad available at this location. */
  maxPad?: PadSize;
  system?: string;
  /** false if the location has no loading dock (matters for usesLoadingDock ships). */
  hasLoadingDock?: boolean;
}

export interface AdvisorOptions {
  start?: string;
  returnToStart?: boolean;
  /** An already computed plan for this stack with capacity >= total SCU (saves a run). */
  basePlan?: RoutePlan;
  /** Optimizer restarts per ship. Default 6 (the advisor runs many ships). */
  restarts?: number;
  /** Only consider ships marked owned: true. */
  ownedOnly?: boolean;
  /** Only ships that can be flown solo (minCrew <= 1). */
  soloOnly?: boolean;
  locationInfo?: Record<string, LocationInfo>;
}

export interface ShipVerdict {
  ship: Ship;
  status: "recommended" | "ok" | "unfit";
  rank?: number; // 1 = best among fitting ships
  plan?: RoutePlan;
  /** Why it fits (or why not). Plain-English, safe to show in the UI. */
  reasons: string[];
  warnings: string[];
  /** Number of separate loads needed (1 per leg if nothing is split). */
  extraLoads: number;
  utilization?: number; // peakScu / ship.scu, 0..1
  aUECperGm?: number;
}

export interface StackRequirements {
  totalScu: number;
  largestLegScu: number;
  largestCrate?: number;
  smallestPad?: { pad: PadSize; location: string };
  locations: string[];
  systems: string[];
  totalPayout: number;
}

export interface AdviceResult {
  requirements: StackRequirements;
  verdicts: ShipVerdict[]; // fitting ships first (ranked), then unfit ones
  best?: ShipVerdict;
  bestOwned?: ShipVerdict;
}

export interface DropSuggestion {
  contractId: string;
  title?: string;
  payoutLost: number;
  fitsAfterDrop: boolean;
  distanceSaved: number; // Gm (0 if the ship did not fit before)
  aUECperGmAfter?: number;
  reason: string;
}

// ───────────────────────── Requirements ─────────────────────────

export function stackRequirements(
  contracts: Contract[],
  locationInfo: Record<string, LocationInfo> = {}
): StackRequirements {
  const locs = new Set<string>();
  let total = 0;
  let largestLeg = 0;
  let largestCrate: number | undefined;
  for (const c of contracts) {
    if (c.maxContainerSize) largestCrate = Math.max(largestCrate ?? 0, c.maxContainerSize);
    for (const l of c.legs) {
      total += l.scu;
      largestLeg = Math.max(largestLeg, l.scu);
      locs.add(l.pickup);
      locs.add(l.drop);
    }
  }
  let smallestPad: StackRequirements["smallestPad"];
  const systems = new Set<string>();
  for (const l of locs) {
    const info = locationInfo[l];
    if (info?.system) systems.add(info.system);
    if (info?.maxPad && (!smallestPad || PAD_RANK[info.maxPad] < PAD_RANK[smallestPad.pad]))
      smallestPad = { pad: info.maxPad, location: l };
  }
  return {
    totalScu: total,
    largestLegScu: largestLeg,
    largestCrate,
    smallestPad,
    locations: [...locs],
    systems: [...systems],
    totalPayout: contracts.reduce((s, c) => s + (c.payout || 0), 0),
  };
}

// ───────────────────────── Hard checks ─────────────────────────

function hardChecks(
  ship: Ship,
  req: StackRequirements,
  contracts: Contract[],
  opts: AdvisorOptions
): { unfit: string[]; warnings: string[] } {
  const unfit: string[] = [];
  const warnings: string[] = [];
  const info = opts.locationInfo ?? {};

  if (!(ship.scu > 0)) unfit.push("Has no cargo grid.");

  if (opts.soloOnly && (ship.minCrew ?? 1) > 1)
    unfit.push(`Needs at least ${ship.minCrew} crew.`);

  // Crate sizes
  if (ship.containerSizes.length > 0) {
    const shipMax = Math.max(...ship.containerSizes);
    const shipMin = Math.min(...ship.containerSizes);
    if (req.largestCrate && shipMax < req.largestCrate)
      unfit.push(`Can't fit ${req.largestCrate} SCU crates (max ${shipMax} SCU).`);
    if (req.largestCrate && shipMin > req.largestCrate)
      unfit.push(`Only accepts ${shipMin}+ SCU crates; this stack uses crates up to ${req.largestCrate} SCU.`);
    else if (shipMin > 1) {
      // some contracts may still hand out small crates
      const smallContracts = contracts.filter(
        (c) => (c.maxContainerSize ?? 32) < shipMin || c.legs.some((l) => l.scu % shipMin !== 0)
      );
      if (smallContracts.length > 0)
        warnings.push(
          `Grid takes ${shipMin}+ SCU crates; ${smallContracts.length} contract(s) may include smaller crates.`
        );
    }
  } else {
    warnings.push("Crate sizes unknown for this ship — check in game.");
  }

  // Landing pads
  if (ship.padSize && req.smallestPad && PAD_RANK[ship.padSize] > PAD_RANK[req.smallestPad.pad])
    unfit.push(
      `Too big to land at ${req.smallestPad.location} (${req.smallestPad.pad} pad, ship needs ${ship.padSize}).`
    );
  if (!ship.padSize) warnings.push("Pad size unknown — check that it can land at every stop.");

  // Loading docks
  if (ship.usesLoadingDock) {
    const noDock = req.locations.filter((l) => info[l]?.hasLoadingDock === false);
    if (noDock.length > 0) unfit.push(`Needs a cargo loading dock; none at ${noDock.join(", ")}.`);
    else warnings.push("Loads at cargo loading docks only (no freight elevator) — check every stop has one.");
  }

  // Interstellar
  if (req.systems.length > 1 && (ship.quantumFuel ?? 0) > 0 && (ship.quantumFuel ?? 0) < 2)
    warnings.push("Small quantum tank for an interstellar run — plan refuel stops.");

  return { unfit, warnings };
}

// ───────────────────────── Advisor ─────────────────────────

export function adviseShips(
  contracts: Contract[],
  ships: Ship[],
  distance: DistanceFn,
  opts: AdvisorOptions = {}
): AdviceResult {
  const req = stackRequirements(contracts, opts.locationInfo);
  const candidates = opts.ownedOnly ? ships.filter((s) => s.owned) : ships;
  const legCount = contracts.reduce((n, c) => n + c.legs.filter((l) => l.scu > 0).length, 0);

  // Ships bigger than the whole stack all produce the same route → cache by effective capacity
  const planCache = new Map<number, RoutePlan>();
  const run = (capacity: number) =>
    optimizeRoute(contracts, distance, {
      capacity,
      start: opts.start,
      returnToStart: opts.returnToStart,
      restarts: opts.restarts ?? 6,
    });
  // The unconstrained route (hold = whole stack) is the best route any ship can fly.
  // Any ship whose hold fits that route's peak gets exactly that route — no re-run needed.
  let base: RoutePlan | null = null;
  const planFor = (capacity: number) => {
    const total = Math.max(req.totalScu, 1);
    if (!base) base = opts.basePlan && opts.basePlan.capacity >= total ? opts.basePlan : run(total);
    if (base.feasible && capacity >= base.peakScu) return { ...base, capacity };
    const eff = Math.min(capacity, total);
    let p = planCache.get(eff);
    if (!p) {
      p = run(eff);
      planCache.set(eff, p);
    }
    return { ...p, capacity };
  };

  const verdicts: ShipVerdict[] = candidates.map((ship) => {
    const { unfit, warnings } = hardChecks(ship, req, contracts, opts);
    if (unfit.length > 0)
      return { ship, status: "unfit", reasons: unfit, warnings, extraLoads: 0 };

    const plan = planFor(ship.scu);
    if (!plan.feasible)
      return {
        ship,
        status: "unfit",
        reasons: [plan.reason ?? "No valid route."],
        warnings,
        extraLoads: 0,
      };

    const loads = plan.stops.reduce((n, s) => n + s.actions.filter((a) => a.type === "load").length, 0);
    const extraLoads = Math.max(0, loads - legCount);
    const reasons: string[] = [];
    if (plan.splitLegs.length === 0)
      reasons.push(`Carries the whole stack (peak ${plan.peakScu}/${ship.scu} SCU).`);
    else
      reasons.push(
        `Hold too small for some loads: needs ${extraLoads} extra pickup run(s) (${plan.totalDistance.toFixed(1)} Gm total).`
      );
    if ((ship.minCrew ?? 1) <= 1) reasons.push("Can be flown solo.");
    return {
      ship,
      status: "ok",
      plan,
      reasons,
      warnings: [...warnings, ...plan.warnings],
      extraLoads,
      utilization: ship.scu > 0 ? plan.peakScu / ship.scu : 0,
      aUECperGm: plan.totalDistance > 0 ? req.totalPayout / plan.totalDistance : undefined,
    };
  });

  // Rank fitting ships: shortest route (3% tolerance) → fewer crew → smallest sufficient hold
  const fits = verdicts.filter((v) => v.status !== "unfit");
  fits.sort((a, b) => {
    const da = a.plan!.totalDistance;
    const db = b.plan!.totalDistance;
    const tol = 0.03 * Math.max(Math.min(da, db), 0.001);
    if (Math.abs(da - db) > tol) return da - db;
    const ca = a.ship.minCrew ?? 1;
    const cb = b.ship.minCrew ?? 1;
    if (ca !== cb) return ca - cb;
    if (a.ship.scu !== b.ship.scu) return a.ship.scu - b.ship.scu;
    return a.ship.name.localeCompare(b.ship.name);
  });
  fits.forEach((v, i) => {
    v.rank = i + 1;
    v.status = i === 0 ? "recommended" : "ok";
  });
  const unfitList = verdicts.filter((v) => v.status === "unfit");

  return {
    requirements: req,
    verdicts: [...fits, ...unfitList],
    best: fits[0],
    bestOwned: fits.find((v) => v.ship.owned),
  };
}

/**
 * For a given ship, test dropping each contract. Returns suggestions sorted
 * by usefulness: drops that make the ship fit come first, then drops that save
 * the most distance per aUEC lost.
 */
export function suggestDrops(
  contracts: Contract[],
  ship: Ship,
  distance: DistanceFn,
  opts: AdvisorOptions = {}
): DropSuggestion[] {
  if (contracts.length < 2) return [];
  const before = adviseShips(contracts, [ship], distance, { ...opts, ownedOnly: false }).verdicts[0];
  const fitsBefore = before.status !== "unfit";
  const out: DropSuggestion[] = [];

  for (const c of contracts) {
    const rest = contracts.filter((x) => x.id !== c.id);
    const after = adviseShips(rest, [ship], distance, { ...opts, ownedOnly: false }).verdicts[0];
    const fitsAfter = after.status !== "unfit";
    if (!fitsBefore && !fitsAfter) continue;
    const saved =
      fitsBefore && fitsAfter ? before.plan!.totalDistance - after.plan!.totalDistance : 0;
    let reason: string;
    if (!fitsBefore && fitsAfter) reason = `Dropping it makes the ${ship.name} fit the stack.`;
    else
      reason =
        saved > 0
          ? `Saves ${saved.toFixed(1)} Gm for ${c.payout.toLocaleString()} aUEC lost.`
          : `No distance saved.`;
    out.push({
      contractId: c.id,
      title: c.title,
      payoutLost: c.payout,
      fitsAfterDrop: fitsAfter,
      distanceSaved: Math.max(0, saved),
      aUECperGmAfter: after.aUECperGm,
      reason,
    });
  }

  out.sort((a, b) => {
    if (a.fitsAfterDrop !== b.fitsAfterDrop) return a.fitsAfterDrop ? -1 : 1;
    if (!fitsBefore) return a.payoutLost - b.payoutLost; // cheapest fix first
    const ea = a.distanceSaved / Math.max(a.payoutLost, 1);
    const eb = b.distanceSaved / Math.max(b.payoutLost, 1);
    return eb - ea;
  });
  return fitsBefore ? out.filter((d) => d.distanceSaved > 0) : out;
}

// ───────────────────────── UEX adapter ─────────────────────────

/** Convert one row of UEX API 2.0 /vehicles into a Ship. Returns null for non-haulers. */
export function fromUexVehicle(v: any, ownedIds: Set<string> = new Set()): Ship | null {
  if (!v || !(Number(v.scu) > 0)) return null;
  if (Number(v.is_concept) === 1) return null;
  if (Number(v.is_ground_vehicle) === 1) return null;
  if (v.is_spaceship !== undefined && Number(v.is_spaceship) === 0) return null;
  const sizes = String(v.container_sizes ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const crew = String(v.crew ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  const pad = String(v.pad_type ?? "").toUpperCase();
  const id = String(v.id);
  return {
    id,
    name: v.name_full || v.name,
    scu: Number(v.scu),
    containerSizes: sizes,
    padSize: (["XS", "S", "M", "L", "XL"].includes(pad) ? pad : undefined) as PadSize | undefined,
    minCrew: crew.length ? Math.min(...crew) : undefined,
    maxCrew: crew.length ? Math.max(...crew) : undefined,
    quantumFuel: v.fuel_quantum != null ? Number(v.fuel_quantum) : undefined,
    usesLoadingDock: Number(v.is_loading_dock) === 1,
    owned: ownedIds.has(id),
  };
}
