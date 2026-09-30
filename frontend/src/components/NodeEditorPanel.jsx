import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  X, Plus, Trash2, Copy, ImagePlus, Check, Loader2,
  ArrowRight, ArrowLeft, Link2, ChevronDown, Maximize2, Minimize2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
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
// Заготовка проекта важнее словаря: её заводит шаблон под свой жанр, и её
// правят. Словарь остаётся для проектов, созданных до переезда подсказок в
// настройки — там подсказки по-прежнему переводятся вместе с интерфейсом.
const fieldTemplates = (typeId, projectFields) => {
  const own = projectFields?.[typeId];
  if (own?.length) return own;
  const dict = tList(`fieldTemplates.${typeId}`);
  return dict.length ? dict : tList("fieldTemplates.default");
};

const AUTOSAVE_MS = 900;

// Длинная сторона картинки после ужатия и потолок, ниже которого оригинал
// можно не трогать (≈300 КБ в base64).
//
// Потолок был втрое выше, и всё, что в него влезало, ложилось в базу как есть.
// Скриншот интерфейса в PNG — это как раз полмегабайта, а показывается он
// полоской в четверть карточки: сотня таких узлов превращалась в полсотни
// мегабайт, которые проект тащит целиком при каждом открытии.
const IMAGE_MAX_SIDE = 1400;
const IMAGE_MAX_CHARS = 300 * 1024;

