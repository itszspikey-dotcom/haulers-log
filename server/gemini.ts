/**
 * Reads mobiGlas hauling contract screenshots with Gemini (structured JSON output).
 * Only used for reading screenshots — never for routing or ship choice.
 */
import { GoogleGenAI } from "@google/genai";
import type { ParseResponse, ParsedContract } from "../shared/api";

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
export const geminiEnabled = () => !!process.env.GEMINI_API_KEY?.trim();

let client: GoogleGenAI | null = null;
const ai = () => (client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() }));

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });

const SCHEMA = {
  type: "object",
  properties: {
    contracts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: nullable("string"),
          company: nullable("string", { description: "e.g. Covalex Shipping, Ling Family Hauling, Red Wind Linehaul" }),
          payout: nullable("number", { description: "Reward in aUEC, digits only" }),
          maxContainerSize: nullable("number", { description: "Largest crate size in SCU: 1, 2, 4, 8, 16 or 32" }),
          legs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pickup: nullable("string"),
                drop: nullable("string"),
                commodity: nullable("string"),
                scu: nullable("number"),
              },
              required: ["pickup", "drop", "commodity", "scu"],
            },
          },
        },
        required: ["title", "company", "payout", "maxContainerSize", "legs"],
      },
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["contracts", "confidence", "notes"],
};

const PROMPT = `You are reading a screenshot from the game Star Citizen: the mobiGlas Contract Manager showing one or more HAULING contracts.

Extract every hauling contract visible in its detail view (ignore list rows that only show a title).
For each contract:
- title: the contract title as shown.
- company: the contractor (e.g. Covalex Shipping, Ling Family Hauling, Red Wind Linehaul).
- payout: the reward in aUEC as a plain number (e.g. "48,500" -> 48500).
- maxContainerSize: the maximum container / crate size in SCU if stated (1, 2, 4, 8, 16 or 32), else null.
- legs: one entry per cargo movement. "Collect X SCU of Y from A ... deliver to B" becomes {pickup:A, drop:B, commodity:Y, scu:X}.
  If one pickup feeds several drops (or several pickups feed one drop), create one leg per pickup/drop pair with that pair's SCU.

Rules:
- Copy location names exactly as written (keep codes like "HDMS-Edmond", "S4DC05"). Do not translate or normalise.
- Never invent values. If something is unreadable or not shown, use null and say why in notes.
- confidence: "high" if all numbers and names are clearly legible, "medium" if some are uncertain, "low" if the image is blurry or not a hauling contract.
- If the image is not a hauling contract at all, return contracts: [] and explain in notes.`;

export async function parseContractImage(image: string, mimeType: string): Promise<ParseResponse> {
  const res = await ai().models.generateContent({
    model: geminiModel(),
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: image } }, { text: PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: SCHEMA,
      temperature: 0,
    },
  });
  const text = res.text ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned an unreadable answer. Try a sharper screenshot.");
  }
  return sanitize(parsed);
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const digits = v.replace(/[^\d.]/g, "");
    if (!/\d/.test(digits)) return null;
    const n = Number(digits);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const CRATES = [1, 2, 4, 8, 16, 32];

/** Never trust model output blindly: coerce types and drop junk. */
export function sanitize(raw: any): ParseResponse {
  const contracts: ParsedContract[] = (Array.isArray(raw?.contracts) ? raw.contracts : [])
    .slice(0, 20)
    .map((c: any) => {
      const crate = num(c?.maxContainerSize);
      return {
        title: str(c?.title),
        company: str(c?.company),
        payout: num(c?.payout),
        maxContainerSize: crate && CRATES.includes(crate) ? crate : null,
        legs: (Array.isArray(c?.legs) ? c.legs : []).slice(0, 12).map((l: any) => ({
          pickup: str(l?.pickup),
          drop: str(l?.drop),
          commodity: str(l?.commodity),
          scu: num(l?.scu),
        })),
      };
    });
  const confidence = ["high", "medium", "low"].includes(raw?.confidence) ? raw.confidence : "low";
  return { contracts, confidence, notes: str(raw?.notes) ?? "" };
}
