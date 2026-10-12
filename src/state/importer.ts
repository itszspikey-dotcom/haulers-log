/** Screenshot import queue: shrink → Gemini → match locations → add to stack. */
import { create } from "zustand";
import type { ParsedContract, Place } from "../../shared/api";
import { blobToJpegBase64 } from "../lib/image";
import { matchPlace } from "../lib/match";
import { api, useData } from "./data";
import { useStore, type NewContract } from "./store";

export interface ImportItem {
  id: number;
  thumb?: string;
  status: "reading" | "done" | "error";
  message?: string;
}

interface ImportState {
  items: ImportItem[];
  dismiss: (id: number) => void;
}

export const useImports = create<ImportState>()((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

let seq = 0;
let running = 0;
const waiting: (() => void)[] = [];
const slot = () =>
  new Promise<void>((r) => {
    if (running < 2) { running++; r(); } else waiting.push(() => { running++; r(); });
  });
const release = () => { running--; waiting.shift()?.(); };

const patch = (id: number, p: Partial<ImportItem>) =>
  useImports.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));

export function toNewContract(pc: ParsedContract, places: Place[], confidence: string, notes: string): NewContract {
  const unsure: string[] = [];
  const legs = pc.legs.map((l) => {
    const p = matchPlace(l.pickup, places);
    const d = matchPlace(l.drop, places);
    if (l.pickup && !p.confident) unsure.push(`pickup "${l.pickup}"`);
    if (l.drop && !d.confident) unsure.push(`drop "${l.drop}"`);
    if (!l.scu) unsure.push("an SCU amount");
    return {
      pickup: p.confident && p.place ? p.place.name : p.place?.name ?? l.pickup ?? "",
      drop: d.confident && d.place ? d.place.name : d.place?.name ?? l.drop ?? "",
      pickupOk: p.confident,
      dropOk: d.confident,
      pickupRaw: l.pickup ?? undefined,
      dropRaw: l.drop ?? undefined,
      commodity: l.commodity ?? "",
      scu: Math.max(0, Math.round(l.scu ?? 0)),
    };
  });
  let needsCheck: string | undefined;
  if (unsure.length) needsCheck = `Check ${unsure.slice(0, 2).join(" and ")}${unsure.length > 2 ? "…" : ""}`;
  else if (confidence !== "high") needsCheck = notes ? `Double-check: ${notes}` : "Screenshot was hard to read — double-check the numbers.";
  if (pc.payout === null) needsCheck = needsCheck ?? "Payout wasn't readable.";
  return {
    title: pc.title ?? "Hauling contract",
    company: pc.company ?? "",
    payout: Math.round(pc.payout ?? 0),
    maxContainerSize: pc.maxContainerSize ?? 0,
    source: "screenshot",
    needsCheck,
    legs,
  };
}

const fingerprint = (c: { title: string; payout: number; legs: { scu: number; pickup: string; drop: string }[] }) =>
  `${c.title.toLowerCase()}|${c.payout}|${c.legs.map((l) => `${l.pickup}>${l.drop}:${l.scu}`).sort().join(",")}`;

export async function importImages(blobs: Blob[]) {
  for (const blob of blobs) {
    const id = ++seq;
    useImports.setState((s) => ({ items: [...s.items, { id, status: "reading" }] }));
    (async () => {
      await slot();
      try {
        const img = await blobToJpegBase64(blob);
        patch(id, { thumb: img.thumb });
        const res = await api.parse(img.data, img.mimeType);
        const places = useData.getState().places;
        const existing = new Set(useStore.getState().contracts.map(fingerprint));
        const fresh = res.contracts
          .filter((c) => c.legs.length > 0)
          .map((c) => toNewContract(c, places, res.confidence, res.notes))
          .filter((c) => !existing.has(fingerprint(c)));
        if (!fresh.length) {
          patch(id, {
            status: "error",
            message: res.contracts.length ? "Already in your stack." : res.notes || "No hauling contract found in this image.",
          });
          return;
        }
        useStore.getState().addContracts(fresh);
        patch(id, { status: "done", message: `Added ${fresh.length} contract${fresh.length > 1 ? "s" : ""}` });
        setTimeout(() => useImports.getState().dismiss(id), 2600);
      } catch (e: any) {
        patch(id, { status: "error", message: e?.message ?? "Couldn't read this screenshot." });
      } finally {
        release();
      }
    })();
  }
}
