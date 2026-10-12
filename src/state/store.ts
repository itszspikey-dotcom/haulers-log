import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PadSize } from "../lib/shipAdvisor";

export interface AppLeg {
  id: string;
  /** Canonical place name when matched, otherwise the raw text. */
  pickup: string;
  drop: string;
  /** True when the name was matched to a known place. */
  pickupOk: boolean;
  dropOk: boolean;
  /** Original text read from the screenshot (shown when unmatched / for checking). */
  pickupRaw?: string;
  dropRaw?: string;
  commodity: string;
  scu: number;
}

export interface AppContract {
  id: string; // "C1", "C2"… always unique
  title: string;
  company: string;
  payout: number;
  maxContainerSize: number;
  enabled: boolean;
  legs: AppLeg[];
  source: "screenshot" | "manual" | "demo";
  /** Set when Gemini wasn't fully sure; cleared when the user confirms. */
  needsCheck?: string;
  addedAt: number;
}

export interface SavedRun {
  id: string;
  name: string;
  at: number;
  contracts: AppContract[];
  start: string | null;
  shipId: string | null;
}

export interface ShipOverride {
  scu?: number;
  containerSizes?: number[];
}

interface State {
  contracts: AppContract[];
  seq: number; // next contract number
  legSeq: number;
  start: string | null;
  returnToStart: boolean;
  shipId: string | null;
  ownedShipIds: string[];
  shipOverrides: Record<string, ShipOverride>;
  padOverrides: Record<string, PadSize>;
  distCache: Record<string, number | null>;
  flight: { signature: string; done: Record<string, boolean>; stop: number };
  dismissedTips: string[];
  savedRuns: SavedRun[];
  view: "plan" | "fly";
}

export type NewContract = Omit<AppContract, "id" | "addedAt" | "legs" | "enabled"> & { legs: Omit<AppLeg, "id">[] };

interface Actions {
  addContracts: (cs: NewContract[]) => string[];
  updateContract: (id: string, patch: Partial<AppContract>) => void;
  updateLeg: (contractId: string, legId: string, patch: Partial<AppLeg>) => void;
  addLeg: (contractId: string) => void;
  removeLeg: (contractId: string, legId: string) => void;
  removeContract: (id: string) => void;
  toggleContract: (id: string) => void;
  clearContracts: () => void;
  setStart: (name: string | null) => void;
  setReturnToStart: (v: boolean) => void;
  setShip: (id: string | null) => void;
  toggleOwned: (id: string) => void;
  setShipOverride: (id: string, o: ShipOverride | null) => void;
  setPad: (place: string, pad: PadSize | null) => void;
  mergeDistances: (d: Record<string, number | null>) => void;
  setFlight: (f: State["flight"]) => void;
  dismissTip: (key: string) => void;
  saveRun: (name: string) => void;
  loadRun: (id: string) => void;
  deleteRun: (id: string) => void;
  setView: (v: State["view"]) => void;
  importAll: (data: unknown) => boolean;
}

const initial: State = {
  contracts: [],
  seq: 1,
  legSeq: 1,
  start: null,
  returnToStart: false,
  shipId: null,
  ownedShipIds: [],
  shipOverrides: {},
  padOverrides: {},
  distCache: {},
  flight: { signature: "", done: {}, stop: 0 },
  dismissedTips: [],
  savedRuns: [],
  view: "plan",
};

