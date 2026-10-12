/// <reference lib="webworker" />
/** Runs planning off the main thread so the UI stays smooth while the stack changes. */
import { computePlan, type PlanJob, type PlanResult } from "../lib/computePlan";

self.onmessage = (e: MessageEvent<PlanJob>) => {
  const job = e.data;
  const t0 = performance.now();
  try {
    const result = computePlan(job);
    (self as unknown as Worker).postMessage({ ...result, id: job.id, ms: Math.round(performance.now() - t0) });
  } catch (err: any) {
    (self as unknown as Worker).postMessage({
      id: job.id, plan: null, basePlan: null, advice: null, drops: [], tooSmallOwned: [],
      ms: 0, error: err?.message ?? String(err),
    } satisfies PlanResult);
  }
};
