import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { History, Loader2, RotateCcw, Save } from "lucide-react";
import { api, apiErrorMessage } from "@/lib/api";
import { getLanguage, useT } from "@/lib/i18n";
import { fullTime, relativeTime } from "@/lib/time";

/**
 * Резервные копии проекта.
 *
 * Копии снимаются сами — перед правкой, если последней больше десяти минут, —
 * поэтому в списке всегда есть состояние «до»: и случайно удалённый узел, и
 * неудачная раскладка возвращаются отсюда. Восстановление само сначала
 * снимает копию текущего состояния, так что и его можно отменить.
 */
export default function BackupsSection({ projectId, onRestored }) {
  const t = useT();
  const lang = getLanguage();
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null); // "create" | id восстанавливаемой копии
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(() => {
    api.listBackups(projectId)
      .then(setList)
      .catch((e) => { setList([]); toast.error(apiErrorMessage(e)); });
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const createNow = async () => {
    setBusy("create");
    try {
      await api.createBackup(projectId);
      toast.success(t("backups.created"));
      load();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (b) => {
    setBusy(b.id);
    try {
      await api.restoreBackup(b.id);
      toast.success(t("backups.restored", { when: fullTime(b.createdAt, lang) }));
      setConfirmId(null);
      load();
      onRestored?.();
    } catch (e) {
      toast.error(apiErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4 max-w-xl" data-testid="backups-section">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={createNow}
          disabled={busy === "create"}
          data-testid="backup-create"
          className="sw-btn-soft inline-flex items-center gap-2 px-3 py-2 rounded-lg border sw-border-c text-sm sw-hover"
        >
          {busy === "create" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {t("backups.createNow")}
        </button>
        <span className="text-xs sw-text-dim">{t("backups.autoHint")}</span>
      </div>

      {list === null && <p className="text-sm sw-text-dim">{t("backups.loading")}</p>}
      {list && list.length === 0 && (
        <p className="text-sm sw-text-dim flex items-center gap-2"><History className="w-4 h-4" />{t("backups.empty")}</p>
      )}

      {list && list.length > 0 && (
        <ul className="sw-backup-list" data-testid="backup-list">
          {list.map((b) => (
            <li key={b.id} className="sw-backup-row" data-testid={`backup-${b.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-sm" title={fullTime(b.createdAt, lang)}>
                  {fullTime(b.createdAt, lang)}
                  <span className="sw-text-dim"> · {relativeTime(b.createdAt, t, lang)}</span>
                </div>
                <div className="text-[11px] sw-text-dim truncate">
                  {t(`backups.reason.${b.reason}`)}
                  {" · "}{t("count.nodes", { count: b.nodeCount })}
                  {" · "}{t("count.edges", { count: b.edgeCount })}
                </div>
              </div>
              {confirmId === b.id ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid="backup-restore-confirm"
                    disabled={!!busy}
                    onClick={() => restore(b)}
                    className="sw-backup-confirm inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs"
                  >
                    {busy === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    {t("backups.restoreConfirm")}
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} className="px-2 py-1.5 rounded-md text-xs sw-hover sw-text-dim">
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="backup-restore"
                  onClick={() => setConfirmId(b.id)}
                  className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs sw-hover sw-text-dim"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> {t("backups.restore")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
