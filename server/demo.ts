/**
 * Demo data used when no UEX_TOKEN is configured, so the app is usable
 * out of the box. Coordinates are rough approximations for testing only.
 */
import type { Place } from "../shared/api";
import type { Ship } from "../src/lib/shipAdvisor";

interface DemoPlace extends Omit<Place, "aliases"> {
  xy: [number, number];
}

const P = (
  terminalId: number,
  name: string,
  body: string,
  kind: Place["kind"],
  xy: [number, number],
  system = "Stanton"
): DemoPlace => ({ terminalId, name, body, kind, xy, system, hasFreightElevator: true });

const DEMO_PLACES: DemoPlace[] = [
  P(9001, "Everus Harbor", "Hurston orbit", "station", [0, 0]),
  P(9002, "Lorville", "Hurston", "city", [0.1, 0]),
  P(9003, "HDMS-Edmond", "Hurston", "outpost", [0.5, 0.6]),
  P(9004, "HDMS-Oparei", "Hurston", "outpost", [0.7, -0.4]),
  P(9005, "HUR-L2", "Hurston L2", "station", [5, 3]),
  P(9006, "Port Tressler", "microTech orbit", "station", [30, 10]),
  P(9007, "New Babbage", "microTech", "city", [30.1, 10]),
  P(9008, "Shubin Mining Facility SMO-10", "microTech", "outpost", [30.5, 11]),
  P(9009, "MIC-L1", "microTech L1", "station", [25, 8]),
  P(9010, "Baijini Point", "ArcCorp orbit", "station", [-20, 15]),
  P(9011, "Area18", "ArcCorp", "city", [-20.1, 15]),
  P(9012, "ARC-L1", "ArcCorp L1", "station", [-15, 11]),
  P(9013, "Seraphim Station", "Crusader orbit", "station", [10, -25]),
  P(9014, "Orison", "Crusader", "city", [10.1, -25]),
  P(9015, "CRU-L5", "Crusader L5", "station", [14, -18]),
];

export const demoPlaces: Place[] = DEMO_PLACES.map(({ xy: _xy, ...p }) => ({ ...p, aliases: [] }));

export function demoDistance(a: number, b: number): number | null {
  const p = DEMO_PLACES.find((x) => x.terminalId === a);
  const q = DEMO_PLACES.find((x) => x.terminalId === b);
  if (!p || !q) return null;
  return Math.round(Math.hypot(p.xy[0] - q.xy[0], p.xy[1] - q.xy[1]) * 1000) / 1000;
}

const S = (id: string, name: string, scu: number, containerSizes: number[], padSize: Ship["padSize"], minCrew: number, maxCrew: number): Ship => ({
  id, name, scu, containerSizes, padSize, minCrew, maxCrew,
});

/** A handful of common haulers. Real data comes from UEX when a token is set. */
export const demoShips: Ship[] = [
  S("d-aurora", "Aurora MR", 3, [1], "XS", 1, 1),
  S("d-c1", "C1 Spirit", 64, [1, 2, 4, 8, 16, 32], "S", 1, 2),
  S("d-cutlass", "Cutlass Black", 46, [1, 2, 4, 8, 16], "S", 1, 3),
  S("d-maxfl", "Freelancer MAX", 120, [1, 2, 4, 8, 16, 32], "M", 1, 4),
  S("d-taurus", "Constellation Taurus", 174, [1, 2, 4, 8, 16, 32], "L", 1, 3),
  S("d-raft", "RAFT", 192, [32], "M", 1, 2),
  S("d-c2", "C2 Hercules", 696, [1, 2, 4, 8, 16, 32], "L", 1, 3),
  S("d-cat", "Caterpillar", 576, [1, 2, 4, 8, 16, 32], "L", 1, 5),
];
