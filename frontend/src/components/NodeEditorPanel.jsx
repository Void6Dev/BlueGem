import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  X, Plus, Trash2, Save, Copy, ImagePlus, Check, Loader2,
  ArrowRight, ArrowLeft, Link2, MousePointerClick, Maximize2, Minimize2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NodeIcon } from "@/components/NodeIcon";
import MarkdownEditor from "@/components/MarkdownEditor";
import DateField from "@/components/chrono/DateField";
import { scrollWithin } from "@/lib/scrollWithin";
import { hotkey } from "@/lib/hotkey";
import { tList, useT } from "@/lib/i18n";

const RAIL_SPRING = { type: "spring", stiffness: 420, damping: 34 };

/** Ползунок, который переезжает к полю, выбранному на карточке. */
function FieldRail({ show }) {
  if (!show) return null;
  return <motion.span layoutId="sw-field-rail" className="sw-field-rail" transition={RAIL_SPRING} />;
}

// Suggested characteristics per node type — one click instead of typing the key.
// Подсказки переводятся: поле создаётся на языке, на котором человек работает.
const fieldTemplates = (typeId) => {
  const own = tList(`fieldTemplates.${typeId}`);
  return own.length ? own : tList("fieldTemplates.default");
};

const AUTOSAVE_MS = 900;

