/** Server data (places, ships, status) loaded once and shared across components. */
import { create } from "zustand";
import type { Place, PlacesResponse, ShipsResponse, StatusResponse, ParseResponse } from "../../shared/api";
import type { Ship } from "../lib/shipAdvisor";
import { distKey } from "../../shared/api";
import { demoDistance, demoPlaces, demoShips } from "../../server/demo";

/** True when no server is reachable (e.g. a static preview): everything runs on demo data in the browser. */
let staticMode = false;

interface DataState {
  status: StatusResponse | null;
  places: Place[];
  placesSource: "uex" | "demo" | null;
  ships: Ship[];
  shipsSource: "uex" | "demo" | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body as T;
}
export const api = {
  status: () => getJson<StatusResponse>("/api/status"),
  places: () => getJson<PlacesResponse>("/api/places"),
  ships: () => getJson<ShipsResponse>("/api/ships"),
  distances: async (pairs: [number, number][]) => {
    if (staticMode) {
      const distances: Record<string, number | null> = {};
      for (const [a, b] of pairs) distances[distKey(a, b)] = demoDistance(a, b);
      return { distances };
    }
    return getJson<{ distances: Record<string, number | null> }>("/api/distances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pairs }),
    });
  },
  parse: (image: string, mimeType: string) =>
    getJson<ParseResponse>("/api/parse-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image, mimeType }),
    }),
};

export const useData = create<DataState>()((set, get) => ({
  status: null,
  places: [],
  placesSource: null,
  ships: [],
  shipsSource: null,
  loading: false,
  error: null,
  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    const [st, pl, sh] = await Promise.allSettled([api.status(), api.places(), api.ships()]);
    if (st.status === "rejected" && pl.status === "rejected") {
      staticMode = true;
      set({
        loading: false, error: null,
        status: { gemini: false, uex: false, model: "", version: "static" },
        places: demoPlaces, placesSource: "demo", ships: demoShips, shipsSource: "demo",
      });
      return;
    }
    set({
      loading: false,
      status: st.status === "fulfilled" ? st.value : null,
      places: pl.status === "fulfilled" ? pl.value.places : [],
      placesSource: pl.status === "fulfilled" ? pl.value.source : null,
      ships: sh.status === "fulfilled" ? sh.value.ships : [],
      shipsSource: sh.status === "fulfilled" ? sh.value.source : null,
      error:
        [st, pl, sh].find((r) => r.status === "rejected") &&
        ((([pl, sh, st].find((r) => r.status === "rejected") as PromiseRejectedResult).reason?.message as string) ||
          "Couldn't reach the server."),
    });
  },
}));
