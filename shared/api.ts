/** Types shared by the server and the browser app. */

import type { Ship } from "../src/lib/shipAdvisor";

export interface Place {
  /** Canonical name used everywhere in the app (also the optimizer's location key). */
  name: string;
  /** UEX terminal id used for distance lookups. */
  terminalId: number;
  system: string;
  /** Planet / moon / orbit, for subtitles. */
  body: string;
  kind: "station" | "outpost" | "city" | "other";
  /** Other spellings seen in UEX data, used for fuzzy matching. */
  aliases: string[];
  hasLoadingDock?: boolean;
  hasFreightElevator?: boolean;
  maxContainer?: number;
}

export interface StatusResponse {
  gemini: boolean;
  uex: boolean;
  model: string;
  version: string;
  gameVersion?: string;
}

export interface PlacesResponse {
  places: Place[];
  source: "uex" | "demo";
  gameVersion?: string;
}

export interface ShipsResponse {
  ships: Ship[];
  source: "uex" | "demo";
}

export interface DistancesRequest {
  /** Pairs of terminal ids. */
  pairs: [number, number][];
}
export interface DistancesResponse {
  /** key "minId:maxId" → distance in Gm, or null when unknown */
  distances: Record<string, number | null>;
}

export interface ParsedLeg {
  pickup: string | null;
  drop: string | null;
  commodity: string | null;
  scu: number | null;
}
export interface ParsedContract {
  title: string | null;
  company: string | null;
  payout: number | null;
  maxContainerSize: number | null;
  legs: ParsedLeg[];
}
export interface ParseRequest {
  image: string; // base64, no data: prefix
  mimeType: string;
}
export interface ParseResponse {
  contracts: ParsedContract[];
  confidence: "high" | "medium" | "low";
  notes: string;
}

export interface ApiError {
  error: string;
}

export const distKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
