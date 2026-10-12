import { Contract, Leg, optimizeRoute, validatePlan, DistanceFn } from "../src/lib/optimizer";
import { adviseShips, suggestDrops, fromUexVehicle, Ship } from "../src/lib/shipAdvisor";

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log("  ✗ FAIL:", msg); } else console.log("  ✓", msg);
};

// Fake Stanton-ish world: coordinates in Gm
const coords: Record<string, [number, number]> = {
  "Everus Harbor": [0, 0], "Lorville": [0.1, 0], "HDMS-Edmond": [0.5, 0.6], "HDMS-Oparei": [0.7, -0.4],
  "Port Tressler": [30, 10], "New Babbage": [30.1, 10], "Shubin SMO-10": [30.5, 11],
  "Baijini Point": [-20, 15], "Area18": [-20.1, 15], "Seraphim Station": [10, -25], "Orison": [10.1, -25],
  "CRU-L5": [14, -18], "HUR-L2": [5, 3], "MIC-L1": [25, 8], "ARC-L1": [-15, 11],
};
const names = Object.keys(coords);
const dist: DistanceFn = (a, b) => {
  const p = coords[a], q = coords[b];
  if (!p || !q) return undefined;
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
};

function rng(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function randomStack(n: number, seed: number, maxScu = 64): Contract[] {
  const r = rng(seed);
  const out: Contract[] = [];
  for (let i = 0; i < n; i++) {
    const type = Math.floor(r() * 3); // 0 A→B, 1 multi→single, 2 single→multi
    const legs: Leg[] = [];
    const nLegs = type === 0 ? 1 : 2 + Math.floor(r() * 2);
    const hub = names[Math.floor(r() * names.length)];
    for (let k = 0; k < nLegs; k++) {
      let other = names[Math.floor(r() * names.length)];
      while (other === hub) other = names[Math.floor(r() * names.length)];
      const [pickup, drop] = type === 1 ? [other, hub] : [hub, other];
      legs.push({ id: `C${i}-L${k}`, contractId: `C${i}`, pickup, drop, commodity: "Agricium", scu: 1 + Math.floor(r() * maxScu) });
    }
    out.push({ id: `C${i}`, payout: 20000 + Math.floor(r() * 80000), maxContainerSize: [4, 8, 16, 32][Math.floor(r() * 4)], legs });
  }
  return out;
}

// Brute force optimum for tiny instances
function bruteForce(contracts: Contract[], cap: number, start?: string): number {
  const legs = contracts.flatMap((c) => c.legs);
  let best = Infinity;
  const picked = new Array(legs.length).fill(0); // 0 none,1 picked,2 dropped
  const rec = (prev: string | undefined, cost: number, onboard: number, done: number) => {
    if (cost >= best) return;
    if (done === legs.length * 2) { best = cost; return; }
    for (let i = 0; i < legs.length; i++) {
      if (picked[i] === 0 && onboard + legs[i].scu <= cap) {
        picked[i] = 1;
        rec(legs[i].pickup, cost + (prev ? dist(prev, legs[i].pickup)! : 0), onboard + legs[i].scu, done + 1);
        picked[i] = 0;
      } else if (picked[i] === 1) {
        picked[i] = 2;
        rec(legs[i].drop, cost + (prev ? dist(prev, legs[i].drop)! : 0), onboard - legs[i].scu, done + 1);
        picked[i] = 1;
      }
    }
  };
  rec(start, 0, 0, 0);
  return best;
}

console.log("\n1. Optimality vs brute force (small stacks)");
let worst = 1;
for (let s = 1; s <= 30; s++) {
  const st = randomStack(3, s, 40).slice(0, 3);
  // keep tiny: max 5 legs
  const legsN = st.flatMap((c) => c.legs).length;
  if (legsN > 5) continue;
  const cap = 40 + (s % 3) * 30;
  const plan = optimizeRoute(st, dist, { capacity: cap, start: "Everus Harbor", splitOversizedLegs: false });
  if (!plan.feasible) continue;
  const bf = bruteForce(st, cap, "Everus Harbor");
  worst = Math.max(worst, plan.totalDistance / bf);
  if (validatePlan(st, plan).length) { fails++; console.log("invalid plan", validatePlan(st, plan)); }
}
ok(worst < 1.0001, `optimizer matches brute-force optimum (worst ratio ${worst.toFixed(4)})`);

console.log("\n2. Validity on 200 random stacks (precedence, capacity, full delivery)");
let invalid = 0;
for (let s = 1; s <= 200; s++) {
  const st = randomStack(1 + (s % 8), 1000 + s, 96);
  const cap = [32, 46, 66, 96, 128, 576][s % 6];
  const plan = optimizeRoute(st, dist, { capacity: cap, start: names[s % names.length], restarts: 4 });
  const errs = validatePlan(st, plan);
  if (!plan.feasible || errs.length) { invalid++; if (invalid < 3) console.log(errs.slice(0, 3), plan.reason); }
}
ok(invalid === 0, `all 200 plans valid (${invalid} invalid)`);

console.log("\n3. Oversized leg is split");
{
  const st: Contract[] = [{ id: "BIG", payout: 100000, maxContainerSize: 16, legs: [
    { id: "BIG-L0", contractId: "BIG", pickup: "HUR-L2", drop: "Port Tressler", commodity: "Steel", scu: 200 }] }];
  const plan = optimizeRoute(st, dist, { capacity: 96, start: "Everus Harbor" });
  const loads = plan.stops.flatMap((s) => s.actions).filter((a) => a.type === "load");
  ok(plan.feasible && loads.length === 3, `200 SCU on 96 SCU ship → 3 loads (got ${loads.length})`);
  ok(loads.filter((a) => a.scu % 16 !== 0).length <= 1, `chunks are multiples of 16 SCU crates (${loads.map((a) => a.scu).join(", ")})`);
  ok(validatePlan(st, plan).length === 0, "split plan valid");
  ok(plan.peakScu <= 96, `peak ${plan.peakScu} ≤ 96`);
}

console.log("\n4. Stacking benefit: delivering along the way keeps peak < total");
{
  const st: Contract[] = [
    { id: "A", payout: 1, legs: [{ id: "A1", contractId: "A", pickup: "Everus Harbor", drop: "HUR-L2", commodity: "x", scu: 80 }] },
    { id: "B", payout: 1, legs: [{ id: "B1", contractId: "B", pickup: "HUR-L2", drop: "Port Tressler", commodity: "x", scu: 80 }] },
  ];
  const plan = optimizeRoute(st, dist, { capacity: 96, start: "Everus Harbor" });
  ok(plan.feasible && plan.peakScu === 80 && plan.totalScu === 160, `160 SCU stack fits 96 SCU hold (peak ${plan.peakScu})`);
  ok(plan.stops.length === 3, `3 stops, unload+load merged at HUR-L2 (got ${plan.stops.length})`);
  ok(plan.stops[1].actions[0].type === "unload", "unload happens before load at shared stop");
}

console.log("\n5. Performance: 16 contracts (~30 legs)");
{
  const st = randomStack(16, 777, 64);
  const n = st.flatMap((c) => c.legs).length;
  const t0 = performance.now();
  const plan = optimizeRoute(st, dist, { capacity: 576, start: "Everus Harbor" });
  const t1 = performance.now();
  ok(plan.feasible && validatePlan(st, plan).length === 0, `${n} legs, valid plan, ${plan.stops.length} stops, ${plan.totalDistance.toFixed(1)} Gm`);
  ok(t1 - t0 < 5000, `runs in ${(t1 - t0).toFixed(0)} ms`);
  const t2 = performance.now();
  const plan2 = optimizeRoute(st, dist, { capacity: 96, start: "Everus Harbor" });
  ok(plan2.feasible && validatePlan(st, plan2).length === 0, `same stack on 96 SCU ship valid (${plan2.totalDistance.toFixed(1)} Gm, ${(performance.now() - t2).toFixed(0)} ms)`);
}

console.log("\n6. Unknown locations & bad input");
{
  const st: Contract[] = [{ id: "U", payout: 1, legs: [
    { id: "U1", contractId: "U", pickup: "Mystery Outpost", drop: "Lorville", commodity: "x", scu: 10 },
    { id: "U2", contractId: "U", pickup: "Lorville", drop: "Lorville", commodity: "x", scu: 10 },
    { id: "U3", contractId: "U", pickup: "Lorville", drop: "Area18", commodity: "x", scu: 0 }] }];
  const plan = optimizeRoute(st, dist, { capacity: 50 });
  ok(plan.feasible && plan.warnings.some((w) => w.includes("No distance data")), "unknown distance → warning, still plans");
  ok(plan.warnings.filter((w) => w.includes("skipped")).length === 2, "same-location and 0 SCU legs skipped with warnings");
  ok(optimizeRoute([], dist, { capacity: 10 }).feasible, "empty stack ok");
  ok(!optimizeRoute(st, dist, { capacity: 0 }).feasible, "zero capacity rejected");
}

console.log("\n7. Ship advisor");
const ships: Ship[] = [
  { id: "c1", name: "Cutlass Black", scu: 46, containerSizes: [1, 2, 4, 8, 16], padSize: "S", minCrew: 1, owned: true },
  { id: "fm", name: "Freelancer MAX", scu: 120, containerSizes: [1, 2, 4, 8, 16, 32], padSize: "M", minCrew: 1 },
  { id: "c2", name: "C2 Hercules", scu: 696, containerSizes: [1, 2, 4, 8, 16, 32], padSize: "L", minCrew: 1 },
  { id: "hc", name: "Hull C", scu: 4608, containerSizes: [32], padSize: "XL", minCrew: 2, usesLoadingDock: true },
  { id: "aur", name: "Aurora MR", scu: 3, containerSizes: [1], padSize: "XS", minCrew: 1, owned: true },
];
{
  const st: Contract[] = [
    { id: "K1", payout: 60000, maxContainerSize: 16, legs: [{ id: "K1a", contractId: "K1", pickup: "Everus Harbor", drop: "HDMS-Edmond", commodity: "x", scu: 40 }] },
    { id: "K2", payout: 55000, maxContainerSize: 16, legs: [{ id: "K2a", contractId: "K2", pickup: "Everus Harbor", drop: "HDMS-Oparei", commodity: "x", scu: 60 }] },
  ];
  const info = { "HDMS-Edmond": { maxPad: "M" as const }, "HDMS-Oparei": { maxPad: "M" as const } };
  const adv = adviseShips(st, ships, dist, { start: "Everus Harbor", locationInfo: info });
  const v = (n: string) => adv.verdicts.find((x) => x.ship.name === n)!;
  ok(v("C2 Hercules").status === "unfit" && v("C2 Hercules").reasons[0].includes("Too big"), "C2 rejected: L pad at M-pad outposts");
  ok(v("Hull C").status === "unfit", `Hull C rejected (${v("Hull C").reasons.join(" / ")})`);
  ok(v("Aurora MR").status === "unfit" && v("Aurora MR").reasons[0].includes("16 SCU crates"), "Aurora rejected: can't take 16 SCU crates");
  ok(adv.best?.ship.name === "Freelancer MAX", `best = Freelancer MAX (got ${adv.best?.ship.name})`);
  ok(adv.bestOwned?.ship.name === "Cutlass Black" && (adv.bestOwned?.extraLoads ?? 0) > 0, `best owned = Cutlass with ${adv.bestOwned?.extraLoads} extra load(s)`);
  for (const x of adv.verdicts) if (x.plan) ok(validatePlan(st, x.plan).length === 0, `${x.ship.name} plan valid`);
  const solo = adviseShips(st, ships, dist, { soloOnly: true });
  ok(solo.verdicts.find((x) => x.ship.name === "Hull C")!.reasons.some((r) => r.includes("crew")), "soloOnly filters crewed ships");
}

console.log("\n8. Drop suggestions");
{
  const st: Contract[] = [
    { id: "D1", payout: 50000, maxContainerSize: 8, legs: [{ id: "D1a", contractId: "D1", pickup: "Everus Harbor", drop: "HUR-L2", commodity: "x", scu: 30 }] },
    { id: "D2", payout: 10000, maxContainerSize: 32, legs: [{ id: "D2a", contractId: "D2", pickup: "Everus Harbor", drop: "Lorville", commodity: "x", scu: 10 }] },
    { id: "D3", payout: 15000, maxContainerSize: 4, legs: [{ id: "D3a", contractId: "D3", pickup: "Everus Harbor", drop: "Port Tressler", commodity: "x", scu: 8 }] },
  ];
  const cutlass = ships[0];
  const drops = suggestDrops(st, cutlass, dist, { start: "Everus Harbor" });
  ok(drops[0]?.contractId === "D2" && drops[0].fitsAfterDrop, `Cutlass can't take 32 SCU crates → drop D2 (got ${drops[0]?.contractId})`);
  const st2 = st.filter((c) => c.id !== "D2");
  const drops2 = suggestDrops(st2, cutlass, dist, { start: "Everus Harbor" });
  ok(drops2[0]?.contractId === "D3", `far, low-pay contract D3 suggested first (got ${drops2[0]?.contractId}: ${drops2[0]?.reason})`);
}

console.log("\n9. UEX adapter");
{
  const s = fromUexVehicle({ id: 12, name: "C2", name_full: "Drake C2 Hercules", scu: 696, container_sizes: "1,2,4,8,16,32", crew: "1,3", pad_type: "L", fuel_quantum: 6.5, is_loading_dock: 0, is_spaceship: 1 }, new Set(["12"]));
  ok(!!s && s.containerSizes.length === 6 && s.minCrew === 1 && s.maxCrew === 3 && s.padSize === "L" && s.owned === true, "maps UEX row correctly");
  ok(fromUexVehicle({ id: 1, scu: 0 }) === null, "skips ships with no cargo");
  ok(fromUexVehicle({ id: 2, scu: 10, is_concept: 1 }) === null, "skips concept ships");
}

console.log(fails === 0 ? "\nALL TESTS PASSED" : `\n${fails} TEST(S) FAILED`);
process.exit(fails ? 1 : 0);
