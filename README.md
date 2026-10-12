# Hauler's Log

A planner for stacked hauling contracts in **Star Citizen**.

- **Import contracts from screenshots** — paste, drop, or capture the game window; Gemini reads the mobiGlas.
- **Live optimal route** — the order of stops, what to load and unload where, crate breakdowns, and how full your hold gets. Updates as you add, edit or switch off contracts.
- **Ship advice** — which ships can fly the stack (hold size, crate sizes, landing pads, crew), which of yours fits best, and which contract to skip when one costs more flying than it pays.
- **Flight mode** — one big screen per stop with tick-boxes, for a second monitor or tablet.
- Saved runs, export/import, "Copy for Discord". Everything you enter stays in your browser.

Not affiliated with Cloud Imperium Games. Location, distance and ship data from [UEX](https://uexcorp.space).

---

## Run it in Google AI Studio

1. **Get the code into AI Studio**
   - With GitHub: push this folder to a GitHub repository, then in AI Studio → **Build** → **+ (Add files)** → **Import from GitHub**.
   - Without GitHub: in AI Studio, open the **Code** tab of an app and add or replace files to match this folder (see "Project layout").
2. **Add secrets** (Settings → Secrets):
   - `GEMINI_API_KEY` — usually created automatically by AI Studio. Enables screenshot reading.
   - `UEX_TOKEN` — free: sign in at uexcorp.space → API → My Apps → create an app → copy its **bearer token**. Enables every real location, distance and ship.
3. Run. Without keys the app still works in **demo mode** (a few Stanton locations, typed-in contracts).
4. When you want a public link: **Deploy → Cloud Run**.

If the AI Studio agent offers to rewrite `src/lib/optimizer.ts` or `src/lib/shipAdvisor.ts`, decline: they are tested (see below).

## Run it on your own computer

```bash
npm install
cp .env.example .env      # add your keys (optional)
npm run dev               # http://localhost:3000
```

Production: `npm run build && npm start`.

## Costs

- **Gemini**: the default model (`gemini-3.1-flash-lite`) has a free tier. A screenshot costs roughly a tenth of a cent on the paid tier. Use a key with no billing attached for personal use so it can never cost money.
- **UEX**: free (120 requests/minute; the server caches everything).
- Screenshots per visitor are capped at 60/hour (`PARSE_LIMIT_PER_HOUR`) so a public deployment can't drain your quota.

## Project layout

```
server.ts               Express server: API + serves the app
server/gemini.ts        screenshot → structured contracts (Gemini, JSON schema)
server/uex.ts           UEX API client with caching and rate limiting
server/demo.ts          demo locations/ships when no UEX token is set
shared/api.ts           types shared by server and browser
src/lib/optimizer.ts    route optimizer (pickup before drop, hold never over capacity)
src/lib/shipAdvisor.ts  ship checks, ranking, "what to drop" suggestions
src/lib/computePlan.ts  runs both for the UI (inside a Web Worker)
src/state/              app state (saved in the browser), import queue, live planner
src/components/         the screens
tests/                  logic, server and UI tests
```

## Tests

```bash
npm test                 # route optimizer + ship advisor + server (UEX/Gemini simulated)
PORT=3100 npm start &    # then:
npm run test:ui          # renders the app in jsdom and clicks through every main flow
```

The optimizer is checked against brute-force optimal routes, 200 random stacks for validity (pickup before drop, capacity, full delivery), and a 16-contract performance test.

## Ideas for later

- Pre-accept mode: rank combinations of the contracts *available* in the mobiGlas.
- Crew share link with live progress.
- 3D route map.
