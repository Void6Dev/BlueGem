import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useT } from "@/lib/i18n";
import { ENTRY_KEYS, isDateEmpty, normalizeDate } from "@/lib/chrono";
import { TextField } from "@/components/ui/text-field";
import { NodeIcon } from "@/components/NodeIcon";
import { DateValueEditor } from "@/components/chrono/DateField";

// Событие прямо со шкалы.
//
// Раньше, чтобы что-то появилось в хронологии, приходилось уходить на холст,
// создавать узел, открывать его панель и искать там раздел дат. Здесь то же
// самое делается в одном месте: новый узел с датой — или дата уже
// существующему узлу, если событие случилось с ним.

export default function AddEventPanel({ chrono, allNodes, types, initialDate, onSubmit, onClose }) {
  const tr = useT();
  const [mode, setMode] = useState("new");
  const [title, setTitle] = useState("");
  const defaultType = (types || []).find((t) => t.id === "event")?.id || types?.[0]?.id || "note";
  const [typeId, setTypeId] = useState(defaultType);
  const [query, setQuery] = useState("");
  const [nodeId, setNodeId] = useState(null);
  const [key, setKey] = useState("date");
  const [date, setDate] = useState(() => normalizeDate(initialDate) || normalizeDate({ kind: "exact" }));
  const [busy, setBusy] = useState(false);

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (allNodes || []).filter((n) => !needle || (n.title || "").toLowerCase().includes(needle));
    return list.slice(0, 8);
  }, [allNodes, query]);

  const ready = !isDateEmpty(date) && (mode === "new" ? !!title.trim() : !!nodeId);

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      await onSubmit({
        nodeId: mode === "existing" ? nodeId : null,
        title: title.trim(),
        typeId,
        key,
        date,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="tl-inspect tl-add sw-scroll-y" data-testid="timeline-add-panel">
      <div className="tl-inspect-head">
        <Plus className="w-3.5 h-3.5 sw-accent-text" />
        <strong className="truncate">{tr("timeline.add.title")}</strong>
        <button type="button" onClick={onClose} className="tl-tool ml-auto"><X className="w-3.5 h-3.5" /></button>
      </div>

      <div className="tl-add-modes">
        {["new", "existing"].map((m) => (
          <button
            key={m}
            type="button"
            className={`tl-add-mode${mode === m ? " tl-add-mode-on" : ""}`}
            onClick={() => setMode(m)}
            data-testid={`timeline-add-mode-${m}`}
          >
            {tr(`timeline.add.mode.${m}`)}
          </button>
        ))}
      </div>

      {mode === "new" ? (
        <div className="tl-add-block">
          <TextField
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
            placeholder={tr("timeline.add.namePlaceholder")}
            className="tl-add-input"
            data-testid="timeline-add-title"
          />
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="tl-select w-full"
            data-testid="timeline-add-type"
          >
            {(types || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
      ) : (
        <div className="tl-add-block">
          <label className="tl-search tl-add-search">
            <Search className="w-3.5 h-3.5 sw-text-dim shrink-0" />
            <TextField
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("timeline.add.findNode")}
              data-testid="timeline-add-search"
            />
          </label>
          <div className="tl-add-list">
            {found.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`tl-inspect-row${nodeId === n.id ? " tl-add-picked" : ""}`}
                onClick={() => setNodeId(n.id)}
                data-testid={`timeline-add-node-${n.id}`}
              >
                <span className="tl-empty-node-icon" style={{ background: n.nodeType?.color || "#64748b" }}>
                  <NodeIcon name={n.nodeType?.icon} className="w-2.5 h-2.5 text-white" />
                </span>
                <span className="truncate">{n.title || tr("common.untitled")}</span>
                {chrono.byNode.has(n.id) && <span className="sw-text-dim ml-auto">{chrono.byNode.get(n.id).length}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tl-add-block">
        <div className="tl-rail-head">{tr("timeline.add.what")}</div>
        <select
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="tl-select w-full"
          data-testid="timeline-add-key"
        >
          {ENTRY_KEYS.map((k) => <option key={k} value={k}>{tr(`chrono.entry.${k}`)}</option>)}
        </select>
      </div>

      <div className="tl-inspect-editor">
        <DateValueEditor
          value={date}
          onChange={setDate}
          nodes={allNodes || []}
          selfId={nodeId}
          calendar={chrono.calendar}
          eras={chrono.eras.placed}
        />
      </div>

      <button
        type="button"
        className="tl-inspect-open"
        disabled={!ready || busy}
        onClick={submit}
        data-testid="timeline-add-submit"
      >
        {tr(mode === "new" ? "timeline.add.create" : "timeline.add.attach")}
      </button>
    </aside>
  );
}