export default function NodeEditorPanel({
  node, nodeTypes, onClose, onSave, onDelete, onDuplicate, onLiveChange, focusField,
  allNodes = [], allTags = [], connections = [], onOpenNode, onCreateNode, canvases = [],
  calendar, eras = [],
}) {
  const tr = useT();
  const [draft, setDraft] = useState(null);
  const [tagInput, setTagInput] = useState("");
  const [descFull, setDescFull] = useState(false); // описание на весь экран
  const [status, setStatus] = useState("idle"); // idle | dirty | saving | saved
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeField, setActiveField] = useState(null); // "title" | "description"
  const fileRef = useRef(null);
  const descRef = useRef(null);
  const titleRef = useRef(null);
  const scrollRef = useRef(null);
  const timerRef = useRef(null);
  const draftRef = useRef(null);
  const statusRef = useRef("idle");
  const pendingFlush = useRef(null);
  const nodeId = node?.id;
  const [loadedId, setLoadedId] = useState(null);

  // Черновик перекладываем прямо во время отрисовки, а не эффектом: панель
  // теперь живёт между узлами, и эффект успел бы показать один кадр с чужими
  // значениями. Автосохранение при этом черновик не трогает — сверяем по id,
  // а не по объекту узла, который возвращает сервер.
  if (node && loadedId !== nodeId) {
    if (draft && statusRef.current === "dirty") pendingFlush.current = draft;
    setLoadedId(nodeId);
    setDraft({
      ...node,
      tags: node.tags || [],
      image: node.image || "",
      date: node.date || "",
      dates: Array.isArray(node.dates) ? node.dates : [],
      canvas: node.canvas || "",
      fields: (node.fields || []).map((f) => ({ ...f, _k: f._k || crypto.randomUUID() })),
    });
    setStatus("idle");
    setConfirmDelete(false);
    setTagInput("");
    setActiveField(null);
  }

  // Ушли с узла, не дописав правку, — дописываем её вдогонку.
  useEffect(() => {
    const stale = pendingFlush.current;
    if (!stale) return;
    pendingFlush.current = null;
    onSave(stale, { silent: true });
  });

  // Кликнули по названию или описанию прямо на карточке — ползунок переезжает
  // к нужному полю и оно получает курсор. Прокручиваем только если поле и
  // правда не видно: дёргать панель на каждый клик по узлу незачем.
  useEffect(() => {
    if (!focusField) return undefined;
    const which = focusField.field;
    setActiveField(which);
    const frame = requestAnimationFrame(() => {
      if (which === "title") {
        const el = titleRef.current;
        if (!el) return;
        // Крутим сам список панели, а не scrollIntoView: тот уводит вбок и всех
        // предков, вплоть до корневого экрана.
        scrollWithin(scrollRef.current, el);
        el.focus({ preventScroll: true });
        return;
      }
      const host = descRef.current?.element();
      if (host) scrollWithin(scrollRef.current, host);
      descRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusField]);

  draftRef.current = draft;
  statusRef.current = status;

  const flush = useCallback(async () => {
    if (!draftRef.current || status === "idle") return;
    clearTimeout(timerRef.current);
    setStatus("saving");
    await onSave(draftRef.current, { silent: true });
    setStatus("saved");
  }, [onSave, status]);

  // Debounced autosave — the panel is a document, not a form to submit.
  useEffect(() => {
    if (status !== "dirty" || !draft) return undefined;
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      await onSave(draftRef.current, { silent: true });
      setStatus("saved");
    }, AUTOSAVE_MS);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line
  }, [draft, status]);

  // Панель закрыли (Esc, крестик) — дописываем то, что не успел автосейв.
  // Переход на другой узел сюда больше не попадает: его закрывает pendingFlush.
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    if (statusRef.current === "dirty" && draftRef.current) {
      onSave(draftRef.current, { silent: true });
    }
    // eslint-disable-next-line
  }, []);

  // Ctrl+S — сохранить сейчас, Ctrl+Shift+E — блокнот на весь экран.
  // Клавишу читаем по коду: на кириллице e.key вернул бы «ы» и «у».
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = hotkey(e);
      if (k === "s" && !e.shiftKey) { e.preventDefault(); flush(); }
      else if (k === "e" && e.shiftKey) { e.preventDefault(); setDescFull((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flush]);

  // Esc из блокнота возвращает в панель, а не закрывает узел целиком. Слушаем
  // на перехвате и глушим событие: обработчик редактора висит на всплытии и
  // иначе успел бы закрыть всё разом.
  useEffect(() => {
    if (!descFull) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setDescFull(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [descFull]);

  if (!node || !draft) return null;

  // Правка уходит на карточку холста сразу, не дожидаясь автосохранения:
  // на диск пишем с задержкой, на экран — тем же кадром.
  const set = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus("dirty");
    onLiveChange?.(draft.id, patch);
  };

  const addTag = (value) => {
    const t = (value ?? tagInput).trim().replace(/^#/, "");
    if (!t || draft.tags.includes(t)) { setTagInput(""); return; }
    set({ tags: [...draft.tags, t] });
    setTagInput("");
  };
  const removeTag = (t) => set({ tags: draft.tags.filter((x) => x !== t) });
  const setField = (i, patch) =>
    set({ fields: draft.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)) });
  const addField = (key = "") =>
    set({ fields: [...draft.fields, { key, value: "", _k: crypto.randomUUID() }] });
  const removeField = (i) => set({ fields: draft.fields.filter((_, idx) => idx !== i) });

  const readImage = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => set({ image: reader.result });
    reader.readAsDataURL(file);
  };
  const onImageFile = (e) => {
    readImage(e.target.files?.[0]);
    e.target.value = "";
  };
  // Ctrl+V straight into the description pastes a screenshot as the node image.
  const onDescPaste = (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    readImage(item.getAsFile());
  };

  // Живой редактор — один и тот же и в панели, и на весь экран. Разметку он
  // ведёт сам, панели остаётся отдать текст и обработчик вставки картинки.
  const descEditorProps = {
    value: draft.description || "",
    onChange: (description) => set({ description }),
    nodes: allNodes,
    onOpenNode,
    onCreateNode,
    onPaste: onDescPaste,
  };

  const suggestions = allTags.filter(
    (t) => !draft.tags.includes(t) && t.toLowerCase().includes(tagInput.trim().toLowerCase())
  ).slice(0, 6);
  const templates = fieldTemplates(draft.typeId)
    .filter((k) => !draft.fields.some((f) => f.key === k));
  const activeType = nodeTypes.find((t) => t.id === draft.typeId);

  const statusLabel = tr(`node.status.${status}`);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}

      transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-0 right-0 h-full w-full sm:w-[26rem] border-l sw-panel sw-border-c z-20 flex flex-col"
      data-testid="node-editor-panel"
    >
      <div className="flex items-center justify-between px-6 py-4 border-b sw-border-c">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{ background: activeType?.color || "#64748b" }}
          >
            <NodeIcon name={activeType?.icon} className="w-3.5 h-3.5 text-white" />
          </span>
          <span className="text-sm font-semibold truncate">{draft.title || tr("common.untitled")}</span>
        </div>
        <button onClick={onClose} data-testid="close-editor-btn" className="p-1.5 rounded-md sw-hover" title={tr("node.close")}>
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-6 py-2 border-b sw-border-c flex items-center gap-1.5 text-[11px] sw-text-dim" data-testid="autosave-status">
        {status === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {status === "saved" ? <Check className="w-3 h-3 text-emerald-400" /> : null}
        {statusLabel}
      </div>

      {/* layoutScroll: ползунок поля живёт внутри прокрутки, и без этой подсказки
          framer меряет его позицию от несдвинутого контейнера — на прокрученной
          панели он уезжал мимо поля. */}
      <motion.div layoutScroll ref={scrollRef} className="flex-1 sw-scroll-y px-6 py-6 space-y-6">
        {/* Тип меняется правым кликом по узлу — здесь только текущее значение. */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("common.type")}</label>
          <div
            data-testid="node-current-type"
            className="mt-2 flex items-center gap-2 px-3 py-2.5 rounded-lg border"
            style={{
              borderColor: `${activeType?.color || "#64748b"}66`,
              background: `${activeType?.color || "#64748b"}14`,
            }}
          >
            <span
              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
              style={{ background: activeType?.color || "#64748b" }}
            >
              <NodeIcon name={activeType?.icon} className="w-3 h-3 text-white" />
            </span>
            <span className="text-sm flex-1 truncate">{activeType?.label || tr("node.noType")}</span>
            <MousePointerClick className="w-3.5 h-3.5 sw-text-dim shrink-0" />
          </div>
          <p className="mt-1.5 text-[11px] sw-text-dim">
            {tr("node.typeHint")}
          </p>
        </div>

        <div className="relative pl-3" data-testid="field-title">
          <FieldRail show={activeField === "title"} />
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("common.name")}</label>
          <Input
            ref={titleRef}
            data-testid="node-title-input"
            value={draft.title}
            onFocus={() => setActiveField("title")}
            onChange={(e) => set({ title: e.target.value })}
            className="mt-2 bg-transparent sw-border-c"
          />
        </div>

        {/* Даты узла — их может быть несколько — и холст, на котором он лежит. */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("node.date")}</label>
          <div className="mt-2">
            <DateField
              value={draft.dates}
              onChange={(dates) => set({ dates })}
              nodes={allNodes}
              selfId={draft.id}
              calendar={calendar}
              eras={eras}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {canvases.length > 1 && (
            <div>
              <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("node.canvas")}</label>
              <select
                data-testid="node-canvas-select"
                value={draft.canvas || canvases[0].id}
                onChange={(e) => set({ canvas: e.target.value })}
                className="mt-2 w-full h-9 rounded-md border sw-border-c bg-transparent text-xs px-2"
              >
                {canvases.map((c) => (
                  <option key={c.id} value={c.id} style={{ background: "var(--sw-surface)", color: "var(--sw-text)" }}>{c.label}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="relative pl-3" data-testid="field-description">
          <FieldRail show={activeField === "description"} />
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("common.description")}</label>
            <button
              data-testid="desc-expand-btn"
              onClick={() => setDescFull(true)}
              title={`${tr("node.expand")} · Ctrl+Shift+E`}
              className="p-1.5 rounded-md border sw-border-c sw-text-dim sw-hover"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {descFull ? (
            // Текст уехал в блокнот. На его месте заглушка, а не второй
            // редактор: два экземпляра на один и тот же текст сбивали бы
            // друг другу курсор.
            <button
              data-testid="desc-return-btn"
              onClick={() => setDescFull(false)}
              className="mt-2 w-full min-h-[10.5rem] rounded-lg border border-dashed sw-border-c flex flex-col items-center justify-center gap-2 text-xs sw-text-dim sw-hover"
            >
              <Maximize2 className="w-4 h-4" />
              {tr("node.openedFull")}
            </button>
          ) : (
            <div
              className="mt-2 rounded-lg border sw-border-c px-3.5 py-3"
              style={{ background: "color-mix(in srgb, var(--sw-bg) 55%, transparent)" }}
              onFocusCapture={() => setActiveField("description")}
            >
              <MarkdownEditor
                // key по узлу: у редактора своя разбивка на блоки, и её надо
                // собрать заново под чужой текст, а не донашивать прежнюю.
                key={nodeId}
                ref={descRef}
                {...descEditorProps}
                className="flex flex-col gap-2"
                listClassName="min-h-[8rem]"
                toolbarScroll
              />
            </div>
          )}
          <p className="mt-1.5 text-[11px] sw-text-dim flex items-center justify-between gap-2">
            <span>{tr("node.markdownHint", { code: `[[${tr("edge.node")}]]` })}</span>
            <span className="font-mono-sw shrink-0">{(draft.description || "").length}</span>
          </p>
        </div>

        {/* Connections */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim flex items-center gap-2">
            <Link2 className="w-3 h-3" /> {tr("node.links")} {connections.length > 0 && `(${connections.length})`}
          </label>
          <div className="mt-2 space-y-1">
            {connections.length === 0 && (
              <p className="text-xs sw-text-dim">{tr("node.noLinks")}</p>
            )}
            {connections.map((c) => (
              <button
                key={c.edgeId}
                data-testid={`connection-${c.id}`}
                onClick={() => onOpenNode && onOpenNode(c.id)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg sw-hover text-left"
              >
                {c.outgoing
                  ? <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: c.color }} />
                  : <ArrowLeft className="w-3.5 h-3.5 shrink-0" style={{ color: c.color }} />}
                <span className="text-sm truncate flex-1">{c.title || tr("common.untitled")}</span>
                {c.label && <span className="text-[10px] sw-text-dim truncate max-w-[7rem]">{c.label}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Image */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("node.image")}</label>
          {draft.image ? (
            <div className="mt-2 relative">
              <img src={draft.image} alt="" className="w-full max-h-48 object-cover rounded-lg border sw-border-c" />
              <button
                data-testid="remove-image-btn"
                onClick={() => set({ image: "" })}
                className="absolute top-2 right-2 p-1.5 rounded-md bg-black/60 hover:bg-black/80 text-white"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <button
                data-testid="upload-image-btn"
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); readImage(e.dataTransfer.files?.[0]); }}
                className="w-full flex items-center justify-center gap-2 py-6 rounded-lg border border-dashed sw-border-c text-sm sw-text-dim sw-hover"
              >
                <ImagePlus className="w-4 h-4" /> {tr("node.upload")}
              </button>
              <Input
                data-testid="image-url-input"
                value={draft.image}
                onChange={(e) => set({ image: e.target.value })}
                placeholder={tr("node.imageUrl")}
                className="bg-transparent sw-border-c text-xs h-9"
              />
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" onChange={onImageFile} className="hidden" />
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("node.tagsLabel")}</label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {draft.tags.map((t) => (
              <span
                key={t}
                data-testid={`node-tag-${t}`}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full text-xs border sw-border-c"
              >
                #{t}
                <button onClick={() => removeTag(t)} className="p-0.5 rounded-full hover:bg-red-500/10 text-red-400">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
          <Input
            data-testid="node-tag-input"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
              if (e.key === "Backspace" && !tagInput && draft.tags.length) removeTag(draft.tags[draft.tags.length - 1]);
            }}
            placeholder={tr("node.tagPlaceholder")}
            className="mt-2 bg-transparent sw-border-c text-xs h-9"
          />
          {/* Строка подсказок пересчитывается на каждое нажатие клавиши. Если её
              то показывать, то убирать — всё, что ниже, прыгает вверх-вниз;
              поэтому место под неё занято всегда, а сами подсказки не
              переносятся на вторую строку, а уезжают вбок. */}
          <div
            className="mt-1.5 h-[1.375rem] flex items-center gap-1.5 overflow-x-auto sw-no-scrollbar"
            data-testid="tag-suggestions"
          >
            {suggestions.map((t) => (
              <button
                key={t}
                onClick={() => addTag(t)}
                className="shrink-0 text-[11px] px-2 py-0.5 rounded-full border sw-border-c sw-text-dim sw-hover"
              >
                + {t}
              </button>
            ))}
          </div>
        </div>

        {/* Custom fields */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("node.customFields")}</label>
            <button
              data-testid="add-field-btn"
              onClick={() => addField()}
              className="flex items-center gap-1 text-xs sw-accent-text hover:opacity-80"
            >
              <Plus className="w-3.5 h-3.5" /> {tr("common.add")}
            </button>
          </div>
          {templates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {templates.map((k) => (
                <button
                  key={k}
                  onClick={() => addField(k)}
                  className="text-[11px] px-2 py-0.5 rounded-full border sw-border-c sw-text-dim sw-hover"
                >
                  + {k}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2">
            {draft.fields.map((f, i) => (
              <div key={f._k} className="flex items-center gap-2">
                <Input
                  value={f.key}
                  onChange={(e) => setField(i, { key: e.target.value })}
                  placeholder={tr("node.fieldPlaceholder")}
                  className="bg-transparent sw-border-c font-mono-sw text-xs h-9"
                />
                <Input
                  value={f.value}
                  onChange={(e) => setField(i, { value: e.target.value })}
                  placeholder={tr("node.valuePlaceholder")}
                  className="bg-transparent sw-border-c text-xs h-9"
                />
                <button onClick={() => removeField(i)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 shrink-0">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="px-6 py-4 border-t sw-border-c flex items-center gap-2">
        {confirmDelete ? (
          <>
            <span className="text-xs sw-text-dim flex-1">{tr("node.confirmDelete")}</span>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} className="text-xs h-9">{tr("common.cancel")}</Button>
            <Button
              data-testid="confirm-delete-node-btn"
              onClick={() => onDelete(draft.id)}
              className="bg-red-600 text-white hover:bg-red-700 border-0 h-9 text-xs"
            >
              {tr("common.delete")}
            </Button>
          </>
        ) : (
          <>
            <Button
              data-testid="save-node-btn"
              onClick={() => onSave(draft, { close: true })}
              className="flex-1 sw-accent-bg text-white border-0 hover:opacity-90 gap-2"
            >
              <Save className="w-4 h-4" /> {tr("common.done")}
            </Button>
            {onDuplicate && (
              <Button
                data-testid="duplicate-node-btn"
                variant="ghost"
                onClick={() => onDuplicate(draft)}
                title={tr("node.duplicateHint")}
                className="sw-text-dim sw-hover"
              >
                <Copy className="w-4 h-4" />
              </Button>
            )}
            <Button
              data-testid="delete-node-btn"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-red-400 hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </>
        )}
      </div>

      {/* Блокнот на весь экран. Портал в body обязателен: у панели есть
          transform от framer, а он делает её точкой отсчёта для fixed —
          оверлей иначе лёг бы внутрь колонки в 26rem. */}
      {/* Без AnimatePresence: в портале она доигрывала исчезновение, но узел из
          DOM не убирала — прозрачный оверлей оставался поверх всего и ловил
          клики. Появление анимируем, уход мгновенный. */}
      {descFull && createPortal(
        (
          (
            <motion.div
              key="desc-full"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="fixed inset-0 z-[60] flex flex-col sw-panel"
              data-testid="desc-fullscreen"
            >
              <div className="flex items-center justify-between gap-3 px-6 py-3 border-b sw-border-c">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: activeType?.color || "#64748b" }}
                  >
                    <NodeIcon name={activeType?.icon} className="w-3.5 h-3.5 text-white" />
                  </span>
                  <span className="text-sm font-semibold truncate">{draft.title || tr("common.untitled")}</span>
                  <span className="flex items-center gap-1.5 text-[11px] sw-text-dim shrink-0 ml-2">
                    {status === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                    {status === "saved" ? <Check className="w-3 h-3 text-emerald-400" /> : null}
                    {statusLabel}
                  </span>
                </div>
                <button
                  data-testid="desc-collapse-btn"
                  onClick={() => setDescFull(false)}
                  title={`${tr("node.collapse")} · Esc`}
                  className="p-1.5 rounded-md border sw-border-c sw-text-dim sw-hover shrink-0"
                >
                  <Minimize2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Колонка ограничена по ширине: строка на весь монитор читается
                  плохо, а блокнот — это про чтение и письмо. */}
              <div className="flex-1 min-h-0 flex justify-center">
                <div className="w-full max-w-[54rem] h-full flex flex-col px-6 sm:px-10 py-5 gap-3">
                  <MarkdownEditor
                    key={`full-${nodeId}`}
                    {...descEditorProps}
                    className="flex-1 min-h-0 flex flex-col gap-3"
                    listClassName="sw-mde-lg flex-1 min-h-0 sw-scroll-y pr-1"
                  />
                  <p className="text-[11px] sw-text-dim flex items-center justify-between gap-2 shrink-0">
                    <span>{tr("node.markdownHint", { code: `[[${tr("edge.node")}]]` })}</span>
                    <span className="font-mono-sw shrink-0">{(draft.description || "").length}</span>
                  </p>
                </div>
              </div>
            </motion.div>
          )
        ),
        document.body
      )}
    </motion.div>
  );
}
