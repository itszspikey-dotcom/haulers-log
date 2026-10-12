import type { Contract, DistanceFn } from "../src/lib/optimizer";
import { findBestStack } from "../src/lib/stackFinder";
import type { Ship } from "../src/lib/shipAdvisor";

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log("  ✗ FAIL:", msg); } else console.log("  ✓", msg);
};

const coords: Record<string, [number, number]> = {
  "Everus Harbor": [0, 0], Lorville: [0.1, 0], "HDMS-Edmond": [0.5, 0.6], "HDMS-Oparei": [0.7, -0.4],
  "HUR-L2": [5, 3], "Port Tressler": [30, 10], "New Babbage": [30.1, 10], "Baijini Point": [-20, 15],
  Area18: [-20.1, 15], "Seraphim Station": [10, -25], Orison: [10.1, -25], "CRU-L5": [14, -18],
};
const names = Object.keys(coords);
const dist: DistanceFn = (a, b) => Math.hypot(coords[a][0] - coords[b][0], coords[a][1] - coords[b][1]);
const C = (id: string, payout: number, legs: [string, string, number][], crate = 8): Contract => ({
  id, payout, maxContainerSize: crate,
  legs: legs.map(([p, d, scu], i) => ({ id: `${id}-${i}`, contractId: id, pickup: p, drop: d, commodity: "x", scu })),
});
const freelancer: Ship = { id: "fm", name: "Freelancer MAX", scu: 120, containerSizes: [1, 2, 4, 8, 16, 32], padSize: "M", minCrew: 1 };
const cutlass: Ship = { id: "cb", name: "Cutlass Black", scu: 46, containerSizes: [1, 2, 4, 8, 16], padSize: "S", minCrew: 1 };

console.log("\n1. Clustered contracts get stacked, far ones skipped");
{
  const offer = [
    C("A", 40000, [["Everus Harbor", "HDMS-Edmond", 24]]),
    C("B", 42000, [["Everus Harbor", "HDMS-Oparei", 30]]),
    C("C", 38000, [["HDMS-Edmond", "Everus Harbor", 16]]),
    C("D", 45000, [["Lorville", "HDMS-Oparei", 20]]),
    C("FAR", 60000, [["Everus Harbor", "Baijini Point", 20]]),
    C("FAR2", 55000, [["Port Tressler", "Seraphim Station", 20]]),
  ];
  const r = findBestStack(offer, freelancer, dist, { start: "Everus Harbor" })!;
  ok(!!r, "found a stack");
  ok(["A", "B", "C", "D"].every((x) => r.chosen.includes(x)), `takes the 4 Hurston contracts (chose ${r.chosen.join(", ")})`);
  ok(!r.chosen.includes("FAR2"), "skips the contract on the far side of the system");
  ok(r.skipped.some((s) => s.contractId === "FAR2" && /hourly rate/.test(s.reason)), "explains why FAR2 was skipped");
  ok(/share pickups/.test(r.why), `explains why: "${r.why}"`);
  console.log(`    → ${Math.round(r.perHour).toLocaleString()} aUEC/h, ${Math.round(r.minutes)} min, ${r.plan.stops.length} stops`);
}

console.log("\n2. Ship limits respected");
{
  const offer = [
    C("SMALL", 30000, [["Everus Harbor", "HDMS-Edmond", 20]], 8),
    C("BIGCRATE", 90000, [["Everus Harbor", "HDMS-Oparei", 64]], 32),
    C("SMALL2", 28000, [["Everus Harbor", "HDMS-Oparei", 20]], 8),
  ];
  const r = findBestStack(offer, cutlass, dist, { start: "Everus Harbor" })!;
  ok(!r.chosen.includes("BIGCRATE"), "Cutlass can't take 32 SCU crates");
  ok(r.skipped.some((s) => s.contractId === "BIGCRATE" && /32 SCU crates/.test(s.reason)), "reason names the crate size");
  ok(r.plan.peakScu <= 46, `never more than 46 SCU aboard (peak ${r.plan.peakScu})`);
}

console.log("\n3. Max 16 contracts and speed with a big offer list");
{
  let seed = 3;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const offer: Contract[] = [];
  for (let i = 0; i < 30; i++) {
    const a = names[Math.floor(rnd() * 5)]; // mostly Hurston
    let b = names[Math.floor(rnd() * (i % 4 === 0 ? names.length : 5))];
    if (b === a) b = names[(names.indexOf(a) + 1) % 5];
    offer.push(C(`K${i}`, 20000 + Math.floor(rnd() * 40000), [[a, b, 4 + Math.floor(rnd() * 28)]]));
  }
  const t0 = performance.now();
  const r = findBestStack(offer, { ...freelancer, scu: 696 }, dist, { start: "Everus Harbor" })!;
  const ms = performance.now() - t0;
  ok(r.chosen.length <= 16, `stack respects the 16-contract limit (${r.chosen.length})`);
  ok(r.chosen.length + r.skipped.length === 30, "every offered contract is either chosen or explained");
  ok(ms < 15000, `30 offers searched in ${(ms / 1000).toFixed(1)} s`);
}

console.log(fails === 0 ? "\nALL STACK TESTS PASSED" : `\n${fails} STACK TEST(S) FAILED`);
process.exit(fails ? 1 : 0);
