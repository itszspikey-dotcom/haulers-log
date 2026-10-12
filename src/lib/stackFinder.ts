/**
 * stackFinder.ts — picks which offered contracts to accept together.
 *
 * Contracts that share pickups/drops (or sit close together) amortise the
 * fixed cost of each stop, so stacking them earns more per hour. This module
 * searches for the subset with the best estimated aUEC per hour that the ship
 * can actually carry, and explains what it left out and why.
 */
import { optimizeRoute, type Contract, type DistanceFn, type RoutePlan } from "./optimizer";
import type { LocationInfo, PadSize, Ship } from "./shipAdvisor";

/** Rough time model: quantum travel + a fixed cost per stop (landing, elevator, loading). */
export const TIME_MODEL = {
  minutesPerGm: 0.5, // spool + quantum + approach, averaged
  minutesPerStop: 4, // land, freight elevator, load/unload, take off
};

export const estimateMinutes = (plan: RoutePlan) =>
  plan.totalDistance * TIME_MODEL.minutesPerGm + plan.stops.length * TIME_MODEL.minutesPerStop;

export interface SkipReason {
  contractId: string;
  reason: string;
}

export interface StackPick {
  chosen: string[];
  skipped: SkipReason[];
  plan: RoutePlan;
  payout: number;
  minutes: number;
  perHour: number;
  /** Plain-English explanation of why these fit together. */
  why: string;
}

export interface FinderOptions {
  start?: string;
  returnToStart?: boolean;
  maxContracts?: number; // in-game stacking limit, default 16
  locationInfo?: Record<string, LocationInfo>;
}

const PAD_RANK: Record<PadSize, number> = { XS: 0, S: 1, M: 2, L: 3, XL: 4 };

/** Reasons a single contract can't be flown with this ship at all. */
function unfitReason(c: Contract, ship: Ship | null, info: Record<string, LocationInfo>): string | null {
  if (!ship) return null;
  const crate = c.maxContainerSize;
  if (crate && ship.containerSizes.length) {
    const max = Math.max(...ship.containerSizes);
    const min = Math.min(...ship.containerSizes);
    if (crate > max) return `uses ${crate} SCU crates, your ${ship.name} takes up to ${max}`;
    if (min > crate) return `uses crates up to ${crate} SCU, your ${ship.name} only takes ${min}+`;
  }
  if (ship.padSize) {
    for (const l of c.legs)
      for (const loc of [l.pickup, l.drop]) {
        const pad = info[loc]?.maxPad;
        if (pad && PAD_RANK[ship.padSize] > PAD_RANK[pad]) return `${loc} only has ${pad} pads`;
      }
  }
  return null;
}

export function findBestStack(
  contracts: Contract[],
  ship: Ship | null,
  distance: DistanceFn,
  opts: FinderOptions = {}
): StackPick | null {
  const maxN = opts.maxContracts ?? 16;
  const info = opts.locationInfo ?? {};
  const skipped: SkipReason[] = [];
  const pool: Contract[] = [];
  for (const c of contracts) {
    const why = unfitReason(c, ship, info);
    if (why) skipped.push({ contractId: c.id, reason: why });
    else pool.push(c);
  }
  if (!pool.length) return null;

  const totalScu = (cs: Contract[]) => cs.reduce((n, c) => n + c.legs.reduce((m, l) => m + l.scu, 0), 0);
  const cache = new Map<string, { plan: RoutePlan; minutes: number; payout: number; perHour: number } | null>();
  const evaluate = (ids: string[]) => {
    const key = [...ids].sort().join(",");
    if (cache.has(key)) return cache.get(key)!;
    const set = pool.filter((c) => ids.includes(c.id));
    const capacity = ship ? ship.scu : Math.max(totalScu(set), 1);
    const plan = optimizeRoute(set, distance, {
      capacity, start: opts.start, returnToStart: opts.returnToStart, restarts: 2,
    });
    let r: { plan: RoutePlan; minutes: number; payout: number; perHour: number } | null = null;
    if (plan.feasible && plan.stops.length) {
      const minutes = Math.max(estimateMinutes(plan), 1);
      const payout = set.reduce((n, c) => n + (c.payout || 0), 0);
      r = { plan, minutes, payout, perHour: (payout / minutes) * 60 };
    }
    cache.set(key, r);
    return r;
  };
  // Prefer the bigger stack when efficiency is within 3%: more aUEC per run for the same hourly rate.
  const better = (a: ReturnType<typeof evaluate>, b: ReturnType<typeof evaluate>) =>
    !!a && (!b || a.perHour > b.perHour * 1.03 || (a.perHour >= b.perHour * 0.97 && a.payout > b.payout));

  // 1. Greedy build-up from the best single contract.
  let chosen: string[] = [];
  let best: ReturnType<typeof evaluate> = null;
  for (const c of pool) {
    const r = evaluate([c.id]);
    if (better(r, best)) { best = r; chosen = [c.id]; }
  }
  if (!best) return null;
  for (;;) {
    if (chosen.length >= maxN) break;
    let stepBest: ReturnType<typeof evaluate> = null;
    let stepId: string | null = null;
    for (const c of pool) {
      if (chosen.includes(c.id)) continue;
      const r = evaluate([...chosen, c.id]);
      if (better(r, stepBest)) { stepBest = r; stepId = c.id; }
    }
    if (!stepId || !better(stepBest, best)) break;
    best = stepBest;
    chosen = [...chosen, stepId];
  }

  // 2. Local improvement: try dropping or swapping single contracts.
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 4) {
    improved = false;
    for (const out of [...chosen]) {
      const without = chosen.filter((x) => x !== out);
      if (without.length) {
        const r = evaluate(without);
        if (better(r, best)) { best = r; chosen = without; improved = true; continue; }
      }
      for (const c of pool) {
        if (chosen.includes(c.id)) continue;
        const swapped = [...without, c.id];
        const r = evaluate(swapped);
        if (better(r, best)) { best = r; chosen = swapped; improved = true; break; }
      }
    }
  }
  const final = best!;

  // 3. Explain what was left out.
  for (const c of pool) {
    if (chosen.includes(c.id)) continue;
    const withIt = evaluate([...chosen, c.id]);
    if (chosen.length >= maxN) skipped.push({ contractId: c.id, reason: "you can only hold 16 contracts" });
    else if (!withIt) skipped.push({ contractId: c.id, reason: "doesn't fit in your hold with the others" });
    else {
      const extraMin = Math.round(withIt.minutes - final.minutes);
      skipped.push({
        contractId: c.id,
        reason: `adds about ${extraMin} min for ${(c.payout || 0).toLocaleString("en-US")} aUEC — lowers your hourly rate`,
      });
    }
  }

  // 4. Why these work together.
  const legs = pool.filter((c) => chosen.includes(c.id)).flatMap((c) => c.legs);
  const places = new Set(legs.flatMap((l) => [l.pickup, l.drop]));
  const why =
    chosen.length === 1
      ? "No other contract pays enough for the detour. This one alone is your best use of time."
      : `These ${chosen.length} contracts only need ${places.size} places and ${final.plan.stops.length} stops in total` +
        ` (${legs.length * 2} if you flew them one by one), because they share pickups and drop-offs.`;

  return { chosen, skipped, plan: final.plan, payout: final.payout, minutes: final.minutes, perHour: final.perHour, why };
}
