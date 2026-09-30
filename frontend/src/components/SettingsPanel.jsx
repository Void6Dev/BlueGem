import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import {
  X, Plus, Trash2, Sun, Moon, Check, ChevronUp, ChevronDown, Layers, Languages,
  FolderOpen, Palette, Share2, Shapes, Link2, CalendarRange,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NodeIcon } from "@/components/NodeIcon";
import { Segmented } from "@/components/ui/segmented";
import {
  FONT_OPTIONS, DISPLAY_FONT_OPTIONS, ACCENT_OPTIONS, TYPE_COLORS, ICON_OPTIONS, EDGE_SHAPES,
  DEFAULT_SETTINGS, DEFAULT_EDGE_COLOR, relTypesOf, fontStack, accentForeground,
} from "@/lib/settings";
import { LANGUAGES, getLanguage, setLanguage, tList, useT } from "@/lib/i18n";
import { scrollWithin } from "@/lib/scrollWithin";
import CalendarEditor from "@/components/chrono/CalendarEditor";
import EraEditor from "@/components/chrono/EraEditor";

/**
 * Поле «добавить подсказку». Своё состояние здесь, а не в панели: иначе один
 * черновик был бы общим на все типы узлов, и набранное для персонажа
 * подставлялось бы в поле фракции.
 *
 * Enter, а не blur: синтетический blur приходит и при уходе из панели, и
 * недописанное слово молча попадало бы в набор.
 */
function FieldKeyAdder({ placeholder, onAdd }) {
  const [value, setValue] = useState("");
  return (
    <Input
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        if (onAdd(value)) setValue("");
      }}
      className="mt-2 bg-transparent sw-border-c h-8 text-xs"
    />
  );
}

