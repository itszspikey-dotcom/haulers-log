/**
 * optimizer.ts — Star Citizen hauling stack route optimizer
 *
 * Solves a capacitated pickup-and-delivery problem:
 *   - every cargo leg must be picked up before it is dropped
 *   - SCU on board may never exceed the ship's capacity
 *   - total travel distance is minimised
 *
 * Legs bigger than the ship's hold are automatically split into
 * several loads (the route then revisits locations as needed).
 *
 * Pure TypeScript, no dependencies, deterministic (seeded RNG).
 * Do NOT replace this logic with LLM output — it guarantees valid routes.
 */

// ───────────────────────── Types ─────────────────────────

/** One cargo movement inside a contract: X SCU of a commodity from A to B. */
export interface Leg {
  id: string;
  contractId: string;
  pickup: string; // location name (must match the keys used by your DistanceFn)
  drop: string;
  commodity: string;
  scu: number;
}

/** A hauling contract as read from the mobiGlas (after user review). */
export interface Contract {
  id: string;
  title?: string;
  company?: string;
  payout: number; // aUEC
  /** Largest crate size the contract uses (1, 2, 4, 8, 16 or 32 SCU). */
  maxContainerSize?: number;
  legs: Leg[];
}

/** Distance between two location names, in gigameters (Gm). Return NaN/undefined if unknown. */
export type DistanceFn = (from: string, to: string) => number | undefined;

export interface CargoAction {
  type: "unload" | "load";
  legId: string; // original leg id (split loads share the same legId)
  partId: string; // unique id of this load (legId or legId#n when split)
  contractId: string;
  commodity: string;
  scu: number;
  /** Estimated crate breakdown, e.g. { 32: 1, 16: 1, 4: 2 } */
  crates: Record<number, number>;
}

export interface RouteStop {
  index: number; // 1-based stop number
  location: string;
  actions: CargoAction[]; // unloads first, then loads
  scuAfter: number; // SCU on board when leaving this stop
  legDistance: number; // Gm from previous stop (or start)
  cumulativeDistance: number;
}

export interface RoutePlan {
  feasible: boolean;
  reason?: string;
  stops: RouteStop[];
  totalDistance: number; // Gm
  peakScu: number; // max SCU on board at any time
  totalScu: number; // sum of all cargo moved
  capacity: number;
  splitLegs: string[]; // leg ids that had to be split into multiple loads
  warnings: string[];
}

export interface OptimizeOptions {
  /** Usable cargo capacity of the ship in SCU. */
  capacity: number;
  /** Where the player starts (e.g. current station). Optional. */
  start?: string;
  /** Count the trip back to `start` at the end. Default false. */
  returnToStart?: boolean;
  /** Multi-start restarts. More = better routes, slower. Default 12. */
  restarts?: number;
  /** RNG seed for reproducible results. Default 42. */
  seed?: number;
  /** Distance used when DistanceFn has no value for a pair. Default 50 Gm. */
  unknownDistance?: number;
  /** Split legs larger than capacity into several loads. Default true. */
  splitOversizedLegs?: boolean;
}

// ───────────────────────── Helpers ─────────────────────────

const CRATE_SIZES = [32, 16, 8, 4, 2, 1];

