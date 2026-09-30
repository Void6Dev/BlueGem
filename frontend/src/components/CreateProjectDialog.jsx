import { useEffect, useState } from "react";
import { ArrowRight, Check, CircleDashed, Loader2, Plus, Shapes, Swords } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";

// Порядок и значки — здесь: это оформление, а состав шаблона приходит с
// сервера (типы узлов и страницы заводятся на языке интерфейса).
const TEMPLATE_ORDER = ["blank", "dnd", "custom"];
const TEMPLATE_ICONS = { blank: CircleDashed, dnd: Swords, custom: Shapes };
const DEFAULT_TEMPLATE = "blank";

/**
 * Создание проекта с выбором заготовки.
 *
 * Шаблон — это только стартовый набор типов, страниц и, по желанию, пример
 * содержимого; после создания проект обычный. Поэтому подпись под выбором
 * говорит именно это: ничего необратимого здесь не выбирают.
 */
export default function CreateProjectDialog({ open, onOpenChange, onCreate }) {
  const t = useT();
  const [templates, setTemplates] = useState(null);
  const [picked, setPicked] = useState(DEFAULT_TEMPLATE);
  const [starter, setStarter] = useState(true);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  // Список тянем при первом открытии: на панели проектов он не нужен.
  useEffect(() => {
    if (!open || templates) return;
    let alive = true;
    api.listTemplates()
      .then((rows) => { if (alive) setTemplates(rows); })
      .catch(() => { if (alive) setTemplates([]); });
    return () => { alive = false; };
  }, [open, templates]);

  useEffect(() => {
    if (!open) return;
    setPicked(DEFAULT_TEMPLATE);
    setStarter(true);
    setName("");
    setDesc("");
    setBusy(false);
  }, [open]);

  const byId = Object.fromEntries((templates || []).map((r) => [r.id, r]));
  const rows = TEMPLATE_ORDER.filter((id) => byId[id]).map((id) => byId[id]);
  const active = byId[picked];
  const withStarter = !!active?.starter && starter;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onCreate({
      name: name.trim(),
      description: desc.trim(),
      template: picked,
      starter: withStarter,
    });
    if (!ok) setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sw-surface sw-border-c max-w-3xl"
        data-testid="create-project-dialog"
      >
        {/* Именно DialogTitle/DialogDescription, а не свои h2 и p: Radix
            привязывает их к диалогу для читалок с экрана и ругается в консоль,
            если заголовка нет. */}
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="sw-display text-2xl">{t("dashboard.newProject")}</DialogTitle>
          <DialogDescription className="text-[12.5px] sw-text-dim">
            {t("dashboard.templateIntro")}
          </DialogDescription>
        </DialogHeader>

        {!templates ? (
          <div className="h-40 flex items-center justify-center sw-text-dim">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {rows.map((tpl) => {
                const Icon = TEMPLATE_ICONS[tpl.id] || CircleDashed;
                const on = picked === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    data-testid={`template-${tpl.id}`}
                    onClick={() => setPicked(tpl.id)}
                    className="text-left p-4 rounded-xl border sw-surface-0 sw-btn"
                    style={{
                      borderColor: on ? "color-mix(in srgb, var(--sw-accent) 50%, transparent)" : "var(--sw-border)",
                      boxShadow: on ? "0 0 0 3px color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "none",
                    }}
                  >
                    <span className="flex items-center justify-between mb-3">
                      <span
                        className="w-9 h-9 rounded-[10px] flex items-center justify-center"
                        style={{
                          background: on
                            ? "color-mix(in srgb, var(--sw-accent) 16%, transparent)"
                            : "rgba(128,128,140,.12)",
                          color: on ? "var(--sw-accent)" : "var(--sw-text-dim)",
                        }}
                      >
                        <Icon className="w-[18px] h-[18px]" />
                      </span>
                      {on && (
                        <span
                          className="w-[18px] h-[18px] rounded-full flex items-center justify-center sw-accent-bg sw-accent-fg"
                        >
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </span>
                    <span className="sw-display block text-[15px] font-semibold">
                      {t(`dashboard.templates.${tpl.id}.name`)}
                    </span>
                    <span className="block mt-1 mb-3 text-xs leading-snug sw-text-dim min-h-[2.6rem]">
                      {t(`dashboard.templates.${tpl.id}.desc`)}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {tpl.types.length === 0 ? (
                        <span className="sw-chip"><span className="sw-chip-dot" style={{ background: "var(--sw-text-mute)" }} />{t("dashboard.templates.ownTypes")}</span>
                      ) : tpl.types.map((ty) => (
                        <span key={ty.id} className="sw-chip">
                          <span className="sw-chip-dot" style={{ background: ty.color }} />{ty.label}
                        </span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="sw-section-label block mb-2">{t("common.name")}</label>
                <Input
                  data-testid="project-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={t("dashboard.namePlaceholder")}
                  className="bg-transparent sw-border-c"
                  autoFocus
                />
              </div>
              <div>
                <label className="sw-section-label block mb-2">{t("common.description")}</label>
                <Input
                  data-testid="project-desc-input"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder={t("dashboard.descPlaceholder")}
                  className="bg-transparent sw-border-c"
                />
              </div>
            </div>

            {/* Что именно появится: страницы списком и переключатель примера.
                Без этого «шаблон» — обещание, которое проверяют уже внутри. */}
            <div className="rounded-xl border sw-border-c sw-surface-0 overflow-hidden">
              <div className="px-4 py-3 border-b sw-border-c">
                <p className="sw-section-label mb-2">{t("dashboard.templatePages")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(active?.pages || []).map((p, i) => (
                    <span key={`${p}-${i}`} className="sw-chip sw-chip-plain">{p}</span>
                  ))}
                </div>
              </div>
              <div className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold">{t("dashboard.templateStarter")}</p>
                  <p className="mt-0.5 text-[11.5px] leading-snug sw-text-dim">
                    {!active?.starter
                      ? t("dashboard.templateStarterNone")
                      : withStarter
                        ? t("dashboard.templateStarterOn")
                        : t("dashboard.templateStarterOff")}
                  </p>
                </div>
                {active?.starter && (
                  <Segmented
                    variant="accent"
                    testIdPrefix="starter"
                    value={withStarter ? "on" : "off"}
                    onChange={(v) => setStarter(v === "on")}
                    options={[
                      { id: "on", label: t("dashboard.templateStarterYes") },
                      { id: "off", label: t("dashboard.templateStarterNo") },
                    ]}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="font-mono-sw text-[11px] sw-text-mute">
                {t("dashboard.templateSummary", {
                  types: active?.types?.length || 0,
                  pages: active?.pages?.length || 0,
                })}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="h-9 px-4 rounded-lg text-sm sw-text-dim sw-btn"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="create-project-submit"
                  onClick={submit}
                  disabled={busy}
                  className="h-9 px-4 rounded-lg text-sm font-semibold sw-accent-bg sw-accent-fg
                    inline-flex items-center gap-2 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {t("common.create")}
                  {!busy && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
