/** Fuzzy matching of location names read from screenshots to known places. */
import Fuse from "fuse.js";
import type { Place } from "../../shared/api";

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/0(?=[a-z])|(?<=[a-z])0/g, "o") // OCR: "Harb0r" → "harbor"
    .replace(/\b(station|outpost|spaceport|space port|the|on|at|in)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

interface Entry {
  place: Place;
  key: string;
}

let cache: { places: Place[]; fuse: Fuse<Entry>; exact: Map<string, Place> } | null = null;

function index(places: Place[]) {
  if (cache && cache.places === places) return cache;
  const entries: Entry[] = [];
  const exact = new Map<string, Place>();
  for (const p of places) {
    for (const n of [p.name, ...p.aliases]) {
      const key = normalize(n);
      if (!key) continue;
      entries.push({ place: p, key });
      if (!exact.has(key)) exact.set(key, p);
    }
  }
  const fuse = new Fuse(entries, { keys: ["key"], includeScore: true, threshold: 0.45, ignoreLocation: true });
  cache = { places, fuse, exact };
  return cache;
}

export interface MatchResult {
  place: Place | null;
  /** 0 = perfect, 1 = no match */
  score: number;
  confident: boolean;
}

export function matchPlace(raw: string | null | undefined, places: Place[]): MatchResult {
  if (!raw || !places.length) return { place: null, score: 1, confident: false };
  const { fuse, exact } = index(places);
  const key = normalize(raw);
  const hit = exact.get(key);
  if (hit) return { place: hit, score: 0, confident: true };
  const res = fuse.search(key, { limit: 1 })[0];
  if (!res) return { place: null, score: 1, confident: false };
  const score = res.score ?? 1;
  return { place: res.item.place, score, confident: score < 0.18 };
}

export function searchPlaces(query: string, places: Place[], limit = 8): Place[] {
  if (!query.trim()) return places.slice(0, limit);
  const { fuse } = index(places);
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of fuse.search(normalize(query), { limit: limit * 3 })) {
    if (seen.has(r.item.place.name)) continue;
    seen.add(r.item.place.name);
    out.push(r.item.place);
    if (out.length >= limit) break;
  }
  return out;
}
