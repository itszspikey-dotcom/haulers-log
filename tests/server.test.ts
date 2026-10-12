/** Tests the UEX client and Gemini output handling against simulated responses. */
import fs from "node:fs";
import { sanitize } from "../server/gemini";
import { toNewContract } from "../src/state/importer";
import { matchPlace } from "../src/lib/match";

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; console.log("  ✗ FAIL:", msg); } else console.log("  ✓", msg);
};

fs.rmSync(".cache", { recursive: true, force: true });
process.env.UEX_TOKEN = "test-token";

// ── simulated UEX API ──
const calls: string[] = [];
const terminals = [
  { id: 11, name: "Admin - Everus Harbor", type: "item", star_system_name: "Stanton", planet_name: "Hurston", orbit_name: "Hurston", space_station_name: "Everus Harbor", is_available_live: 1, has_freight_elevator: 0 },
  { id: 12, name: "TDD - Everus Harbor", fullname: "Everus Harbor Commodity Shop", type: "commodity", star_system_name: "Stanton", planet_name: "Hurston", space_station_name: "Everus Harbor", is_available_live: 1, has_freight_elevator: 1, max_container_size: 32 },
  { id: 21, name: "HDMS-Edmond", type: "commodity", star_system_name: "Stanton", planet_name: "Hurston", outpost_name: "HDMS-Edmond", is_available_live: 1, has_loading_dock: 0, max_container_size: 16 },
  { id: 31, name: "Central Business District", type: "commodity", star_system_name: "Stanton", planet_name: "Hurston", city_name: "Lorville", is_available_live: 1, has_freight_elevator: 1 },
  { id: 41, name: "Player shop", type: "item", star_system_name: "Stanton", city_name: "Lorville", is_player_owned: 1, is_available_live: 1 },
  { id: 51, name: "Ruin Station Market", type: "commodity", star_system_name: "Pyro", space_station_name: "Ruin Station", is_available_live: 1 },
];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = new URL(String(input));
  calls.push(url.pathname + url.search);
  if (init?.headers?.Authorization !== "Bearer test-token") return new Response("{}", { status: 401 });
  const json = (data: unknown) => new Response(JSON.stringify({ status: "ok", data }), { status: 200 });
  if (url.pathname.endsWith("/terminals")) return json(terminals);
  if (url.pathname.endsWith("/vehicles"))
    return json([
      { id: 1, name: "C2", name_full: "Drake C2 Hercules", scu: 696, container_sizes: "1,2,4,8,16,32", crew: "1,3", pad_type: "L", is_spaceship: 1 },
      { id: 2, name: "Gladius", scu: 0, is_spaceship: 1 },
    ]);
  if (url.pathname.endsWith("/terminals_distances")) {
    const a = Number(url.searchParams.get("id_terminal_origin"));
    const b = Number(url.searchParams.get("id_terminal_destination"));
    if ([a, b].includes(51)) return new Response(JSON.stringify({ status: "ok", data: { distance: null } }));
    return json({ distance: Math.abs(a - b) / 10 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const uex = await import("../server/uex");

console.log("\n1. UEX locations");
const places = await uex.getPlaces();
const names = places.map((p) => p.name);
ok(names.includes("Everus Harbor") && names.includes("HDMS-Edmond") && names.includes("Lorville"), `grouped into places: ${names.join(", ")}`);
ok(places.find((p) => p.name === "Everus Harbor")?.terminalId === 12, "picks the freight-elevator terminal for distances");
ok(places.find((p) => p.name === "Lorville")?.kind === "city", "Lorville is a city");
ok(!places.some((p) => p.aliases.includes("Player shop")), "player-owned terminals skipped");
ok(places.find((p) => p.name === "HDMS-Edmond")?.hasLoadingDock === undefined, "no false loading-dock flag");
ok(places.find((p) => p.name === "Everus Harbor")?.aliases.includes("Everus Harbor Commodity Shop") === true, "aliases kept for matching");
const before = calls.length;
await uex.getPlaces();
ok(calls.length === before, "second call served from cache");

console.log("\n2. UEX ships");
const ships = await uex.getShips();
ok(ships.length === 1 && ships[0].name === "Drake C2 Hercules" && ships[0].padSize === "L", "ships mapped, no-cargo ships dropped");

console.log("\n3. UEX distances");
const d1 = await uex.getDistances([[12, 21], [21, 12], [12, 51], [12, 12]]);
ok(d1["12:21"] === 0.9, `distance read (${d1["12:21"]} Gm)`);
ok(d1["12:51"] === null, "cross-system unknown → null");
ok(d1["12:12"] === 0, "same terminal → 0");
const c2 = calls.length;
await uex.getDistances([[21, 12]]);
ok(calls.length === c2, "distance cached, symmetric");

console.log("\n4. Gemini output sanitising");
const s = sanitize({
  contracts: [
    { title: " Direct Haul ", company: "Covalex Shipping", payout: "48,500", maxContainerSize: "16",
      legs: [{ pickup: "Everus Harb0r", drop: "HDMS-Edmund", commodity: "Stims", scu: "24" }, { pickup: null, drop: "", commodity: 5, scu: "abc" }] },
    { title: null, payout: 12, maxContainerSize: 7, legs: "nope" },
  ],
  confidence: "certain",
  notes: 42,
});
ok(s.contracts[0].payout === 48500 && s.contracts[0].maxContainerSize === 16, "numbers parsed from text");
ok(s.contracts[0].legs[0].scu === 24 && s.contracts[0].legs[1].scu === null && s.contracts[0].legs[1].drop === null, "bad leg values become null");
ok(s.contracts[1].maxContainerSize === null && s.contracts[1].legs.length === 0, "invalid crate size and legs rejected");
ok(s.confidence === "low" && s.notes === "", "unknown confidence → low");

console.log("\n5. Location matching & import");
ok(matchPlace("Everus Harb0r", places).place?.name === "Everus Harbor", "OCR typo 'Harb0r' matched");
ok(matchPlace("HDMS-Edmund", places).place?.name === "HDMS-Edmond", "near-miss 'Edmund' suggests Edmond");
ok(matchPlace("Lorville", places).confident, "exact name is confident");
ok(!matchPlace("Totally Unknown Place 9", places).confident, "unknown place not confident");
const nc = toNewContract(s.contracts[0], places, "high", "");
ok(nc.payout === 48500 && nc.legs[0].pickup === "Everus Harbor" && nc.legs[0].pickupOk, "import maps pickup to canonical name");
ok(!!nc.needsCheck, `flags things to check: "${nc.needsCheck}"`);

globalThis.fetch = realFetch;
fs.rmSync(".cache", { recursive: true, force: true });
console.log(fails === 0 ? "\nALL SERVER TESTS PASSED" : `\n${fails} SERVER TEST(S) FAILED`);
process.exit(fails ? 1 : 0);
