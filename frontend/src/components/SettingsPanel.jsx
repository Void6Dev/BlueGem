import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { X, Plus, Trash2, Sun, Moon, Check, ChevronUp, ChevronDown, Layers, Languages } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { NodeIcon } from "@/components/NodeIcon";
import { FONT_OPTIONS, ACCENT_OPTIONS, TYPE_COLORS, ICON_OPTIONS, fontStack } from "@/lib/settings";
import { LANGUAGES, getLanguage, setLanguage, useT } from "@/lib/i18n";
import { scrollWithin } from "@/lib/scrollWithin";
import CalendarEditor from "@/components/chrono/CalendarEditor";
import EraEditor from "@/components/chrono/EraEditor";

function Section({ title, children }) {
  return (
    <section>
      <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{title}</label>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

export default function SettingsPanel({
  settings, onChange, onClose, project, onProjectChange, typeUsage = {}, canvasUsage = {},
  highlightType, onHighlighted,
}) {
  const t = useT();
  const s = settings;
  const set = (patch) => onChange({ ...s, ...patch });
  const [iconPickerFor, setIconPickerFor] = useState(null);
  const lang = getLanguage();
  const typeRefs = useRef({});
  const scrollRef = useRef(null);
  const [addedType, setAddedType] = useState(null);
  const spotlight = highlightType || addedType;

  // Тип создали — снаружи плиткой в палитре или прямо здесь кнопкой «Тип».
  // В обоих случаях доводим человека до него: прокручиваем, подсвечиваем
  // и ставим курсор в название.
  useEffect(() => {
    if (!spotlight) return undefined;
    const box = typeRefs.current[spotlight];
    if (!box) return undefined;
    scrollWithin(scrollRef.current, box, "center");
    box.classList.add("sw-flash");
    const focusTimer = setTimeout(() => {
      const input = box.querySelector("input:not([type=color])");
      input?.focus({ preventScroll: true });
      input?.select();
    }, 320);
    const clearTimer = setTimeout(() => {
      box.classList.remove("sw-flash");
      setAddedType(null);
      onHighlighted?.();
    }, 1700);
    return () => { clearTimeout(focusTimer); clearTimeout(clearTimer); };
    // eslint-disable-next-line
  }, [spotlight]);

  const canvases = s.canvases?.length ? s.canvases : [{ id: "main", label: t("editor.mainCanvas") }];

  const addType = () => {
    const id = `custom-${Date.now()}`;
    set({ nodeTypes: [...s.nodeTypes, { id, label: t("settings.newType"), color: "#2E9BD6", icon: "Star" }] });
    setAddedType(id);
  };
  const updateType = (id, patch) =>
    set({ nodeTypes: s.nodeTypes.map((type) => (type.id === id ? { ...type, ...patch } : type)) });
  const removeType = (id) => {
    const used = typeUsage[id] || 0;
    const warning = t("settings.confirmDeleteType", { count: t("count.nodes", { count: used }) });
    if (used && !window.confirm(warning)) return;
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
    const warning = t("settings.confirmDeleteCanvas", {
      count: t("count.nodes", { count: used }),
      target: canvases[0].label,
    });
    if (used && !window.confirm(warning)) return;
    set({ canvases: canvases.filter((c) => c.id !== id) });
  };

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}

      transition={{ type: "tween", duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="absolute top-0 right-0 h-full w-full sm:w-[26rem] border-l sw-panel sw-border-c z-30 flex flex-col"
      data-testid="settings-panel"
    >
      <div className="flex items-center justify-between px-6 py-5 border-b sw-border-c">
        <span className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{t("settings.title")}</span>
        <button onClick={onClose} data-testid="close-settings-btn" className="p-1.5 rounded-md sw-hover">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 sw-scroll-y px-6 py-6 space-y-8">
        {/* Project */}
        {project && onProjectChange && (
          <Section title={t("settings.project")}>
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
              rows={2}
              className="bg-transparent sw-border-c resize-none text-xs"
              placeholder={t("settings.projectDesc")}
            />
          </Section>
        )}

        {/* Язык — настройка приложения, а не проекта: живёт отдельно от темы. */}
        <Section title={t("settings.language")}>
          <div className="grid grid-cols-2 gap-2">
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

        {/* Theme */}
        <Section title={t("settings.theme")}>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "dark", label: t("settings.dark"), Icon: Moon },
              { id: "light", label: t("settings.light"), Icon: Sun },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                data-testid={`theme-${id}`}
                onClick={() => set({ theme: id })}
                className="flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm sw-btn"
                style={{
                  borderColor: s.theme === id ? "var(--sw-accent)" : "var(--sw-border)",
                  background: s.theme === id ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "transparent",
                }}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
        </Section>

        {/* Accent */}
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
                {s.accent === c && <Check className="w-4 h-4 text-white" />}
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

        {/* Font */}
        <Section title={t("settings.font")}>
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
        </Section>

        {/* Canvas options */}
        <Section title={t("settings.canvas")}>
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
              {[
                { id: "smoothstep", label: t("settings.edgeStyles.smoothstep") },
                { id: "default", label: t("settings.edgeStyles.default") },
                { id: "straight", label: t("settings.edgeStyles.straight") },
                { id: "step", label: t("settings.edgeStyles.step") },
              ].map((e) => (
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
        </Section>

        {/* Календарь мира и его эпохи — то, по чему считается вся хронология. */}
        <Section title={t("settings.calendar")}>
          <CalendarEditor settings={s} onChange={(calendar) => set({ calendar })} />
        </Section>

        <Section title={t("settings.eras")}>
          <EraEditor settings={s} onChange={(eras) => set({ eras })} />
        </Section>

        {/* Canvases (layers) */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim flex items-center gap-2">
              <Layers className="w-3 h-3" /> {t("settings.canvases")}
            </label>
            <button data-testid="add-canvas-setting" onClick={addCanvas} className="flex items-center gap-1 text-xs sw-accent-text hover:opacity-80">
              <Plus className="w-3.5 h-3.5" /> {t("settings.canvasWord")}
            </button>
          </div>
          <div className="space-y-2">
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
          </div>
        </section>

        {/* Node types */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <label className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">{t("settings.nodeTypes")}</label>
            <button data-testid="add-type-btn" onClick={addType} className="flex items-center gap-1 text-xs sw-accent-text hover:opacity-80">
              <Plus className="w-3.5 h-3.5" /> {t("settings.typeWord")}
            </button>
          </div>
          <div className="space-y-3">
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
                </div>
                <div className="mt-1.5 text-[11px] sw-text-dim">
                  {t("settings.typeUsage", { count: typeUsage[type.id] || 0 })}
                </div>
                {iconPickerFor === type.id && (
                  <div className="mt-2 grid grid-cols-8 gap-1.5 animate-pop">
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
              </div>
            ))}
          </div>
        </section>
      </div>
    </motion.div>
  );
}
