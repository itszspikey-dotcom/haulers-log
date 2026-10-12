/**
 * Hauler's Log server
 * - serves the React app (Vite middleware in dev, built files with --prod)
 * - /api/* : Gemini screenshot reading + UEX data proxy (keys stay server-side)
 *
 * Environment:
 *   GEMINI_API_KEY   enables screenshot reading (AI Studio sets this automatically)
 *   UEX_TOKEN        enables real locations, distances and ships (uexcorp.space → API → My Apps)
 *   GEMINI_MODEL     optional, default gemini-3.1-flash-lite
 *   PARSE_LIMIT_PER_HOUR  optional, screenshots per visitor per hour, default 60
 *   PORT             optional, default 3000
 */
import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import type {
  DistancesRequest, DistancesResponse, ParseRequest, PlacesResponse, ShipsResponse, StatusResponse,
} from "./shared/api";
import { distKey } from "./shared/api";
import { geminiEnabled, geminiModel, parseContractImage } from "./server/gemini";
import { getDistances, getGameVersion, getPlaces, getShips, uexEnabled } from "./server/uex";
import { demoDistance, demoPlaces, demoShips } from "./server/demo";

const PROD = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
const PORT = Number(process.env.PORT) || 3000;
const VERSION = "1.0.0";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8mb" }));

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ───────── status ─────────
app.get("/api/status", wrap(async (_req, res) => {
  const body: StatusResponse = {
    gemini: geminiEnabled(),
    uex: uexEnabled(),
    model: geminiModel(),
    version: VERSION,
    gameVersion: uexEnabled() ? await getGameVersion() : undefined,
  };
  res.json(body);
}));

// ───────── places & ships ─────────
app.get("/api/places", wrap(async (_req, res) => {
  if (!uexEnabled()) return res.json({ places: demoPlaces, source: "demo" } satisfies PlacesResponse);
  try {
    res.json({ places: await getPlaces(), source: "uex", gameVersion: await getGameVersion() } satisfies PlacesResponse);
  } catch (e: any) {
    console.error(e);
    res.status(502).json({ error: `Couldn't load locations from UEX (${e.message}). Check UEX_TOKEN.` });
  }
}));

app.get("/api/ships", wrap(async (_req, res) => {
  if (!uexEnabled()) return res.json({ ships: demoShips, source: "demo" } satisfies ShipsResponse);
  try {
    res.json({ ships: await getShips(), source: "uex" } satisfies ShipsResponse);
  } catch (e: any) {
    console.error(e);
    res.status(502).json({ error: `Couldn't load ships from UEX (${e.message}).` });
  }
}));

app.post("/api/distances", wrap(async (req, res) => {
  const body = req.body as DistancesRequest;
  const pairs = (Array.isArray(body?.pairs) ? body.pairs : [])
    .filter((p) => Array.isArray(p) && p.length === 2 && p.every((n) => Number.isInteger(n) && n > 0))
    .slice(0, 400) as [number, number][];
  let distances: Record<string, number | null>;
  if (!uexEnabled()) {
    distances = {};
    for (const [a, b] of pairs) distances[distKey(a, b)] = demoDistance(a, b);
  } else {
    distances = await getDistances(pairs);
  }
  res.json({ distances } satisfies DistancesResponse);
}));

// ───────── screenshot reading (rate limited per visitor) ─────────
const LIMIT = Number(process.env.PARSE_LIMIT_PER_HOUR) || 60;
const hits = new Map<string, number[]>();
function allowed(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= LIMIT) return false;
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

app.post("/api/parse-contract", wrap(async (req, res) => {
  if (!geminiEnabled())
    return res.status(503).json({ error: "Screenshot reading is off: no GEMINI_API_KEY set on the server. You can still add contracts by hand." });
  const { image, mimeType } = (req.body ?? {}) as ParseRequest;
  if (typeof image !== "string" || image.length < 100 || !/^image\/(png|jpeg|webp)$/.test(String(mimeType)))
    return res.status(400).json({ error: "Send a PNG, JPEG or WebP screenshot." });
  if (image.length > 7_000_000) return res.status(413).json({ error: "Screenshot too large." });
  const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();
  if (!allowed(ip)) return res.status(429).json({ error: `Limit reached (${LIMIT} screenshots per hour). Try again later.` });
  try {
    res.json(await parseContractImage(image, mimeType));
  } catch (e: any) {
    console.error("parse-contract:", e?.message ?? e);
    const msg = String(e?.message ?? "");
    const status = /quota|rate|429|RESOURCE_EXHAUSTED/i.test(msg) ? 429 : 502;
    res.status(status).json({
      error: status === 429
        ? "Gemini's free limit was reached for now. Wait a minute and try again."
        : "Couldn't read that screenshot. Try again, or add the contract by hand.",
    });
  }
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  if (err?.type === "entity.too.large") return res.status(413).json({ error: "Screenshot too large." });
  res.status(500).json({ error: "Something went wrong on the server." });
});

// ───────── frontend ─────────
async function start() {
  if (PROD) {
    const dist = path.resolve("dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
      console.error('No build found. Run "npm run build" first.');
      process.exit(1);
    }
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Hauler's Log running on http://localhost:${PORT} (${PROD ? "production" : "dev"})`);
    console.log(`  Gemini screenshot reading: ${geminiEnabled() ? "on (" + geminiModel() + ")" : "off (set GEMINI_API_KEY)"}`);
    console.log(`  UEX data: ${uexEnabled() ? "on" : "demo data (set UEX_TOKEN)"}`);
  });
}
start();