/** Greedy crate breakdown estimate for an SCU amount, limited to maxCrate. */
export function crateBreakdown(scu: number, maxCrate = 32): Record<number, number> {
  const out: Record<number, number> = {};
  let left = Math.round(scu);
  for (const size of CRATE_SIZES) {
    if (size > maxCrate) continue;
    const n = Math.floor(left / size);
    if (n > 0) {
      out[size] = n;
      left -= n * size;
    }
  }
  return out;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Part {
  partId: string;
  leg: Leg;
  scu: number;
  maxCrate: number;
}

interface Ev {
  p: number; // part index
  d: boolean; // true = drop, false = pickup
}

// ───────────────────────── Core ─────────────────────────

export function optimizeRoute(
  contracts: Contract[],
  distance: DistanceFn,
  opts: OptimizeOptions
): RoutePlan {
  const capacity = opts.capacity;
  const restarts = Math.max(1, opts.restarts ?? 12);
  const unknownDistance = opts.unknownDistance ?? 50;
  const split = opts.splitOversizedLegs ?? true;
  const warnings: string[] = [];
  const empty = (reason: string): RoutePlan => ({
    feasible: false,
    reason,
    stops: [],
    totalDistance: 0,
    peakScu: 0,
    totalScu: 0,
    capacity,
    splitLegs: [],
    warnings,
  });

  if (!(capacity > 0)) return empty("Ship capacity must be greater than 0 SCU.");

  // 1. Build parts (split oversized legs)
  const parts: Part[] = [];
  const splitLegs: string[] = [];
  let totalScu = 0;
  for (const c of contracts) {
    const maxCrate = c.maxContainerSize ?? 32;
    for (const leg of c.legs) {
      if (!(leg.scu > 0)) {
        warnings.push(`Leg ${leg.id} has no SCU amount and was skipped.`);
        continue;
      }
      if (leg.pickup === leg.drop) {
        warnings.push(`Leg ${leg.id} has the same pickup and drop (${leg.pickup}) and was skipped.`);
        continue;
      }
      totalScu += leg.scu;
      if (leg.scu <= capacity) {
        parts.push({ partId: leg.id, leg, scu: leg.scu, maxCrate });
        continue;
      }
      if (!split) {
        return empty(
          `Leg ${leg.id} needs ${leg.scu} SCU but the ship only holds ${capacity} SCU.`
        );
      }
      // chunk size: largest multiple of the crate size that fits
      // (crate-size compatibility with the ship is checked by shipAdvisor)
      const crate = CRATE_SIZES.find((s) => s <= Math.min(maxCrate, capacity)) ?? 1;
      const chunk = Math.floor(capacity / crate) * crate;
      let left = leg.scu;
      let n = 1;
      while (left > 0) {
        const s = Math.min(chunk, left);
        parts.push({ partId: `${leg.id}#${n}`, leg, scu: s, maxCrate });
        left -= s;
        n++;
      }
      splitLegs.push(leg.id);
    }
  }
  if (parts.length === 0) return { ...empty("No cargo to move."), feasible: true, reason: undefined };

  // 2. Distance cache
  const cache = new Map<string, number>();
  const unknownPairs = new Set<string>();
  const dist = (a: string, b: string): number => {
    if (a === b) return 0;
    const k = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    let v = cache.get(k);
    if (v === undefined) {
      const raw = distance(a, b);
      if (raw === undefined || raw === null || !Number.isFinite(raw) || raw < 0) {
        v = unknownDistance;
        unknownPairs.add(`${a} ↔ ${b}`);
      } else v = raw;
      cache.set(k, v);
    }
    return v;
  };

  const loc = (e: Ev) => (e.d ? parts[e.p].leg.drop : parts[e.p].leg.pickup);

  // 3. Evaluate a sequence → cost (Infinity if infeasible)
  //    Consecutive events at the same location form one stop; within a stop
  //    unloads happen before loads.
  const evaluate = (seq: Ev[]): number => {
    let cost = 0;
    let onboard = 0;
    let prev = opts.start;
    let i = 0;
    while (i < seq.length) {
      const here = loc(seq[i]);
      if (prev !== undefined) cost += dist(prev, here);
      let unload = 0;
      let load = 0;
      let j = i;
      while (j < seq.length && loc(seq[j]) === here) {
        if (seq[j].d) unload += parts[seq[j].p].scu;
        else load += parts[seq[j].p].scu;
        j++;
      }
      onboard = onboard - unload + load;
      if (onboard > capacity + 1e-9) return Infinity;
      prev = here;
      i = j;
    }
    if (opts.returnToStart && opts.start !== undefined && prev !== undefined)
      cost += dist(prev, opts.start);
    return cost;
  };

  // Best insertion of part p into seq: pickup before seq[i], drop before seq[j] (j >= i).
  // O(n²) candidates, each checked in O(1) using prefix loads and distance deltas.
  // Checking capacity per event (instead of per merged stop) is never worse: a drop
  // can always be inserted at the start of a same-location block at equal cost.
  const bestInsert = (seq: Ev[], p: number): { seq: Ev[]; cost: number } | null => {
    const n = seq.length;
    const scu = parts[p].scu;
    const pl = parts[p].leg.pickup;
    const dl = parts[p].leg.drop;
    const locs = seq.map(loc);
    // load after each event
    const L = new Array<number>(n);
    let run = 0;
    for (let k = 0; k < n; k++) {
      run += seq[k].d ? -parts[seq[k].p].scu : parts[seq[k].p].scu;
      L[k] = run;
    }
    const before = (i: number) => (i === 0 ? opts.start : locs[i - 1]); // node before gap i
    const after = (i: number) =>
      i === n ? (opts.returnToStart ? opts.start : undefined) : locs[i]; // node after gap i
    const d = (a: string | undefined, b: string | undefined) =>
      a === undefined || b === undefined ? 0 : dist(a, b);

    let bestDelta = Infinity;
    let bi = -1;
    let bj = -1;
    for (let i = 0; i <= n; i++) {
      const loadBefore = i === 0 ? 0 : L[i - 1];
      if (loadBefore + scu > capacity + 1e-9) continue;
      const a = before(i);
      const b = after(i);
      // j === i : pickup and drop adjacent
      const dAdj = d(a, pl) + dist(pl, dl) + d(dl, b) - d(a, b);
      if (dAdj < bestDelta - 1e-9) { bestDelta = dAdj; bi = i; bj = i; }
      const dP = d(a, pl) + d(pl, b) - d(a, b);
      let maxLoad = -Infinity;
      for (let j = i + 1; j <= n; j++) {
        maxLoad = Math.max(maxLoad, L[j - 1]);
        if (maxLoad + scu > capacity + 1e-9) break; // carrying p through j-1 overflows
        const a2 = locs[j - 1];
        const b2 = after(j);
        const delta = dP + d(a2, dl) + d(dl, b2) - d(a2, b2);
        if (delta < bestDelta - 1e-9) { bestDelta = delta; bi = i; bj = j; }
      }
    }
    if (bi < 0) return null;
    const out = seq.slice(0, bi);
    out.push({ p, d: false });
    out.push(...seq.slice(bi, bj));
    out.push({ p, d: true });
    out.push(...seq.slice(bj));
    return { seq: out, cost: evaluate(out) };
  };

  const construct = (order: number[]): { seq: Ev[]; cost: number } | null => {
    let seq: Ev[] = [];
    let cost = 0;
    for (const p of order) {
      const r = bestInsert(seq, p);
      if (!r) return null;
      seq = r.seq;
      cost = r.cost;
    }
    return { seq, cost };
  };

  // Local search: remove each part and reinsert it at its best position
  const improve = (sol: { seq: Ev[]; cost: number }) => {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 50) {
      improved = false;
      for (let p = 0; p < parts.length; p++) {
        const without = sol.seq.filter((e) => e.p !== p);
        const r = bestInsert(without, p);
        if (r && r.cost < sol.cost - 1e-6) {
          sol = r;
          improved = true;
        }
      }
    }
    return sol;
  };

  // 4. Multi-start
  const rng = mulberry32(opts.seed ?? 42);
  const idx = parts.map((_, i) => i);
  let best: { seq: Ev[]; cost: number } | null = null;
  for (let r = 0; r < restarts; r++) {
    let order: number[];
    if (r === 0) order = [...idx].sort((a, b) => parts[b].scu - parts[a].scu);
    else {
      order = [...idx];
      for (let k = order.length - 1; k > 0; k--) {
        const m = Math.floor(rng() * (k + 1));
        [order[k], order[m]] = [order[m], order[k]];
      }
    }
    const built = construct(order);
    if (!built) continue;
    const sol = improve(built);
    if (!best || sol.cost < best.cost - 1e-9) best = sol;
  }

  if (!best) {
    return empty(
      "No valid route found with this capacity. Try a bigger ship or fewer contracts."
    );
  }

  // 5. Build human-readable stops
  const stops: RouteStop[] = [];
  let onboard = 0;
  let peak = 0;
  let cum = 0;
  let prev = opts.start;
  let i = 0;
  const seq = best.seq;
  while (i < seq.length) {
    const here = loc(seq[i]);
    const legDistance = prev !== undefined ? dist(prev, here) : 0;
    cum += legDistance;
    const unloads: CargoAction[] = [];
    const loads: CargoAction[] = [];
    let j = i;
    while (j < seq.length && loc(seq[j]) === here) {
      const part = parts[seq[j].p];
      const a: CargoAction = {
        type: seq[j].d ? "unload" : "load",
        legId: part.leg.id,
        partId: part.partId,
        contractId: part.leg.contractId,
        commodity: part.leg.commodity,
        scu: part.scu,
        crates: crateBreakdown(part.scu, part.maxCrate),
      };
      (seq[j].d ? unloads : loads).push(a);
      j++;
    }
    for (const a of unloads) onboard -= a.scu;
    for (const a of loads) onboard += a.scu;
    peak = Math.max(peak, onboard);
    stops.push({
      index: stops.length + 1,
      location: here,
      actions: [...unloads, ...loads],
      scuAfter: onboard,
      legDistance,
      cumulativeDistance: cum,
    });
    prev = here;
    i = j;
  }
  if (opts.returnToStart && opts.start !== undefined && prev !== undefined) {
    cum += dist(prev, opts.start);
  }

  if (unknownPairs.size > 0) {
    warnings.push(
      `No distance data for ${unknownPairs.size} location pair(s); assumed ${unknownDistance} Gm: ` +
        [...unknownPairs].slice(0, 5).join(", ") +
        (unknownPairs.size > 5 ? ", …" : "")
    );
  }
  if (splitLegs.length > 0) {
    warnings.push(
      `${splitLegs.length} leg(s) are larger than the hold and were split into several loads: ${splitLegs.join(", ")}`
    );
  }

  return {
    feasible: true,
    stops,
    totalDistance: Math.round(cum * 1000) / 1000,
    peakScu: peak,
    totalScu,
    capacity,
    splitLegs,
    warnings,
  };
}

