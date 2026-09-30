import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Plus, BookOpen, Trash2, Network, ArrowRight, Search, Upload, Copy,
  Pencil, Link2, Clock,
} from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import CreateProjectDialog from "@/components/CreateProjectDialog";
import { api, apiErrorMessage } from "@/lib/api";
import { applyStoredAppearance } from "@/lib/settings";
import { readJsonFile } from "@/lib/exporters";
import { isDesktop, pickProjectFile } from "@/lib/desktop";
import { openSnapshot, parseSnapshot } from "@/lib/openProject";
import UpdateCenter from "@/components/UpdateCenter";
import logo from "@/assets/logo.png";
import { LANGUAGES, getLanguage, setLanguage, useT } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SORT_IDS = ["updated", "name", "size"];

function relativeTime(iso, t, lang) {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const min = Math.round(diff / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutes", { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("time.hours", { count: h });
  const d = Math.round(h / 24);
  if (d < 31) return t("time.days", { count: d });
  return new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB");
}

export default function Dashboard() {
  const t = useT();
  const lang = getLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("updated");
  const fileRef = useRef(null);

  useEffect(() => {
    // Reuse the appearance the user last saw instead of forcing dark.
    applyStoredAppearance();
    load();
  }, []);

  // «Файл → Новый проект» в меню приложения приводит сюда с ?new=1.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("new") === null) return;
    setOpen(true);
    navigate("/", { replace: true });
  }, [location.search, navigate]);

  const load = async () => {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.loadProjects"));
    } finally {
      setLoading(false);
    }
  };

  /** Возвращает true, если проект создан: диалог по этому признаку снимает
   *  занятость с кнопки, а на ошибке остаётся открытым с введённым текстом. */
  const create = async (payload) => {
    if (!payload.name) {
      toast.error(t("dashboard.toasts.nameRequired"));
      return false;
    }
    try {
      const p = await api.createProject(payload);
      setOpen(false);
      navigate(`/project/${p.id}`);
      return true;
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.createProject"));
      return false;
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteProject(deleteTarget.id);
      setProjects((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(t("dashboard.toasts.deleted"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.deleteProject"));
    } finally {
      setDeleteTarget(null);
    }
  };

  const saveEdit = async () => {
    if (!editTarget?.name.trim()) return toast.error(t("dashboard.toasts.nameEmpty"));
    try {
      const updated = await api.updateProject(editTarget.id, {
        name: editTarget.name.trim(), description: editTarget.description,
      });
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
      toast.success(t("dashboard.toasts.updated"));
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.saveProject"));
    } finally {
      setEditTarget(null);
    }
  };

  const duplicate = async (p) => {
    try {
      await api.duplicateProject(p.id);
      toast.success(t("dashboard.toasts.duplicated"));
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e, "errors.duplicateProject"));
    }
  };

  /** Общий финал для всех способов открыть файл проекта. */
  const acceptSnapshot = async (snapshot) => {
    const result = await openSnapshot(snapshot);
    if (!result) return; // отказались в диалоге
    toast.success(t(result.action === "imported"
      ? "dashboard.toasts.imported"
      : "dashboard.toasts.opened", { name: result.name }));
    navigate(`/project/${result.id}`);
  };

  // В приложении — системный диалог, в браузере — скрытый <input type="file">.
  const importProject = async () => {
    if (!isDesktop) return fileRef.current?.click();
    try {
      const picked = await pickProjectFile();
      if (!picked.ok) {
        if (picked.error) toast.error(picked.error);
        return;
      }
      await acceptSnapshot(parseSnapshot(picked.content));
    } catch (err) {
      toast.error(err.message || apiErrorMessage(err, "errors.importProject"));
    }
  };

  const onImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await acceptSnapshot(await readJsonFile(file));
    } catch (err) {
      toast.error(err.message || apiErrorMessage(err, "errors.importProject"));
    }
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = projects.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || (p.description || "").toLowerCase().includes(q)
    );
    const sorted = [...list];
    if (sort === "name") sorted.sort((a, b) => a.name.localeCompare(b.name, lang));
    else if (sort === "size") sorted.sort((a, b) => (b.nodeCount || 0) - (a.nodeCount || 0));
    else sorted.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return sorted;
  }, [projects, query, sort, lang]);

  const totals = useMemo(() => projects.reduce(
    (a, p) => ({ nodes: a.nodes + (p.nodeCount || 0), edges: a.edges + (p.edgeCount || 0) }),
    { nodes: 0, edges: 0 }
  ), [projects]);

  return (
    <div className="min-h-screen sw-bg" data-testid="dashboard">
      {/* Header */}
      <header className="border-b sw-border-c sticky top-0 z-20 sw-glass">
        <div className="max-w-6xl mx-auto px-6 sm:px-8 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <img src={logo} alt="" className="w-9 h-9 rounded-lg" draggable={false} />
            <span className="sw-display text-xl tracking-tight">BlueGem</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-full border sw-border-c overflow-hidden mr-1" data-testid="lang-switch">
              {LANGUAGES.map((option) => (
                <button
                  key={option.id}
                  data-testid={`lang-${option.id}`}
                  onClick={() => setLanguage(option.id)}
                  title={option.label}
                  className="px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors"
                  style={{
                    background: lang === option.id ? "var(--sw-accent)" : "transparent",
                    color: lang === option.id ? "var(--sw-accent-fg)" : "var(--sw-text-dim)",
                  }}
                >
                  {option.short}
                </button>
              ))}
            </div>
            <input ref={fileRef} type="file" accept=".bgproj,.swproj,application/json,.json" onChange={onImportFile} className="hidden" />
            {/* Обновления и письмо автору: единственное место, где приложение
                говорит о себе самом, — шапка главной. */}
            <UpdateCenter />
            <Button
              data-testid="import-project-btn"
              variant="ghost"
              onClick={importProject}
              className="gap-2 sw-text-dim"
              title={t("dashboard.importTitle")}
            >
              <Upload className="w-4 h-4" /> <span className="hidden sm:inline">{t("dashboard.import")}</span>
            </Button>
            <Button
              data-testid="new-project-btn"
              onClick={() => setOpen(true)}
              className="rounded-full sw-accent-bg sw-accent-fg hover:opacity-90 transition-opacity gap-2 border-0"
            >
              <Plus className="w-4 h-4" /> {t("dashboard.newProject")}
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="max-w-6xl mx-auto px-6 sm:px-8 pt-16 pb-10">
        <p className="text-xs uppercase tracking-[0.3em] sw-text-dim mb-4">{t("dashboard.tagline")}</p>
        <h1 className="sw-display text-4xl sm:text-5xl tracking-tight max-w-2xl leading-tight">
          {t("dashboard.heroTitle")}
        </h1>
        <p className="sw-text-dim mt-4 max-w-xl leading-relaxed">
          {t("dashboard.heroText")}
        </p>
        {projects.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-5 text-sm sw-text-dim">
            <span className="flex items-center gap-1.5"><BookOpen className="w-4 h-4" /> {t("count.projects", { count: projects.length })}</span>
            <span className="flex items-center gap-1.5"><Network className="w-4 h-4" /> {t("count.nodes", { count: totals.nodes })}</span>
            <span className="flex items-center gap-1.5"><Link2 className="w-4 h-4" /> {t("count.edges", { count: totals.edges })}</span>
          </div>
        )}
      </div>

      {/* Projects grid */}
      <div className="max-w-6xl mx-auto px-6 sm:px-8 pb-24">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <h2 className="text-xs uppercase tracking-[0.2em] font-semibold sw-text-dim">
            {t("common.projects")} {projects.length > 0 && `(${visible.length}/${projects.length})`}
          </h2>
          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 sw-text-dim" />
                <Input
                  data-testid="project-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("dashboard.searchPlaceholder")}
                  className="pl-8 h-9 w-52 bg-transparent sw-border-c text-sm"
                />
              </div>
              {/* Сортировка — тот же сегмент, что тема и вид карточек.
                  Акцентная заливка здесь была бы третьим по яркости пятном
                  рядом с «Новый проект», ради выбора порядка строк. */}
              <Segmented
                testIdPrefix="sort"
                value={sort}
                onChange={setSort}
                options={SORT_IDS.map((id) => ({ id, label: t(`dashboard.sort.${id}`) }))}
              />
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="border sw-border-c rounded-xl p-6">
                <div className="sw-skeleton w-10 h-10 rounded-lg mb-4" />
                <div className="sw-skeleton h-5 w-2/3 mb-3" />
                <div className="sw-skeleton h-3 w-full mb-2" />
                <div className="sw-skeleton h-3 w-4/5" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onCreate={() => setOpen(true)} onImport={() => fileRef.current?.click()} />
        ) : visible.length === 0 ? (
          <p className="sw-text-dim text-sm py-16 text-center">
            {t("dashboard.noMatches", { query })}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visible.map((p, i) => (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.35 }}
                onClick={() => navigate(`/project/${p.id}`)}
                data-testid={`project-card-${p.id}`}
                className="group relative border sw-raised sw-border-c rounded-xl p-6 cursor-pointer hover:-translate-y-1 transition-all duration-200 hover:border-[var(--sw-accent)]"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-lg border sw-border-c flex items-center justify-center">
                    <BookOpen className="w-5 h-5 sw-accent-text" />
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button
                      data-testid={`edit-project-${p.id}`}
                      title={t("dashboard.rename")}
                      onClick={(e) => { e.stopPropagation(); setEditTarget({ ...p }); }}
                      className="p-1.5 rounded-md sw-hover sw-text-dim"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      data-testid={`duplicate-project-${p.id}`}
                      title={t("dashboard.duplicate")}
                      onClick={(e) => { e.stopPropagation(); duplicate(p); }}
                      className="p-1.5 rounded-md sw-hover sw-text-dim"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      data-testid={`delete-project-${p.id}`}
                      title={t("dashboard.remove")}
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(p); }}
                      className="p-1.5 rounded-md hover:bg-red-500/10 text-red-400"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="sw-display text-xl tracking-tight mb-2 truncate">{p.name}</h3>
                <p className="sw-text-dim text-sm line-clamp-2 min-h-[2.5rem]">
                  {p.description || t("common.noDescription")}
                </p>
                {/* Состав проекта по типам узлов. Четыре пикселя говорят то,
                    чего не скажет число «96 узлов»: это мир из персонажей или
                    из мест. Пустой проект полоски не получает — рисовать нечего. */}
                {p.typeMix?.length > 0 && (
                  <div
                    className="sw-type-mix"
                    data-testid={`project-mix-${p.id}`}
                    title={t("dashboard.typeMix", { count: p.nodeCount || 0 })}
                  >
                    {p.typeMix.map((m, i) => (
                      <span key={`${m.color}-${i}`} style={{ flex: m.count, background: m.color }} />
                    ))}
                  </div>
                )}
                <div className="mt-4 flex items-center gap-3 text-[11px] font-mono-sw sw-text-dim">
                  <span className="flex items-center gap-1"><Network className="w-3 h-3" />{p.nodeCount || 0}</span>
                  <span className="flex items-center gap-1"><Link2 className="w-3 h-3" />{p.edgeCount || 0}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{relativeTime(p.updatedAt, t, lang)}</span>
                </div>
                <div className="mt-3 flex items-center gap-2 text-sm sw-accent-text opacity-0 group-hover:opacity-100 transition-opacity">
                  {t("dashboard.openProject")} <ArrowRight className="w-4 h-4" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Создание проекта: выбор заготовки живёт отдельным компонентом —
          он вырос из пары полей в экран. */}
      <CreateProjectDialog open={open} onOpenChange={setOpen} onCreate={create} />

      {/* Rename dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="sw-surface sw-border-c" data-testid="edit-project-dialog">
          <DialogHeader>
            <DialogTitle className="sw-display text-2xl">{t("dashboard.editTitle")}</DialogTitle>
            <DialogDescription className="sw-text-dim">{t("dashboard.editText")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              data-testid="edit-project-name"
              value={editTarget?.name || ""}
              onChange={(e) => setEditTarget((t) => ({ ...t, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
              className="bg-transparent sw-border-c"
              autoFocus
            />
            <Textarea
              data-testid="edit-project-desc"
              value={editTarget?.description || ""}
              onChange={(e) => setEditTarget((t) => ({ ...t, description: e.target.value }))}
              rows={3}
              className="bg-transparent sw-border-c resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditTarget(null)}>{t("common.cancel")}</Button>
            <Button data-testid="save-project-edit" onClick={saveEdit} className="sw-accent-bg sw-accent-fg border-0 hover:opacity-90">
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent className="sw-surface sw-border-c">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("dashboard.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("dashboard.deleteText", {
                name: deleteTarget?.name,
                nodes: t("count.nodes", { count: deleteTarget?.nodeCount || 0 }),
                edges: t("count.edges", { count: deleteTarget?.edgeCount || 0 }),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-delete-project"
              onClick={remove}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ onCreate, onImport }) {
  const t = useT();
  return (
    <div className="border border-dashed sw-border-c rounded-xl py-20 flex flex-col items-center text-center">
      <div className="w-14 h-14 rounded-lg border sw-border-c flex items-center justify-center mb-5">
        <Network className="w-7 h-7 sw-text-dim" />
      </div>
      <h3 className="sw-display text-2xl tracking-tight mb-2">{t("dashboard.emptyTitle")}</h3>
      <p className="sw-text-dim text-sm max-w-sm mb-6">
        {t("dashboard.emptyText")}
      </p>
      <div className="flex items-center gap-2">
        <Button
          data-testid="empty-create-btn"
          onClick={onCreate}
          className="rounded-full sw-accent-bg sw-accent-fg border-0 hover:opacity-90 gap-2"
        >
          <Plus className="w-4 h-4" /> {t("dashboard.createFirst")}
        </Button>
        <Button variant="ghost" onClick={onImport} className="rounded-full gap-2 sw-text-dim">
          <Upload className="w-4 h-4" /> {t("dashboard.import")}
        </Button>
      </div>
    </div>
  );
}
