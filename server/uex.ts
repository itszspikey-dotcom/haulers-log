/**
 * UEX API 2.0 client with caching.
 * Docs: https://uexcorp.space/api/documentation/
 * Quota: 120 requests / minute — we stay well under it with a small concurrency pool.
 */
import fs from "node:fs";
import path from "node:path";
import type { Place } from "../shared/api";
import { distKey } from "../shared/api";
import { fromUexVehicle, type Ship } from "../src/lib/shipAdvisor";

const BASE = "https://api.uexcorp.uk/2.0/";
const TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_DIR = path.resolve(".cache");

const token = () => process.env.UEX_TOKEN?.trim() || "";
export const uexEnabled = () => token().length > 0;

// ───────── tiny file-backed cache ─────────
function readCache<T>(name: string): { at: number; data: T } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, name), "utf8"));
  } catch {
    return null;
  }
}
function writeCache(name: string, data: unknown) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify({ at: Date.now(), data }));
  } catch {
    /* read-only filesystem: memory cache still works */
  }
}

// ───────── request pool (max 4 in flight, ≥ 550 ms between starts ≈ 109/min) ─────────
let inFlight = 0;
let lastStart = 0;
const queue: (() => void)[] = [];
function pump() {
  while (inFlight < 4 && queue.length) {
    const wait = Math.max(0, lastStart + 550 - Date.now());
    if (wait > 0) {
      setTimeout(pump, wait);
      return;
    }
    lastStart = Date.now();
    inFlight++;
    queue.shift()!();
  }
}
function pooled<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push(() =>
      fn()
        .then(resolve, reject)
        .finally(() => {
          inFlight--;
          pump();
        })
    );
    pump();
  });
}

async function uexGet<T = any>(resource: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(resource, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  return pooled(async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body || body.status !== "ok") {
      const why = body?.message || body?.status || `HTTP ${res.status}`;
      throw new Error(`UEX ${resource}: ${why}`);
    }
    return body.data as T;
  });
}

// ───────── places ─────────
let placesMem: { at: number; data: Place[] } | null = null;
let gameVersionMem: string | undefined;

export async function getPlaces(): Promise<Place[]> {
  if (placesMem && Date.now() - placesMem.at < TTL_MS) return placesMem.data;
  const disk = readCache<Place[]>("places.json");
  if (disk && Date.now() - disk.at < TTL_MS) return (placesMem = disk).data;

  const rows: any[] = await uexGet("terminals");
  const groups = new Map<string, any[]>();
  for (const t of rows) {
    if (Number(t.is_available_live) === 0 && Number(t.is_available) === 0) continue;
    if (Number(t.is_player_owned) === 1) continue;
    const name: string =
      t.space_station_name || t.outpost_name || t.city_name || t.displayname || t.name;
    if (!name) continue;
    const key = `${t.star_system_name ?? ""}|${name}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  const score = (t: any) =>
    (Number(t.has_freight_elevator) === 1 ? 8 : 0) +
    (Number(t.is_cargo_center) === 1 ? 4 : 0) +
    (t.type === "commodity" ? 2 : 0) +
    (Number(t.is_available_live) === 1 ? 1 : 0);

  const places: Place[] = [];
  for (const [key, ts] of groups) {
    const name = key.split("|")[1];
    const best = [...ts].sort((a, b) => score(b) - score(a))[0];
    const aliases = new Set<string>();
    for (const t of ts)
      for (const v of [t.name, t.fullname, t.displayname, t.nickname])
        if (v && v !== name) aliases.add(String(v));
    const kind: Place["kind"] = best.space_station_name
      ? "station"
      : best.outpost_name
        ? "outpost"
        : best.city_name
          ? "city"
          : "other";
    places.push({
      name,
      terminalId: Number(best.id),
      system: best.star_system_name ?? "",
      body: best.moon_name || best.planet_name || best.orbit_name || "",
      kind,
      aliases: [...aliases].slice(0, 12),
      hasLoadingDock: ts.some((t) => Number(t.has_loading_dock) === 1) ? true : undefined,
      hasFreightElevator: ts.some((t) => Number(t.has_freight_elevator) === 1) ? true : undefined,
      maxContainer: Math.max(0, ...ts.map((t) => Number(t.max_container_size) || 0)) || undefined,
    });
  }
  places.sort((a, b) => a.name.localeCompare(b.name));
  placesMem = { at: Date.now(), data: places };
  writeCache("places.json", places);
  return places;
}

export async function getGameVersion(): Promise<string | undefined> {
  if (gameVersionMem) return gameVersionMem;
  try {
    const v: any = await uexGet("game_versions");
    gameVersionMem = v?.live ?? undefined;
  } catch {
    /* optional */
  }
  return gameVersionMem;
}

// ───────── ships ─────────
let shipsMem: { at: number; data: Ship[] } | null = null;

export async function getShips(): Promise<Ship[]> {
  if (shipsMem && Date.now() - shipsMem.at < TTL_MS) return shipsMem.data;
  const disk = readCache<Ship[]>("ships.json");
  if (disk && Date.now() - disk.at < TTL_MS) return (shipsMem = disk).data;
  const rows: any[] = await uexGet("vehicles");
  const ships = rows
    .map((r) => fromUexVehicle(r))
    .filter((s): s is Ship => s !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  shipsMem = { at: Date.now(), data: ships };
  writeCache("ships.json", ships);
  return ships;
}

// ───────── distances (cached forever; locations don't move between patches) ─────────
const distMem = new Map<string, number | null>(
  Object.entries(readCache<Record<string, number | null>>("distances.json")?.data ?? {})
);
let saveTimer: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeCache("distances.json", Object.fromEntries(distMem));
  }, 2000);
}

export async function getDistances(pairs: [number, number][]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  const missing: [number, number][] = [];
  for (const [a, b] of pairs) {
    const k = distKey(a, b);
    if (a === b) out[k] = 0;
    else if (distMem.has(k)) out[k] = distMem.get(k)!;
    else missing.push([a, b]);
  }
  await Promise.all(
    missing.map(async ([a, b]) => {
      const k = distKey(a, b);
      try {
        const d: any = await uexGet("terminals_distances", {
          id_terminal_origin: a,
          id_terminal_destination: b,
        });
        const row = Array.isArray(d) ? d[0] : d;
        const raw = row?.distance;
        const v = raw !== null && raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null;
        distMem.set(k, v);
        out[k] = v;
      } catch {
        out[k] = null; // not cached: retry next time
      }
    })
  );
  if (missing.length) scheduleSave();
  return out;
}