/** Validate a plan independently (used by tests and as a safety net in the UI). */
export function validatePlan(contracts: Contract[], plan: RoutePlan): string[] {
  const errors: string[] = [];
  const picked = new Map<string, number>();
  const dropped = new Map<string, number>();
  let onboard = 0;
  for (const s of plan.stops) {
    for (const a of s.actions) {
      if (a.type === "unload") {
        if ((picked.get(a.partId) ?? 0) < a.scu)
          errors.push(`Stop ${s.index}: ${a.partId} unloaded before it was loaded`);
        dropped.set(a.partId, (dropped.get(a.partId) ?? 0) + a.scu);
        onboard -= a.scu;
      } else {
        picked.set(a.partId, (picked.get(a.partId) ?? 0) + a.scu);
        onboard += a.scu;
      }
    }
    if (onboard > plan.capacity + 1e-9)
      errors.push(`Stop ${s.index}: ${onboard} SCU on board exceeds capacity ${plan.capacity}`);
    if (Math.abs(onboard - s.scuAfter) > 1e-9)
      errors.push(`Stop ${s.index}: scuAfter mismatch`);
  }
  // every leg fully delivered at its drop location
  const deliveredByLeg = new Map<string, number>();
  for (const s of plan.stops)
    for (const a of s.actions)
      if (a.type === "unload") deliveredByLeg.set(a.legId, (deliveredByLeg.get(a.legId) ?? 0) + a.scu);
  for (const c of contracts)
    for (const l of c.legs) {
      if (!(l.scu > 0) || l.pickup === l.drop) continue;
      if ((deliveredByLeg.get(l.id) ?? 0) !== l.scu)
        errors.push(`Leg ${l.id}: delivered ${deliveredByLeg.get(l.id) ?? 0}/${l.scu} SCU`);
    }
  for (const s of plan.stops)
    for (const a of s.actions) {
      const leg = contracts.flatMap((c) => c.legs).find((l) => l.id === a.legId);
      if (!leg) continue;
      const expected = a.type === "load" ? leg.pickup : leg.drop;
      if (expected !== s.location)
        errors.push(`Stop ${s.index}: ${a.type} of ${a.partId} at wrong location`);
    }
  if (onboard !== 0) errors.push(`Route ends with ${onboard} SCU still on board`);
  return errors;
}
