import { useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, Camera, Check, ChevronDown, Loader2, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { useStore, type AppContract } from "../state/store";
import { useData } from "../state/data";
import { importImages, useImports } from "../state/importer";
import { captureFrame } from "../lib/image";
import { fmt } from "../lib/format";
import { legReady } from "../state/planner";
import { PlacePicker } from "./PlacePicker";
import { Switch, toast } from "./ui";
import { StackFinder } from "./StackFinder";

const CRATES = [1, 2, 4, 8, 16, 32];

export function ContractsPanel() {
  const contracts = useStore((s) => s.contracts);
  const clear = useStore((s) => s.clearContracts);
  const enabled = contracts.filter((c) => c.enabled).length;
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  return (
    <section className="col-left" aria-label="Contracts">
      <div className="section-title">
        <h2>Contracts</h2>
        <span className="muted" style={{ fontWeight: 500, color: enabled > 16 ? "var(--orange)" : undefined }}>
          {enabled} of 16
        </span>
      </div>

      <DropZone onManual={(id) => setEditing(id)} />
      <ImportQueue />
      <StackFinder />

      <AnimatePresence initial={false}>
        {contracts.map((c, i) => (
          <motion.div
            key={c.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -30, transition: { duration: 0.2 } }}
            transition={{ duration: 0.5, delay: Math.min(i * 0.05, 0.4), ease: [0.2, 0.8, 0.2, 1] }}
          >
            <ContractCard c={c} editing={editing === c.id} onEdit={(v) => setEditing(v ? c.id : null)} />
          </motion.div>
        ))}
      </AnimatePresence>

      {contracts.length > 0 && (
        <button
          className="pill small"
          style={{ alignSelf: "center", marginTop: 4, color: armed ? "var(--red)" : undefined }}
          onClick={() => {
            if (armed) { clear(); setArmed(false); toast("Stack cleared"); }
            else { setArmed(true); setTimeout(() => setArmed(false), 3000); }
          }}
        >
          <Trash2 size={14} /> {armed ? "Tap again to clear all" : "Clear stack"}
        </button>
      )}
    </section>
  );
}

function DropZone({ onManual }: { onManual: (id: string) => void }) {
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const gemini = useData((d) => d.status?.gemini);
  const addContracts = useStore((s) => s.addContracts);

  const addManual = () => {
    const [id] = addContracts([{
      title: "New contract", company: "", payout: 0, maxContainerSize: 0, source: "manual",
      legs: [{ pickup: "", drop: "", pickupOk: false, dropOk: false, commodity: "", scu: 0 }],
    }]);
    onManual(id);
  };

  const capture = async () => {
    try {
      const blob = await captureFrame();
      importImages([blob]);
    } catch (e: any) {
      if (e?.name !== "NotAllowedError") toast(e?.message ?? "Capture failed");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        className={`dropzone ${gemini ? "breathe" : ""} ${over ? "over" : ""}`}
        onClick={() => (gemini ? file.current?.click() : addManual())}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const imgs = [...e.dataTransfer.files].filter((f) => f.type.startsWith("image/"));
          if (imgs.length && gemini) importImages(imgs);
        }}
      >
        <span className="icon"><Upload size={22} strokeWidth={1.8} /></span>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{gemini ? "Add screenshots" : "Add a contract"}</span>
          <span className="muted" style={{ fontSize: 13 }}>
            {gemini ? "Screenshot every contract on offer — paste with Ctrl V, drop, or capture" : "Screenshot reading is off on this server — type it in"}
          </span>
        </span>
      </button>
      <input
        ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden
        onChange={(e) => { if (e.target.files?.length) importImages([...e.target.files]); e.target.value = ""; }}
      />
      <div className="drop-actions">
        {gemini && (
          <button className="pill small" onClick={capture} title="Share your game window once, then capture contracts with one click">
            <Camera size={14} /> Capture game window
          </button>
        )}
        <button className="pill small" onClick={addManual}><Plus size={14} /> Type it in</button>
      </div>
    </div>
  );
}