/** Safe localStorage wrapper: private windows and blocked storage must not crash the app. */
const safeStorage = createJSONStorage(() => ({
  getItem: (k: string) => {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  setItem: (k: string, v: string) => {
    try { localStorage.setItem(k, v); } catch { /* full or blocked */ }
  },
  removeItem: (k: string) => {
    try { localStorage.removeItem(k); } catch { /* ignore */ }
  },
}));

export const useStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      ...initial,

      addContracts: (cs) => {
        const ids: string[] = [];
        set((s) => {
          let seq = s.seq;
          let legSeq = s.legSeq;
          const taken = new Set(s.contracts.map((c) => c.id));
          const added: AppContract[] = cs.map((c) => {
            let id = `C${seq++}`;
            while (taken.has(id)) id = `C${seq++}`;
            taken.add(id);
            ids.push(id);
            return {
              ...c,
              id,
              enabled: true,
              addedAt: Date.now(),
              legs: c.legs.map((l) => ({ ...l, id: `L${legSeq++}` })),
            };
          });
          return { contracts: [...s.contracts, ...added], seq, legSeq };
        });
        return ids;
      },

      updateContract: (id, patch) =>
        set((s) => ({ contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)) })),

      updateLeg: (contractId, legId, patch) =>
        set((s) => ({
          contracts: s.contracts.map((c) =>
            c.id !== contractId ? c : { ...c, legs: c.legs.map((l) => (l.id === legId ? { ...l, ...patch, id: l.id } : l)) }
          ),
        })),

      addLeg: (contractId) =>
        set((s) => ({
          legSeq: s.legSeq + 1,
          contracts: s.contracts.map((c) =>
            c.id !== contractId
              ? c
              : {
                  ...c,
                  legs: [
                    ...c.legs,
                    { id: `L${s.legSeq}`, pickup: "", drop: "", pickupOk: false, dropOk: false, commodity: "", scu: 0 },
                  ],
                }
          ),
        })),

      removeLeg: (contractId, legId) =>
        set((s) => ({
          contracts: s.contracts.map((c) => (c.id !== contractId ? c : { ...c, legs: c.legs.filter((l) => l.id !== legId) })),
        })),

      removeContract: (id) => set((s) => ({ contracts: s.contracts.filter((c) => c.id !== id) })),
      toggleContract: (id) =>
        set((s) => ({ contracts: s.contracts.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)) })),
      clearContracts: () => set({ contracts: [], flight: { signature: "", done: {}, stop: 0 } }),

      setStart: (name) => set({ start: name }),
      setReturnToStart: (v) => set({ returnToStart: v }),
      setShip: (id) => set({ shipId: id }),
      toggleOwned: (id) =>
        set((s) => ({
          ownedShipIds: s.ownedShipIds.includes(id) ? s.ownedShipIds.filter((x) => x !== id) : [...s.ownedShipIds, id],
        })),
      setShipOverride: (id, o) =>
        set((s) => {
          const next = { ...s.shipOverrides };
          if (o) next[id] = o;
          else delete next[id];
          return { shipOverrides: next };
        }),
      setPad: (place, pad) =>
        set((s) => {
          const next = { ...s.padOverrides };
          if (pad) next[place] = pad;
          else delete next[place];
          return { padOverrides: next };
        }),
      mergeDistances: (d) => set((s) => ({ distCache: { ...s.distCache, ...d } })),
      setFlight: (f) => set({ flight: f }),
      dismissTip: (key) => set((s) => ({ dismissedTips: [...s.dismissedTips.slice(-50), key] })),

      saveRun: (name) =>
        set((s) => ({
          savedRuns: [
            { id: `R${Date.now()}`, name: name.trim() || "Untitled run", at: Date.now(), contracts: s.contracts, start: s.start, shipId: s.shipId },
            ...s.savedRuns,
          ].slice(0, 50),
        })),
      loadRun: (id) => {
        const run = get().savedRuns.find((r) => r.id === id);
        if (!run) return;
        const maxSeq = Math.max(0, ...run.contracts.map((c) => Number(c.id.slice(1)) || 0));
        const maxLeg = Math.max(0, ...run.contracts.flatMap((c) => c.legs.map((l) => Number(l.id.slice(1)) || 0)));
        set({
          contracts: run.contracts,
          start: run.start,
          shipId: run.shipId ?? get().shipId,
          seq: Math.max(get().seq, maxSeq + 1),
          legSeq: Math.max(get().legSeq, maxLeg + 1),
          flight: { signature: "", done: {}, stop: 0 },
        });
      },
      deleteRun: (id) => set((s) => ({ savedRuns: s.savedRuns.filter((r) => r.id !== id) })),
      setView: (v) => set({ view: v }),

      importAll: (data) => {
        const d = data as Partial<State> | null;
        if (!d || typeof d !== "object" || !Array.isArray(d.contracts)) return false;
        set({ ...initial, ...d, distCache: get().distCache, view: "plan" } as State);
        return true;
      },
    }),
    {
      name: "haulers-log",
      version: 1,
      storage: safeStorage,
      partialize: (s) => {
        const { view: _view, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== "function")) as Partial<State>;
      },
    }
  )
);

export const exportAll = () => {
  const s = useStore.getState();
  const data = Object.fromEntries(Object.entries(s).filter(([k, v]) => typeof v !== "function" && k !== "distCache" && k !== "view"));
  return JSON.stringify({ app: "haulers-log", version: 1, ...data }, null, 2);
};
