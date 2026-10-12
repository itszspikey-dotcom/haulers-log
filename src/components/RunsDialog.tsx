import { useRef, useState } from "react";
import { Download, FolderOpen, Save, Trash2, Upload } from "lucide-react";
import { exportAll, useStore } from "../state/store";
import { Dialog, toast } from "./ui";

export function RunsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const runs = useStore((s) => s.savedRuns);
  const contracts = useStore((s) => s.contracts);
  const save = useStore((s) => s.saveRun);
  const load = useStore((s) => s.loadRun);
  const del = useStore((s) => s.deleteRun);
  const importAll = useStore((s) => s.importAll);
  const [name, setName] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const doExport = () => {
    const blob = new Blob([exportAll()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `haulers-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <Dialog open={open} onClose={onClose} title="Saved runs" width={560}>
      <form
        style={{ display: "flex", gap: 8, margin: "0 6px 14px" }}
        onSubmit={(e) => { e.preventDefault(); save(name || `Run ${new Date().toLocaleString()}`); setName(""); toast("Run saved"); }}
      >
        <input className="input" placeholder="Name this stack" value={name} onChange={(e) => setName(e.target.value)} aria-label="Run name" />
        <button className="pill primary" disabled={!contracts.length}><Save size={15} /> Save</button>
      </form>

      {runs.length === 0 && <p className="muted" style={{ margin: "0 6px 14px", fontSize: 13 }}>No saved runs yet.</p>}
      {runs.map((r) => (
        <div key={r.id} className="list-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 600, display: "block" }}>{r.name}</span>
            <span className="muted" style={{ fontSize: 12 }}>
              {r.contracts.length} contracts · {new Date(r.at).toLocaleDateString()}
            </span>
          </span>
          <button className="pill small" onClick={() => { load(r.id); toast(`Loaded “${r.name}”`); onClose(); }}><FolderOpen size={14} /> Load</button>
          <button className="icon-btn ghost" onClick={() => del(r.id)} aria-label={`Delete ${r.name}`}><Trash2 size={15} /></button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, margin: "18px 6px 0", flexWrap: "wrap" }}>
        <button className="pill small" onClick={doExport}><Download size={14} /> Export all data</button>
        <button className="pill small" onClick={() => file.current?.click()}><Upload size={14} /> Import</button>
        <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const ok = importAll(JSON.parse(await f.text()));
            toast(ok ? "Data imported" : "That file isn't a Hauler's Log export");
          } catch {
            toast("Couldn't read that file");
          }
        }} />
      </div>
    </Dialog>
  );
}
