import type { Place } from "../../shared/api";
import { matchPlace } from "../lib/match";
import type { NewContract } from "./store";

const RAW = [
  { title: "Direct Planetary Haul", company: "Covalex Shipping", payout: 48500, crate: 8,
    legs: [["Everus Harbor", "HDMS-Edmond", "Stims", 24]] },
  { title: "Multi-Pickup Supply Run", company: "Red Wind Linehaul", payout: 71250, crate: 16,
    legs: [["HDMS-Oparei", "Everus Harbor", "Scrap", 32], ["HDMS-Edmond", "Everus Harbor", "Waste", 16]] },
  { title: "Outpost Resupply", company: "Ling Family Hauling", payout: 62000, crate: 8,
    legs: [["Everus Harbor", "HDMS-Oparei", "Aluminum", 40]] },
  { title: "Interplanetary Freight", company: "Covalex Shipping", payout: 118000, crate: 16,
    legs: [["Lorville", "Port Tressler", "Processed Food", 64]] },
] as const;

/** Example stack for trying the app without the game. */
export function demoStack(places: Place[]): NewContract[] {
  return RAW.map((c) => ({
    title: c.title,
    company: c.company,
    payout: c.payout,
    maxContainerSize: c.crate,
    source: "demo" as const,
    legs: c.legs.map(([from, to, item, scu]) => {
      const p = matchPlace(from, places);
      const d = matchPlace(to, places);
      return {
        pickup: p.place?.name ?? from, drop: d.place?.name ?? to,
        pickupOk: !!p.place && p.confident, dropOk: !!d.place && d.confident,
        pickupRaw: from, dropRaw: to, commodity: item, scu,
      };
    }),
  }));
}