function ImportQueue() {
  const items = useImports((s) => s.items);
  const dismiss = useImports((s) => s.dismiss);
  return (
    <AnimatePresence initial={false}>
      {items.map((it) => (
        <motion.div
          key={it.id} layout className="glass import-item"
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
        >
          {it.thumb ? <img src={it.thumb} alt="" /> : <span style={{ width: 56 }} />}
          <span style={{ flex: 1, color: it.status === "error" ? "var(--orange-text)" : undefined }}>
            {it.status === "reading" ? "Reading screenshot…" : it.message}
          </span>
          {it.status === "reading" && <Loader2 size={16} className="spin" color="var(--cyan)" />}
          {it.status === "done" && <Check size={16} color="var(--green)" />}
          {it.status === "error" && (
            <button className="icon-btn ghost" onClick={() => dismiss(it.id)} aria-label="Dismiss"><X size={15} /></button>
          )}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function ContractCard({ c, editing, onEdit }: { c: AppContract; editing: boolean; onEdit: (v: boolean) => void }) {
  const toggle = useStore((s) => s.toggleContract);
  const update = useStore((s) => s.updateContract);
  const incomplete = c.legs.filter((l) => !legReady(l)).length;

  return (
    <article className={`glass contract ${c.enabled ? "" : "off"}`}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="contract-title"><span className="contract-id">{c.id}</span>{c.title || "Untitled"}</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{c.company || "Unknown contractor"}</div>
        </div>
        <Switch checked={c.enabled} onChange={() => toggle(c.id)} label={`Include ${c.id} ${c.title}`} />
      </div>

      {!editing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {c.legs.map((l) => (
            <div className="leg-row" key={l.id}>
              <span className="route">
                <span className={l.pickupOk ? "" : "unmatched"}>{l.pickup || "?"}</span>
                <span className="faint"> → </span>
                <span className={l.dropOk ? "" : "unmatched"}>{l.drop || "?"}</span>
              </span>
              <span className="mono" style={{ color: l.scu ? "rgba(235,240,245,0.75)" : "var(--orange-text)" }}>{l.scu || "?"} SCU</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="payout">{fmt(c.payout)}</span>
        <span className="muted" style={{ fontSize: 12 }}>aUEC</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          {c.maxContainerSize > 0 && <span className="chip">{c.maxContainerSize} SCU crates</span>}
          <button className="icon-btn ghost" onClick={() => onEdit(!editing)} aria-label={editing ? "Done editing" : `Edit ${c.id}`} aria-expanded={editing}>
            {editing ? <ChevronDown size={16} style={{ transform: "rotate(180deg)" }} /> : <Pencil size={15} />}
          </button>
        </span>
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "visible" }}>
            <ContractEditor c={c} onDone={() => onEdit(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {!editing && (c.needsCheck || incomplete > 0) && (
        <button
          className={`note ${incomplete ? "orange" : "cyan"}`}
          style={{ background: "transparent", border: 0, borderTop: "1px solid rgba(255,255,255,0.07)", textAlign: "left", width: "100%", padding: "10px 0 0" }}
          onClick={() => { if (!incomplete && c.needsCheck) update(c.id, { needsCheck: undefined }); else onEdit(true); }}
        >
          <AlertCircle size={15} style={{ flex: "none" }} />
          <span style={{ flex: 1 }}>
            {incomplete
              ? `${incomplete} leg${incomplete > 1 ? "s" : ""} need a location or SCU — tap to fix`
              : c.needsCheck}
          </span>
          {!incomplete && <span style={{ fontWeight: 600 }}>Looks right</span>}
        </button>
      )}
    </article>
  );
}

function ContractEditor({ c, onDone }: { c: AppContract; onDone: () => void }) {
  const update = useStore((s) => s.updateContract);
  const updateLeg = useStore((s) => s.updateLeg);
  const addLeg = useStore((s) => s.addLeg);
  const removeLeg = useStore((s) => s.removeLeg);
  const remove = useStore((s) => s.removeContract);

  return (
    <div className="editor">
      <label className="field"><span>Title</span>
        <input className="input" value={c.title} onChange={(e) => update(c.id, { title: e.target.value })} />
      </label>
      <div className="grid2">
        <label className="field"><span>Contractor</span>
          <input className="input" value={c.company} onChange={(e) => update(c.id, { company: e.target.value })} />
        </label>
        <label className="field"><span>Payout (aUEC)</span>
          <input className="input mono" inputMode="numeric" value={c.payout || ""} placeholder="0"
            onChange={(e) => update(c.id, { payout: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
        </label>
      </div>
      <label className="field"><span>Largest crate</span>
        <select className="input" value={c.maxContainerSize} onChange={(e) => update(c.id, { maxContainerSize: Number(e.target.value) })}>
          <option value={0}>Not shown</option>
          {CRATES.map((s) => <option key={s} value={s}>{s} SCU</option>)}
        </select>
      </label>

      {c.legs.map((l, i) => (
        <div className="leg-editor" key={l.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="eyebrow">Cargo {i + 1}</span>
            {c.legs.length > 1 && (
              <button className="icon-btn ghost" onClick={() => removeLeg(c.id, l.id)} aria-label={`Remove cargo ${i + 1}`}><Trash2 size={14} /></button>
            )}
          </div>
          <label className="field"><span>From{l.pickupRaw && !l.pickupOk ? ` · read "${l.pickupRaw}"` : ""}</span>
            <PlacePicker label={`Cargo ${i + 1} pickup`} value={l.pickup} ok={l.pickupOk} raw={l.pickupRaw}
              onPick={(p) => p && updateLeg(c.id, l.id, { pickup: p.name, pickupOk: true })} />
          </label>
          <label className="field"><span>To{l.dropRaw && !l.dropOk ? ` · read "${l.dropRaw}"` : ""}</span>
            <PlacePicker label={`Cargo ${i + 1} drop`} value={l.drop} ok={l.dropOk} raw={l.dropRaw}
              onPick={(p) => p && updateLeg(c.id, l.id, { drop: p.name, dropOk: true })} />
          </label>
          <div className="grid2">
            <label className="field"><span>Commodity</span>
              <input className="input" value={l.commodity} onChange={(e) => updateLeg(c.id, l.id, { commodity: e.target.value })} />
            </label>
            <label className="field"><span>SCU</span>
              <input className={`input mono ${l.scu ? "" : "warn"}`} inputMode="numeric" value={l.scu || ""} placeholder="0"
                onChange={(e) => updateLeg(c.id, l.id, { scu: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
            </label>
          </div>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="pill small" onClick={() => addLeg(c.id)}><Plus size={14} /> Add cargo</button>
        <button className="pill small" onClick={() => { remove(c.id); toast(`Removed ${c.id}`); }}><Trash2 size={14} /> Delete</button>
        <button className="pill small primary" style={{ marginLeft: "auto" }} onClick={() => { update(c.id, { needsCheck: undefined }); onDone(); }}>
          <Check size={14} /> Done
        </button>
      </div>
    </div>
  );
}