function Section({ title, children }) {
  return (
    <section>
      <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{title}</label>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

// Раздел, открытый в прошлый раз, — на время работы приложения: настройки
// открывают, чтобы поправить одно и то же несколько раз подряд.
let lastSection = "project";

export default function SettingsPanel({
  settings, onChange, onClose, project, onProjectChange, typeUsage = {}, canvasUsage = {},
  relUsage = {}, highlightType, onHighlighted,
}) {
  const t = useT();
  const s = settings;
  const set = (patch) => onChange({ ...s, ...patch });
  const [iconPickerFor, setIconPickerFor] = useState(null);
  const lang = getLanguage();
  const typeRefs = useRef({});
  const scrollRef = useRef(null);
  const [addedType, setAddedType] = useState(null);
  const [confirm, setConfirm] = useState(null); // { text, run } — своё подтверждение
  const spotlight = highlightType || addedType;
  const [section, setSectionState] = useState(() => (highlightType ? "types" : lastSection));
  const setSection = (id) => { lastSection = id; setSectionState(id); };

  // Тип создали или попросили настроить — из дерева, меню или прямо здесь
  // кнопкой «Тип». Доводим человека до него: открываем раздел типов,
  // прокручиваем, подсвечиваем и ставим курсор в название.
  useEffect(() => {
    if (!spotlight) return undefined;
    if (section !== "types") { setSection("types"); return undefined; }
    const box = typeRefs.current[spotlight];
    if (!box) return undefined;
    scrollWithin(scrollRef.current, box, "center");
    box.classList.add("sw-flash");
    // Таймеры доигрывают сами, без отмены: просьбу подсветить гасим сразу,
    // иначе, пока длится вспышка, уйти в другой раздел было нельзя — эффект
    // возвращал обратно в типы.
    setTimeout(() => {
      const input = box.querySelector("input:not([type=color])");
      input?.focus({ preventScroll: true });
      input?.select();
    }, 320);
    setTimeout(() => box.classList.remove("sw-flash"), 1700);
    setAddedType(null);
    onHighlighted?.();
    return undefined;
    // eslint-disable-next-line
  }, [spotlight, section]);

  const canvases = s.canvases?.length ? s.canvases : [{ id: "main", label: t("editor.mainCanvas") }];

  const addType = () => {
    const id = `custom-${Date.now()}`;
    set({ nodeTypes: [...s.nodeTypes, { id, label: t("settings.newType"), color: "#2E9BD6", icon: "Star" }] });
    setAddedType(id);
  };
  const updateType = (id, patch) =>
    set({ nodeTypes: s.nodeTypes.map((type) => (type.id === id ? { ...type, ...patch } : type)) });
  // Подтверждение — своим диалогом, а не window.confirm: системное окно Windows
  // поверх тёмной панели выглядит как чужое приложение, да ещё и подвешивает
  // отрисовку до ответа.
  const removeType = (id) => {
    const used = typeUsage[id] || 0;
    if (used) {
      setConfirm({
        text: t("settings.confirmDeleteType", { count: t("count.nodes", { count: used }) }),
        run: () => set({ nodeTypes: s.nodeTypes.filter((type) => type.id !== id) }),
      });
      return;
    }
    set({ nodeTypes: s.nodeTypes.filter((type) => type.id !== id) });
  };
  const moveType = (id, dir) => {
    const list = [...s.nodeTypes];
    const i = list.findIndex((type) => type.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    set({ nodeTypes: list });
  };

  // Типы связей и подсказки характеристик у старого проекта пусты: он создан
  // до того, как эти наборы переехали в настройки, и живёт на встроенном
  // списке. Показываем встроенный, а первая же правка кладёт весь набор в
  // проект целиком — дальше он принадлежит ему и переводиться перестаёт.
  const relTypes = s.relTypes?.length ? s.relTypes : relTypesOf(s, t).filter((r) => r.id);
  const setRelTypes = (list) => set({ relTypes: list });
  const addRelType = () => setRelTypes([
    ...relTypes,
    { id: `rel-${Date.now()}`, label: t("settings.newRelType"), color: DEFAULT_EDGE_COLOR },
  ]);
  const updateRelType = (id, patch) =>
    setRelTypes(relTypes.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRelType = (id) => {
    const used = relUsage[id] || 0;
    const drop = () => setRelTypes(relTypes.filter((r) => r.id !== id));
    // Связи не трогаем: у них останется тип, которого нет в наборе, и линия
    // просто покажется обычной. Вернуть тип в набор дешевле, чем переназначать
    // его сотне линий, — поэтому удаление здесь не каскадное.
    if (used) {
      setConfirm({ text: t("settings.confirmDeleteRelType", { count: t("count.edges", { count: used }) }), run: drop });
      return;
    }
    drop();
  };
  const moveRelType = (id, dir) => {
    const list = [...relTypes];
    const i = list.findIndex((r) => r.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setRelTypes(list);
  };

  const fieldKeys = (typeId) => {
    const own = s.fieldTemplates?.[typeId];
    if (own?.length) return own;
    const dict = tList(`fieldTemplates.${typeId}`);
    return dict.length ? dict : tList("fieldTemplates.default");
  };
  // Набор пишем целиком по всем типам: иначе первая правка сохранила бы один
  // тип, а остальные остались бы на словаре и разъехались при смене языка.
  const setFieldKeys = (typeId, keys) => {
    const out = {};
    for (const type of s.nodeTypes) out[type.id] = type.id === typeId ? keys : fieldKeys(type.id);
    set({ fieldTemplates: out });
  };
  const addFieldKey = (typeId, raw) => {
    const key = raw.trim();
    const keys = fieldKeys(typeId);
    if (!key || keys.includes(key)) return false;
    setFieldKeys(typeId, [...keys, key]);
    return true;
  };

  const updateCanvas = (id, label) =>
    set({ canvases: canvases.map((c) => (c.id === id ? { ...c, label } : c)) });
  const addCanvas = () =>
    set({
      canvases: [...canvases, {
        id: `canvas-${Date.now()}`,
        label: t("editor.canvasNumbered", { number: canvases.length + 1 }),
      }],
    });
  const removeCanvas = (id) => {
    if (canvases.length <= 1) return;
    const used = canvasUsage[id] || 0;
    if (used) {
      setConfirm({
        text: t("settings.confirmDeleteCanvas", {
          count: t("count.nodes", { count: used }),
          target: canvases[0].label,
        }),
        run: () => set({ canvases: canvases.filter((c) => c.id !== id) }),
      });
      return;
    }
    set({ canvases: canvases.filter((c) => c.id !== id) });
  };

  // Разделы окна. Раньше всё это шло одной прокруткой в узкой панели: язык,
  // шрифты, календарь с високосными годами, эпохи, холсты, типы — и чтобы
  // поменять цвет типа, надо было пролистать весь календарь мира. Теперь у
  // каждой темы свой раздел, а окно шире панели: карточкам типов и календарю
  // есть где развернуться.
  const sections = [
    { id: "project", icon: FolderOpen, label: t("settings.project") },
    { id: "appearance", icon: Palette, label: t("settings.sectionAppearance") },
    { id: "canvas", icon: Share2, label: t("settings.canvas") },
    { id: "canvases", icon: Layers, label: t("settings.canvases") },
    { id: "types", icon: Shapes, label: t("settings.nodeTypes") },
    { id: "relations", icon: Link2, label: t("settings.sectionRelations") },
    { id: "chronology", icon: CalendarRange, label: t("settings.sectionChronology") },
  ];
  const current = sections.find((x) => x.id === section) || sections[0];

  const renderProject = () => (project && onProjectChange ? (
    <div className="space-y-3 max-w-xl">
      <Input
        data-testid="project-name-setting"
        value={project.name}
        onChange={(e) => onProjectChange({ name: e.target.value })}
        className="bg-transparent sw-border-c"
        placeholder={t("settings.projectName")}
      />
      <Textarea
        data-testid="project-desc-setting"
        value={project.description || ""}
        onChange={(e) => onProjectChange({ description: e.target.value })}
        rows={3}
        className="bg-transparent sw-border-c resize-none text-xs"
        placeholder={t("settings.projectDesc")}
      />
    </div>
  ) : null);

  const renderAppearance = () => (
    <>
      {/* Язык — настройка приложения, а не проекта: живёт отдельно от темы. */}
      <Section title={t("settings.language")}>
        <div className="grid grid-cols-2 gap-2 max-w-md">
          {LANGUAGES.map((option) => (
            <button
              key={option.id}
              data-testid={`lang-${option.id}`}
              onClick={() => setLanguage(option.id)}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm sw-btn"
              style={{
                borderColor: lang === option.id ? "var(--sw-accent)" : "var(--sw-border)",
                background: lang === option.id
                  ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)"
                  : "transparent",
              }}
            >
              <span className="flex items-center gap-2">
                <Languages className="w-4 h-4" /> {option.label}
              </span>
              {lang === option.id && <Check className="w-4 h-4 sw-accent-text" />}
            </button>
          ))}
        </div>
        <p className="text-[11px] sw-text-dim">{t("settings.languageHint")}</p>
      </Section>

      <Section title={t("settings.theme")}>
        <Segmented
          testIdPrefix="theme"
          value={s.theme}
          onChange={(id) => set({ theme: id })}
          options={[
            { id: "dark", label: t("settings.dark"), icon: Moon },
            { id: "light", label: t("settings.light"), icon: Sun },
          ]}
        />
      </Section>

      <Section title={t("settings.accent")}>
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_OPTIONS.map((c) => (
            <button
              key={c}
              data-testid={`accent-${c}`}
              onClick={() => set({ accent: c })}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-110"
              style={{ background: c, outline: s.accent === c ? "2px solid var(--sw-text)" : "none", outlineOffset: 2 }}
            >
              {s.accent === c && <Check className="w-4 h-4" style={{ color: accentForeground(c) }} />}
            </button>
          ))}
          <label
            className="w-8 h-8 rounded-full border border-dashed sw-border-c flex items-center justify-center cursor-pointer sw-text-dim"
            title={t("settings.customColor")}
          >
            <Plus className="w-4 h-4" />
            <input
              type="color"
              value={s.accent}
              onChange={(e) => set({ accent: e.target.value })}
              className="w-0 h-0 opacity-0"
            />
          </label>
        </div>
      </Section>

      {/* Шрифты. Интерфейсный и заголовочный — разные настройки: крупный
          текст просит характера, строка списка — нет. Каждая кнопка набрана
          своим шрифтом, иначе выбирать приходится по названию вслепую. В окне
          они стоят двумя колонками рядом — так их и сравнивают. */}
      <Section title={t("settings.font")}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div className="space-y-2">
            <p className="text-[11px] sw-text-mute">{t("settings.fontUi")}</p>
            {FONT_OPTIONS.map((f) => (
              <button
                key={f.id}
                data-testid={`font-${f.id}`}
                onClick={() => set({ font: f.id })}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm sw-btn"
                style={{
                  fontFamily: fontStack(f.id),
                  borderColor: s.font === f.id ? "var(--sw-accent)" : "var(--sw-border)",
                  background: s.font === f.id ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "transparent",
                }}
              >
                {f.label}
                {s.font === f.id && <Check className="w-4 h-4 sw-accent-text" />}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-[11px] sw-text-mute">{t("settings.fontDisplay")}</p>
            {DISPLAY_FONT_OPTIONS.map((f) => {
              const active = (s.displayFont || DEFAULT_SETTINGS.displayFont) === f.id;
              return (
                <button
                  key={f.id}
                  data-testid={`display-font-${f.id}`}
                  onClick={() => set({ displayFont: f.id })}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg border text-base sw-btn"
                  style={{
                    fontFamily: fontStack(f.id, "Space Grotesk"),
                    letterSpacing: "-0.02em",
                    borderColor: active ? "var(--sw-accent)" : "var(--sw-border)",
                    background: active ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "transparent",
                  }}
                >
                  {f.label}
                  {active && <Check className="w-4 h-4 sw-accent-text" />}
                </button>
              );
            })}
          </div>
        </div>
      </Section>
    </>
  );

  const renderCanvas = () => (
    <div className="max-w-md space-y-3">
        {[
          { key: "showGrid", label: t("settings.showGrid"), testId: "grid-toggle" },
          { key: "showMiniMap", label: t("settings.showMiniMap"), testId: "minimap-toggle" },
          { key: "snapToGrid", label: t("settings.snapToGrid"), testId: "snap-toggle" },
          { key: "animatedEdges", label: t("settings.animatedEdges"), testId: "animated-toggle" },
        ].map((o) => (
          <div key={o.key} className="flex items-center justify-between">
            <span className="text-sm">{o.label}</span>
            <Switch
              data-testid={o.testId}
              checked={!!s[o.key]}
              onCheckedChange={(v) => set({ [o.key]: v })}
            />
          </div>
        ))}
        <div>
          <span className="text-sm block mb-2">{t("settings.edgeStyle")}</span>
          <div className="grid grid-cols-4 gap-2">
            {EDGE_SHAPES.map((id) => ({ id, label: t(`settings.edgeStyles.${id}`) })).map((e) => (
              <button
                key={e.id}
                data-testid={`edge-${e.id}`}
                onClick={() => set({ edgeType: e.id })}
                className="px-2 py-1.5 rounded-md border text-xs sw-btn"
                style={{
                  borderColor: s.edgeType === e.id ? "var(--sw-accent)" : "var(--sw-border)",
                  background: s.edgeType === e.id ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "transparent",
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
    </div>
  );

  const renderCanvases = () => (
    <section>
      <div className="space-y-2 max-w-md">
        {canvases.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <Input
              value={c.label}
              onChange={(e) => updateCanvas(c.id, e.target.value)}
              className="bg-transparent sw-border-c h-9 text-sm"
            />
            <span className="text-[11px] font-mono-sw sw-text-dim w-8 text-right shrink-0">
              {canvasUsage[c.id] || 0}
            </span>
            <button
              onClick={() => removeCanvas(c.id)}
              disabled={canvases.length <= 1 || i === 0}
              title={i === 0 ? t("settings.cannotDeleteMain") : t("settings.deleteCanvas")}
              className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 shrink-0 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button data-testid="add-canvas-setting" onClick={addCanvas} className="sw-settings-add">
          <Plus className="w-3.5 h-3.5" /> {t("settings.canvasWord")}
        </button>
      </div>
    </section>
  );

  // Тип и его подсказки полей — одна карточка. Раньше подсказки были отдельной
  // секцией в конце, где все типы перечислялись второй раз.
  const renderTypes = () => (
    <section>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {s.nodeTypes.map((type, i) => (
          <div
            key={type.id}
            ref={(el) => { typeRefs.current[type.id] = el; }}
            className="border sw-border-c rounded-lg p-3"
            data-testid={`type-editor-${type.id}`}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIconPickerFor(iconPickerFor === type.id ? null : type.id)}
                className="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                style={{ background: type.color }}
                title={t("settings.changeIcon")}
              >
                <NodeIcon name={type.icon} className="w-4 h-4 text-white" />
              </button>
              <Input
                value={type.label}
                onChange={(e) => updateType(type.id, { label: e.target.value })}
                className="bg-transparent sw-border-c h-8 text-sm"
              />
              <input
                type="color"
                value={type.color}
                onChange={(e) => updateType(type.id, { color: e.target.value })}
                className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 shrink-0"
              />
              <div className="flex flex-col shrink-0">
                <button onClick={() => moveType(type.id, -1)} disabled={i === 0} className="sw-text-dim disabled:opacity-25 hover:opacity-80">
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => moveType(type.id, 1)} disabled={i === s.nodeTypes.length - 1} className="sw-text-dim disabled:opacity-25 hover:opacity-80">
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <button onClick={() => removeType(type.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 shrink-0">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Восемь нормированных тонов рядом — свой цвет из палитры
                берут чаще, чем подбирают пипеткой, а палитра держит типы
                различимыми на холсте. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => updateType(type.id, { color: c })}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110"
                  style={{
                    background: c,
                    outline: type.color?.toUpperCase() === c ? "2px solid var(--sw-text)" : "none",
                    outlineOffset: 2,
                  }}
                  title={c}
                />
              ))}
              <span className="ml-auto text-[11px] sw-text-dim">
                {t("settings.typeUsage", { count: typeUsage[type.id] || 0 })}
              </span>
            </div>
            {iconPickerFor === type.id && (
              <div className="mt-2 grid grid-cols-10 gap-1.5 animate-pop">
                {ICON_OPTIONS.map((ic) => (
                  <button
                    key={ic}
                    onClick={() => { updateType(type.id, { icon: ic }); setIconPickerFor(null); }}
                    className="aspect-square rounded flex items-center justify-center border sw-border-c sw-hover"
                  >
                    <NodeIcon name={ic} className="w-3.5 h-3.5" />
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t sw-border-c" data-testid={`fields-editor-${type.id}`}>
              <span className="text-[11px] sw-text-mute">{t("settings.fieldKeysOfType")}</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {fieldKeys(type.id).map((key) => (
                  <span key={key} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full border sw-border-c text-[11px]">
                    {key}
                    <button
                      onClick={() => setFieldKeys(type.id, fieldKeys(type.id).filter((k) => k !== key))}
                      className="sw-text-dim hover:text-red-400"
                      title={t("common.delete")}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <FieldKeyAdder
                placeholder={t("settings.fieldKeyPlaceholder")}
                onAdd={(value) => addFieldKey(type.id, value)}
              />
            </div>
          </div>
        ))}
      </div>
      <button data-testid="add-type-btn" onClick={addType} className="sw-settings-add mt-3">
        <Plus className="w-3.5 h-3.5" /> {t("settings.typeWord")}
      </button>
    </section>
  );

  const renderRelations = () => (
    <section data-testid="rel-types-editor">
      <div className="space-y-2 max-w-xl">
        {relTypes.map((rel, i) => (
          <div
            key={rel.id}
            className="border sw-border-c rounded-lg p-2.5 flex items-center gap-2"
            data-testid={`rel-editor-${rel.id}`}
          >
            <input
              type="color"
              value={rel.color || DEFAULT_EDGE_COLOR}
              onChange={(e) => updateRelType(rel.id, { color: e.target.value })}
              className="w-8 h-8 rounded cursor-pointer bg-transparent border-0 shrink-0"
            />
            <div className="flex-1 min-w-0">
              <Input
                value={rel.label}
                onChange={(e) => updateRelType(rel.id, { label: e.target.value })}
                className="bg-transparent sw-border-c h-8 text-sm"
              />
              <div className="mt-1 text-[11px] sw-text-dim">
                {t("settings.relUsage", { count: relUsage[rel.id] || 0 })}
              </div>
            </div>
            <div className="flex flex-col shrink-0">
              <button onClick={() => moveRelType(rel.id, -1)} disabled={i === 0} className="sw-text-dim disabled:opacity-25 hover:opacity-80">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => moveRelType(rel.id, 1)} disabled={i === relTypes.length - 1} className="sw-text-dim disabled:opacity-25 hover:opacity-80">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>
            <button onClick={() => removeRelType(rel.id)} className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400 shrink-0">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button data-testid="add-rel-type-btn" onClick={addRelType} className="sw-settings-add">
          <Plus className="w-3.5 h-3.5" /> {t("settings.relWord")}
        </button>
      </div>
    </section>
  );

  // Календарь мира и его эпохи — то, по чему считается вся хронология.
  const renderChronology = () => (
    <>
      <Section title={t("settings.calendar")}>
        <CalendarEditor settings={s} onChange={(calendar) => set({ calendar })} />
      </Section>
      <Section title={t("settings.eras")}>
        <EraEditor settings={s} onChange={(eras) => set({ eras })} />
      </Section>
    </>
  );

  const renderers = {
    project: renderProject,
    appearance: renderAppearance,
    canvas: renderCanvas,
    canvases: renderCanvases,
    types: renderTypes,
    relations: renderRelations,
    chronology: renderChronology,
  };

  // Окно — порталом в body: внутри рабочей области у предков есть transform
  // от framer, и fixed отсчитывался бы от них, а не от окна. Рисуется только
  // открытым, без AnimatePresence: в портале она доигрывала исчезновение и
  // оставляла прозрачный оверлей ловить клики.
  return createPortal(
    <div
      className="sw-settings-backdrop"
      // Клик мимо окна закрывает его. По mousedown и только по самой
      // подложке: иначе выделение текста в поле, отпущенное за краем окна,
      // закрывало бы настройки.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.985, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "tween", duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        className="sw-settings-window sw-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
        data-testid="settings-panel"
      >
        <nav className="sw-settings-nav">
          <span className="sw-settings-nav-title">{t("settings.title")}</span>
          {sections.map((x) => {
            const Icon = x.icon;
            return (
              <button
                key={x.id}
                type="button"
                data-testid={`settings-section-${x.id}`}
                data-active={x.id === current.id}
                onClick={() => setSection(x.id)}
                className="sw-settings-nav-item"
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{x.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sw-settings-main">
          <header className="sw-settings-head">
            <div className="min-w-0">
              <h2 className="sw-settings-title">{current.label}</h2>
              <p className="sw-settings-about">{t(`settings.about.${current.id}`)}</p>
            </div>
            <button onClick={onClose} data-testid="close-settings-btn" title={`${t("common.close")} · Esc`} className="p-1.5 rounded-md sw-hover shrink-0">
              <X className="w-4 h-4" />
            </button>
          </header>
          <div ref={scrollRef} className="sw-settings-body sw-scroll-y">
            {renderers[current.id]()}
          </div>
        </div>
      </motion.div>

      <AlertDialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <AlertDialogContent className="sw-surface sw-border-c">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("common.confirm")}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-confirm"
              onClick={() => { confirm?.run(); setConfirm(null); }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>,
    document.body,
  );
}
