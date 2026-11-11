import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff, FolderOpen, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { getLanguage, useT } from "@/lib/i18n";
import { relativeTime } from "@/lib/time";
import { folderSync } from "@/lib/sync/folderSync";

/**
 * Кнопка синхронизации на главной (только в приложении для компьютера).
 *
 * Синхронизация идёт через обычную папку, которую человек и так держит
 * одинаковой на всех устройствах: Google Диск, Dropbox, OneDrive, Syncthing.
 * Своего облака у приложения нет, поэтому и аккаунта заводить не нужно.
 */
export default function SyncCenter() {
  const t = useT();
  const lang = getLanguage();
  const sync = folderSync();
  const [status, setStatus] = useState(sync?.status || null);
  const [open, setOpen] = useState(false);

  useEffect(() => (sync ? sync.subscribe(setStatus) : undefined), [sync]);

  if (!sync || !status) return null;

  const on = !!status.folder;
  const busy = status.phase === "syncing";
  const broken = status.phase === "error";
  const Icon = !on ? CloudOff : broken ? AlertTriangle : Cloud;

  const choose = async () => {
    const st = await sync.choose(t("sync.chooseTitle"));
    if (!st.canceled) toast.success(t("sync.enabled"));
  };

  const now = async () => {
    await sync.syncSoon();
    if (sync.status.phase === "error") toast.error(t("sync.failed", { error: sync.status.error }));
    else toast.success(t("sync.done"));
  };

  return (
    <>
      <button
        type="button"
        data-testid="sync-btn"
        onClick={() => setOpen(true)}
        title={on ? t("sync.onTitle", { folder: status.folder }) : t("sync.offTitle")}
        className={`sw-update-btn sw-sync-btn ${on && !broken ? "is-on" : ""} ${broken ? "is-broken" : ""}`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
        <span className="hidden sm:inline">{t(on ? "sync.short" : "sync.shortOff")}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="sync-dialog">
          <DialogHeader>
            <DialogTitle>{t("sync.title")}</DialogTitle>
            <DialogDescription>{t("sync.about")}</DialogDescription>
          </DialogHeader>

          {on ? (
            <div className="space-y-3">
              <div className="rounded-lg border sw-border-c p-3">
                <p className="sw-section-label mb-1">{t("sync.folder")}</p>
                <p className="text-sm break-all font-mono-sw" data-testid="sync-folder">{status.folder}</p>
                <p className="text-xs sw-text-dim mt-1.5">
                  {broken
                    ? t(status.error === "unavailable" ? "sync.unavailable" : "sync.failed", { error: status.error })
                    : status.lastSyncAt
                      ? t("sync.lastSync", { when: relativeTime(status.lastSyncAt, t, lang) })
                      : t("sync.waiting")}
                </p>
              </div>
              {status.detached?.length > 0 && (
                <div className="rounded-lg border sw-border-c p-3" data-testid="sync-detached">
                  <p className="sw-section-label mb-1">{t("sync.detachedTitle")}</p>
                  <p className="text-xs sw-text-dim mb-2">{t("sync.detachedAbout")}</p>
                  {status.detached.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 py-1">
                      <span className="text-sm truncate">{d.name}</span>
                      <Button size="sm" variant="outline" className="rounded-full h-7" onClick={() => sync.attach(d.id)}>
                        {t("sync.attach")}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={now} disabled={busy} className="rounded-full gap-2" data-testid="sync-now">
                  <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} /> {t("sync.now")}
                </Button>
                <Button variant="outline" onClick={() => sync.reveal()} className="rounded-full gap-2">
                  <FolderOpen className="w-4 h-4" /> {t("sync.reveal")}
                </Button>
                <Button variant="ghost" onClick={choose} className="rounded-full">{t("sync.change")}</Button>
                <Button
                  variant="ghost"
                  onClick={() => sync.disable().then(() => toast.success(t("sync.disabled")))}
                  className="rounded-full sw-text-dim"
                  data-testid="sync-disable"
                >
                  {t("sync.disable")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ol className="text-sm space-y-1.5 list-decimal pl-5 sw-text-dim">
                <li>{t("sync.step1")}</li>
                <li>{t("sync.step2")}</li>
                <li>{t("sync.step3")}</li>
              </ol>
              <Button onClick={choose} className="rounded-full gap-2" data-testid="sync-choose">
                <FolderOpen className="w-4 h-4" /> {t("sync.choose")}
              </Button>
            </div>
          )}

          <p className="text-xs sw-text-dim border-t sw-border-c pt-3">{t("sync.phoneHint")}</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
