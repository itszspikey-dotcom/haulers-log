/**
 * UI smoke test: renders the real app in jsdom against the running server
 * (start it first: PORT=3100 npm start) and clicks through the main flows.
 */
import { JSDOM } from "jsdom";

const BASE = process.env.APP_URL ?? "http://localhost:3100";
const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`, { url: BASE, pretendToBeVisual: true });
const w = dom.window as any;

// ── browser globals the app expects ──
const g = globalThis as any;
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "SVGElement", "customElements", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "MutationObserver", "KeyboardEvent", "MouseEvent", "Event", "DOMParser", "localStorage", "ShadowRoot", "DocumentFragment", "CustomEvent", "HTMLTemplateElement"]) {
  try { g[k] = w[k]; } catch { /* read-only in node */ }
}
w.matchMedia = g.matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
g.ResizeObserver = w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
g.IntersectionObserver = w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
w.Element.prototype.animate = function () {
  return { finished: Promise.resolve(), cancel() {}, finish() {}, pause() {}, play() {}, onfinish: null, currentTime: 0, playState: "finished", effect: null, commitStyles() {} };
};
w.Element.prototype.scrollTo = () => {};
w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = () => {};
g.IS_REACT_ACT_ENVIRONMENT = false;
const realFetch = globalThis.fetch;
g.fetch = w.fetch = (input: any, init?: any) => realFetch(new URL(String(input), BASE), init);
w.confirm = () => true;

// Web Worker → run the same planning code in-process
const { computePlan } = await import("../src/lib/computePlan");
g.Worker = w.Worker = class {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  postMessage(job: any) {
    setTimeout(() => this.onmessage?.({ data: { ...computePlan(job), id: job.id, ms: 0 } }), 0);
  }
  terminate() {}
};

const errors: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => { errors.push(a.map(String).join(" ")); };

const { createRoot } = await import("react-dom/client");
const React = await import("react");
const { default: App } = await import("../src/App");

let fails = 0;
const ok = (cond: boolean, msg: string) => {
  if (!cond) { fails++; origError("  ✗ FAIL:", msg); } else console.log("  ✓", msg);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = () => w.document.body.textContent as string;
async function waitFor(fn: () => boolean, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (fn()) return true; await sleep(50); }
  return false;
}
const byText = (sel: string, t: string | RegExp) =>
  [...w.document.querySelectorAll(sel)].find((el: any) => (typeof t === "string" ? el.textContent.trim().includes(t) : t.test(el.textContent))) as any;
const click = (el: any) => el.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));

createRoot(w.document.getElementById("root")).render(React.createElement(App));

console.log("\n1. First load");
ok(await waitFor(() => text().includes("Your route appears here")), "empty state shown");
ok(await waitFor(() => text().includes("Demo mode")), "demo-mode banner shown (no UEX token)");
ok(text().includes("no GEMINI_API_KEY on the server"), "Gemini-off banner shown");

console.log("\n2. Example stack → live route");
click(byText("button", "Try an example stack"));
ok(await waitFor(() => w.document.querySelectorAll(".stop").length > 0 && text().includes("Unload")), "route computed and shown");
const stops = w.document.querySelectorAll(".stop");
ok(stops.length >= 5, `${stops.length} stops listed`);
ok(w.document.querySelectorAll(".contract").length === 4, "4 contract cards");
const ids = [...w.document.querySelectorAll(".contract-id")].map((e: any) => e.textContent);
ok(new Set(ids).size === ids.length, `contract ids unique: ${ids.join(", ")}`);
ok(text().includes("Recommended ship") || text().includes("Best ships"), "ship recommendation shown");

console.log("\n3. Pick a ship");
click(byText("button", "Pick ship"));
ok(await waitFor(() => text().includes("Your ships")), "fleet dialog opens");
const star = w.document.querySelector('[aria-label="Mark Cutlass Black as owned"]');
click(star);
ok(await waitFor(() => !!w.document.querySelector('[aria-label="Unmark Cutlass Black as owned"]')), "star a ship as owned");
click(byText(".dialog button", "Freelancer MAX"));
ok(await waitFor(() => !text().includes("Your ships") && byText(".ship-card", "Freelancer MAX") !== undefined), "Freelancer MAX selected");
ok(await waitFor(() => /Best fit|Fits|Extra runs/.test(byText(".ship-card", "Freelancer MAX")?.textContent ?? "")), "ship verdict badge shown");
ok(await waitFor(() => text().includes("Cutlass Black")), "owned Cutlass listed under other ships");

console.log("\n4. Smarter stack tip");
ok(await waitFor(() => text().includes("Smarter stack"), 8000), "tip suggests skipping the long-haul contract");
const stopsBefore = w.document.querySelectorAll(".stop").length;
click(byText("button", "Skip it"));
ok(await waitFor(() => w.document.querySelectorAll(".stop").length < stopsBefore), "skipping it shortens the route");
click(w.document.querySelector('[role="switch"][aria-checked="false"]'));
ok(await waitFor(() => w.document.querySelectorAll(".stop").length === stopsBefore), "switching it back on restores the route");

console.log("\n5. Manual contract with unknown location");
click(byText("button", "Type it in"));
ok(await waitFor(() => w.document.querySelectorAll(".contract").length === 5), "new contract added");
ok(await waitFor(() => !!w.document.querySelector(".editor")), "editor opens for it");
const ids2 = [...w.document.querySelectorAll(".contract-id")].map((e: any) => e.textContent);
ok(new Set(ids2).size === ids2.length && ids2.includes("C5"), `new id is unique (${ids2.join(", ")})`);

console.log("\n6. Flight mode");
click(byText(".segmented button", "Fly"));
ok(await waitFor(() => text().includes("Start at") && text().includes("Leaving with")), "flight view shows first stop");
const firstLoc = w.document.querySelector(".flight-loc")?.textContent;
click(byText("button", /Done — fly to/));
ok(await waitFor(() => w.document.querySelector(".flight-loc")?.textContent !== firstLoc && text().includes("Fly to")), "Done advances to the next stop");
ok(/Stop 2 of/.test(text()), "progress shows stop 2");
click(byText(".segmented button", "Plan"));
ok(await waitFor(() => text().includes("Contracts")), "back to plan mode");

console.log("\n7. Persistence");
const saved = JSON.parse(w.localStorage.getItem("haulers-log") ?? "{}");
ok(saved?.state?.contracts?.length === 5 && saved.state.ownedShipIds.length === 1, "stack and fleet saved in the browser");

await sleep(300);
const real = errors.filter((e) => !/not wrapped in act|ReactDOMTestUtils|was not wrapped/.test(e));
ok(real.length === 0, `no console errors${real.length ? ": " + real.slice(0, 3).join(" | ") : ""}`);

console.log(fails === 0 ? "\nALL UI TESTS PASSED" : `\n${fails} UI TEST(S) FAILED`);
process.exit(fails ? 1 : 0);