export default function NodeEditorPanel({
  node, nodeTypes, onClose, onSave, onDelete, onDuplicate, onLiveChange, focusField,
  allNodes = [], allTags = [], connections = [], onOpenNode, onCreateNode, canvases = [],
  calendar, eras = [], fieldTemplates: projectFields, onChangeType, onLink, onUnlink,
}) {
  const tr = useT();
  const [draft, setDraft] = useState(null);
  const [seenType, setSeenType] = useState(null);
  const [typeOpen, setTypeOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
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
    setSeenType(node.typeId);
    setTypeOpen(false);
    setLinkOpen(false);
    setLinkQuery("");
  } else if (node && draft && node.typeId !== seenType) {
    // Тип сменили мимо панели — правым кликом по узлу. Черновик об этом не
    // знал, и первое же автосохранение после любой правки возвращало узлу
    // прежний тип: saveNode шлёт typeId из черновика.
    setSeenType(node.typeId);
    setDraft((d) => ({ ...d, typeId: node.typeId }));
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
        // Имя живёт в шапке панели, вне прокрутки, — доводить до него нечего.
        // Прежний scrollWithin здесь теперь только сбрасывал содержимое наверх.
        titleRef.current?.focus({ preventScroll: true });
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

  // Картинка живёт в базе строкой base64, поэтому оригинал класть туда нельзя:
  // фотография с телефона на 8 МБ превращается в 11 МБ текста внутри проекта,
  // и открывается он потом соответственно. Ужимаем до разумного размера —
  // в карточке узла всё равно показывается полоска в четверть экрана.
  const readImage = (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.width, img.height));
        if (scale === 1 && reader.result.length < IMAGE_MAX_CHARS) {
          set({ image: reader.result });
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // JPEG, а не PNG: скриншот интерфейса в PNG весит втрое больше при
        // неотличимом на такой ширине качестве. Прозрачность в карточке узла
        // всё равно не используется.
        set({ image: canvas.toDataURL("image/jpeg", 0.82) });
      };
      // Не разобралось как картинка — кладём как есть, чтобы не потерять файл.
      img.onerror = () => set({ image: reader.result });
      img.src = reader.result;
    };
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
  const templates = fieldTemplates(draft.typeId, projectFields)
    .filter((k) => !draft.fields.some((f) => f.key === k));
  const activeType = nodeTypes.find((t) => t.id === draft.typeId);

  // Тип меняется сразу и отдельным шагом отмены, как из меню узла, — а не
  // через автосохранение черновика: карточке на холсте нужен новый цвет и
  // значок тем же кадром, а не через секунду.
  const pickType = (typeId) => {
    setTypeOpen(false);
    if (typeId === draft.typeId) return;
    setSeenType(typeId);
    setDraft((d) => ({ ...d, typeId }));
    onChangeType?.(typeId);
  };

  // Кандидаты в связь: по имени, без себя и без тех, с кем связь уже есть.
  // Сначала те, чьё имя начинается с набранного, — их и ищут.
  const linkedIds = new Set(connections.map((c) => c.id));
  const q = linkQuery.trim().toLowerCase();
  const linkResults = linkOpen
    ? allNodes
      .filter((n) => n.id !== draft.id && !linkedIds.has(n.id)
        && (!q || (n.title || "").toLowerCase().includes(q)))
      .sort((a, b) => (q
        ? Number(!(a.title || "").toLowerCase().startsWith(q)) - Number(!(b.title || "").toLowerCase().startsWith(q))
        : 0))
      .slice(0, 8)
    : [];
  const pickLink = (targetId) => {
    onLink?.(targetId);
    setLinkQuery("");
    setLinkOpen(false);
  };

  const statusLabel = tr(`node.status.${status}`);

  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}

      transition={{ type: "tween", duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
      className="sw-dock h-full w-[26rem] shrink-0 border-l sw-panel sw-border-c z-20 flex flex-col"
      data-testid="node-editor-panel"
    >
      {/* Шапка панели повторяет шапку карточки: значок и название типа, а имя
          узла — крупной строкой под ними. Раньше здесь стояло имя мелким
          полужирным, и оно же дублировалось полем «Название» ниже. */}
      <div
        className="sw-typed px-6 pt-4 pb-3 border-b sw-border-c"
        style={{ "--node-color": activeType?.color || "#64748b" }}
      >
        <div className="flex items-center gap-2 mb-2.5">
          <span className="sw-node-badge-icon is-lg">
            <NodeIcon name={activeType?.icon} className="text-white" />
          </span>
          <span className="sw-node-type">{activeType?.label || tr("node.noType")}</span>
          <button onClick={onClose} data-testid="close-editor-btn" className="p-1.5 rounded-md sw-hover shrink-0" title={tr("node.close")}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="relative" data-testid="field-title">
          <AutoTextarea
            ref={titleRef}
            data-testid="node-title-input"
            value={draft.title}
            singleLine
            maxRows={3}
            placeholder={tr("common.untitled")}
            onFocus={() => setActiveField("title")}
            onChange={(e) => set({ title: e.target.value })}
            className="sw-panel-title bg-transparent border-0 px-0"
          />
        </div>
      </div>

      {/* layoutScroll: ползунок поля живёт внутри прокрутки, и без этой подсказки
          framer меряет его позицию от несдвинутого контейнера — на прокрученной
          панели он уезжал мимо поля. */}
      <motion.div layoutScroll ref={scrollRef} className="flex-1 sw-scroll-y px-6 py-6 space-y-6">
        {/* Тип выбирается здесь же. Раньше поле только выглядело выбором, а
            под ним стояла подсказка идти на холст и искать пункт в меню узла —
            поле, которое нельзя нажать, хуже, чем поле, которого нет. */}
        <div>
          <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{tr("common.type")}</label>
          <button
            type="button"
            data-testid="node-current-type"
            onClick={() => setTypeOpen((v) => !v)}
            aria-expanded={typeOpen}
            title={tr("node.changeType")}
            className="sw-type-pick mt-2 w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left"
            style={{ "--node-color": activeType?.color || "#64748b" }}
          >
            <span
              className="w-5 h-5 rounded flex items-center justify-center shrink-0"
              style={{ background: activeType?.color || "#64748b" }}
            >
              <NodeIcon name={activeType?.icon} className="w-3 h-3 text-white" />
            </span>
            <span className="text-sm flex-1 truncate">{activeType?.label || tr("node.noType")}</span>
            <ChevronDown className={`w-3.5 h-3.5 sw-text-dim shrink-0 transition-transform ${typeOpen ? "rotate-180" : ""}`} />
          </button>
          {typeOpen && (
            <div className="mt-1.5 grid grid-cols-2 gap-1 p-1 rounded-lg border sw-border-c sw-surface" data-testid="node-type-picker">
              {nodeTypes.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  data-testid={`node-type-option-${t.id}`}
                  onClick={() => pickType(t.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-left sw-hover
                    ${t.id === draft.typeId ? "bg-[var(--sw-hover)]" : ""}`}
                >
                  <span className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: t.color }}>
                    <NodeIcon name={t.icon} className="w-2.5 h-2.5 text-white" />
                  </span>
                  <span className="truncate flex-1">{t.label}</span>
                  {t.id === draft.typeId && <Check className="w-3 h-3 sw-accent-text shrink-0" />}
                </button>
              ))}
            </div>
          )}
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
                // key по узлу: редактор держит своё состояние правки, и под
                // чужой текст его надо заводить заново, а не донашивать прежнее.
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

        {/* Связи. Завести и убрать связь можно отсюда же: раньше список был
            только для чтения, а связь тянули мышью от точки на карточке —
            к узлу за краем экрана или на другом холсте её было не провести. */}
        <div>
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim flex items-center gap-2">
              <Link2 className="w-3 h-3" /> {tr("node.links")} {connections.length > 0 && `(${connections.length})`}
            </label>
            {onLink && (
              <button
                type="button"
                data-testid="add-link-btn"
                onClick={() => { setLinkOpen((v) => !v); setLinkQuery(""); }}
                className="flex items-center gap-1 text-xs sw-accent-text hover:opacity-80"
              >
                <Plus className="w-3.5 h-3.5" /> {tr("node.linkTo")}
              </button>
            )}
          </div>
          {linkOpen && (
            <div className="mt-2 rounded-lg border sw-border-c sw-surface p-1" data-testid="link-picker">
              <Input
                autoFocus
                data-testid="link-search-input"
                value={linkQuery}
                onChange={(e) => setLinkQuery(e.target.value)}
                onKeyDown={(e) => {
                  // Esc закрывает поиск, а не всю панель: общий обработчик
                  // редактора висит на window и иначе закрыл бы узел.
                  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setLinkOpen(false); }
                  if (e.key === "Enter" && linkResults[0]) { e.preventDefault(); pickLink(linkResults[0].id); }
                }}
                placeholder={tr("node.linkSearch")}
                className="bg-transparent border-0 text-xs h-8 focus-visible:ring-0"
              />
              <div className="max-h-56 sw-scroll-y">
                {linkResults.length === 0 && (
                  <p className="px-2.5 py-2 text-xs sw-text-dim">{tr("node.linkNothing")}</p>
                )}
                {linkResults.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    data-testid={`link-option-${n.id}`}
                    onClick={() => pickLink(n.id)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md sw-hover text-left"
                  >
                    <span
                      className="w-4 h-4 rounded flex items-center justify-center shrink-0"
                      style={{ background: n.nodeType?.color || "#64748b" }}
                    >
                      <NodeIcon name={n.nodeType?.icon} className="w-2.5 h-2.5 text-white" />
                    </span>
                    <span className="text-sm truncate flex-1">{n.title || tr("common.untitled")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1">
            {connections.length === 0 && !linkOpen && (
              <p className="text-xs sw-text-dim">{tr("node.noLinks")}</p>
            )}
            {connections.map((c) => (
              <div key={c.edgeId} className="group flex items-center rounded-lg sw-hover">
                <button
                  data-testid={`connection-${c.id}`}
                  onClick={() => onOpenNode && onOpenNode(c.id)}
                  className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  {c.outgoing
                    ? <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: c.color }} />
                    : <ArrowLeft className="w-3.5 h-3.5 shrink-0" style={{ color: c.color }} />}
                  <span className="text-sm truncate flex-1">{c.title || tr("common.untitled")}</span>
                  {c.label && <span className="text-[10px] sw-text-dim truncate max-w-[7rem]">{c.label}</span>}
                </button>
                {onUnlink && (
                  <button
                    type="button"
                    data-testid={`unlink-${c.id}`}
                    onClick={() => onUnlink(c.edgeId)}
                    title={tr("node.unlink")}
                    className="p-1.5 mr-1 rounded-md text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
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
              // items-start, а не center: поля разной высоты, и кнопка удаления
              // должна держаться верхней строки, а не уезжать к середине.
              <div key={f._k} className="flex items-start gap-2">
                <AutoTextarea
                  value={f.key}
                  singleLine
                  maxRows={3}
                  onChange={(e) => setField(i, { key: e.target.value })}
                  placeholder={tr("node.fieldPlaceholder")}
                  className="bg-transparent sw-border-c font-mono-sw text-xs py-2 leading-5"
                />
                <AutoTextarea
                  value={f.value}
                  maxRows={10}
                  onChange={(e) => setField(i, { value: e.target.value })}
                  placeholder={tr("node.valuePlaceholder")}
                  className="bg-transparent sw-border-c text-xs py-2 leading-5"
                />
                <button onClick={() => removeField(i)} className="p-1.5 mt-1 rounded-md hover:bg-red-500/10 text-red-400 shrink-0">
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
            {/* Статус вместо кнопки «Готово». Панель сохраняет сама, и крупная
                кнопка сохранения внушала, что без неё правка пропадёт, — а
                отдельная строка статуса под шапкой съедала высоту ради двух
                слов. Ctrl+S по-прежнему пишет сразу. */}
            <span
              className="flex-1 min-w-0 flex items-center gap-1.5 text-[11px] sw-text-dim"
              data-testid="autosave-status"
              title="Ctrl+S"
            >
              {status === "saving" ? <Loader2 className="w-3 h-3 animate-spin shrink-0" /> : null}
              {status === "saved" ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : null}
              <span className="truncate">{statusLabel}</span>
            </span>
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
