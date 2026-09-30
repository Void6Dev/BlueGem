import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowDownToLine, Check, MessageSquare, RefreshCw, RotateCcw, ExternalLink, X,
} from "lucide-react";
import { updates, sendFeedback, openFeedbackIssue, openExternal, appVersion } from "@/lib/desktop";
import MarkdownView from "@/components/MarkdownView";
import { useT, getLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

const RELEASES_URL = "https://github.com/Void6Dev/BlueGem/releases";

/** "1.2.0" → число для сравнения строк вида 1.2.0; мусор даёт null. */
function versionKey(raw) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw || ""));
  return m ? Number(m[1]) * 1e6 + Number(m[2]) * 1e3 + Number(m[3]) : null;
}

function compare(a, b) {
  const x = versionKey(a);
  const y = versionKey(b);
  if (x === null || y === null) return 0;
  return x - y;
}

/**
 * Кнопка обновления на главной.
 *
 * Состояния кнопки: серая — версия свежая или проверить не удалось; зелёная —
 * в репозитории есть релиз новее. Внутри диалога — установка любой версии из
 * списка, поэтому откат назад устроен тем же кодом, что и обновление вперёд.
 */
export default function UpdateCenter() {
  const t = useT();
  const lang = getLanguage();
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busyTag, setBusyTag] = useState("");     // какую версию ставим прямо сейчас
  const [confirmTag, setConfirmTag] = useState(""); // откат подтверждают вторым кликом
  const [progress, setProgress] = useState(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [fbTitle, setFbTitle] = useState("");
  const [fbBody, setFbBody] = useState("");
  const [fbKind, setFbKind] = useState("feedback");
  const [fbEmail, setFbEmail] = useState("");
  const [fbSending, setFbSending] = useState(false);
  const [fbFailed, setFbFailed] = useState(false); // письмо не ушло — предлагаем GitHub

  // Проверку делает оболочка один раз за запуск; здесь мы лишь забираем её
  // результат — check() без force отдаёт кэш и не ходит в сеть.
  useEffect(() => {
    if (!updates.supported) return undefined;
    let alive = true;
    // Здесь молчание намеренное: это фоновая проверка обновлений при запуске,
    // и жаловаться на отсутствие сети посреди работы незачем — состояние
    // кнопки останется прежним, а «проверить» рядом сообщит об ошибке вслух.
    updates.check().then((s) => { if (alive) setState(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => updates.onProgress(setProgress), []);

  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      const s = await updates.check({ force: true });
      setState(s);
      if (s.error) toast.error(t("update.checkFailed"));
      else if (!s.latest) toast.success(t("update.upToDate"));
    } finally {
      setChecking(false);
    }
  }, [t]);

  const install = useCallback(async (tag) => {
    setBusyTag(tag);
    setProgress({ percent: 0 });
    try {
      const res = await updates.install(tag);
      if (!res.ok) {
        // Файла у релиза нет — открываем страницу, дальше человек решает сам.
        if (res.error === "no-asset") {
          openExternal(res.url || RELEASES_URL);
          toast.message(t("update.noAsset"));
        } else {
          toast.error(t("update.installFailed", { error: res.error || "" }));
        }
        return;
      }
      // Портативной сборке подменить себя нельзя: файл скачан и показан в папке.
      if (res.portable) toast.success(t("update.portableDone"));
      else toast.success(t("update.launching"));
    } finally {
      setBusyTag("");
      setProgress(null);
      setConfirmTag("");
    }
  }, [t]);

  const closeFeedback = useCallback(() => {
    setFeedbackOpen(false);
    setFbTitle("");
    setFbBody("");
    setFbFailed(false);
  }, []);

  const submitFeedback = useCallback(async () => {
    if (!fbTitle.trim()) return toast.error(t("update.feedbackTitleRequired"));
    setFbSending(true);
    try {
      const res = await sendFeedback({
        title: fbTitle.trim(), body: fbBody.trim(), kind: fbKind, email: fbEmail.trim(),
      });
      if (res.ok) {
        closeFeedback();
        toast.success(t("update.feedbackSent"));
        return undefined;
      }
      // Слишком частая отправка — не сбой: запасной путь предлагать незачем.
      if (res.error === "too-often") {
        toast.message(t("update.feedbackTooOften"));
        return undefined;
      }
      // Форму не закрываем: написанное не должно пропасть из-за сбоя сети.
      setFbFailed(true);
      toast.error(t("update.feedbackFailed"));
    } finally {
      setFbSending(false);
    }
    return undefined;
  }, [fbTitle, fbBody, fbKind, fbEmail, closeFeedback, t]);

  /** Запасной путь после неудачной отправки — issue с тем же текстом. */
  const feedbackViaGithub = useCallback(async () => {
    await openFeedbackIssue({ title: fbTitle.trim(), body: fbBody.trim(), kind: fbKind });
    closeFeedback();
    toast.message(t("update.feedbackOpened"));
  }, [fbTitle, fbBody, fbKind, closeFeedback, t]);

  const current = state?.current || appVersion;
  const latest = state?.latest || null;
  const releases = state?.releases || [];
  const date = (iso) => (iso ? new Date(iso).toLocaleDateString(lang === "ru" ? "ru-RU" : "en-GB") : "");

  return (
    <>
      {updates.supported && (
        <button
          data-testid="update-btn"
          onClick={() => setOpen(true)}
          title={latest ? t("update.availableTitle", { version: latest.version }) : t("update.title")}
          className={`sw-update-btn ${latest ? "is-new" : ""}`}
        >
          <ArrowDownToLine className="w-4 h-4" />
          <span className="hidden sm:inline">
            {latest ? t("update.available") : `v${current}`}
          </span>
          {latest && <span className="sw-update-dot" />}
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="update-dialog">
          <DialogHeader>
            <DialogTitle>{t("update.title")}</DialogTitle>
            <DialogDescription>
              {t("update.current", { version: current })}
              {state?.checkedAt ? ` · ${t("update.checkedAt", { date: date(new Date(state.checkedAt).toISOString()) })}` : ""}
            </DialogDescription>
          </DialogHeader>

          {/* Свежий релиз — единственный блок с заливкой: остальное список. */}
          {latest ? (
            <div className="rounded-lg p-3 sw-update-hero" data-testid="update-hero">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{latest.name || latest.tag}</p>
                  <p className="sw-t-meta sw-text-dim">
                    {t("update.newVersion", { version: latest.version })} · {date(latest.publishedAt)}
                  </p>
                </div>
                <Button
                  data-testid="install-latest-btn"
                  onClick={() => install(latest.tag)}
                  disabled={!!busyTag}
                  className="rounded-full text-white border-0 gap-2"
                  style={{ background: "var(--sw-ok)" }}
                >
                  <ArrowDownToLine className="w-4 h-4" />
                  {busyTag === latest.tag ? t("update.installing") : t("update.install")}
                </Button>
              </div>
              {latest.notes && (
                <div className="mt-2 max-h-32 overflow-y-auto sw-t-body sw-text-dim">
                  <MarkdownView text={latest.notes} compact />
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm sw-text-dim flex items-center gap-2" data-testid="update-status">
              {state?.error
                ? <>{t("update.offline")}</>
                : <><Check className="w-4 h-4" style={{ color: "var(--sw-ok)" }} /> {t("update.upToDate")}</>}
            </p>
          )}

          {busyTag && (
            <div className="sw-progress" data-testid="update-progress">
              <span style={{ width: `${progress?.percent || 0}%` }} />
            </div>
          )}

          {/* Все версии: отсюда же и откат — установка старого релиза ничем не
              отличается от установки нового. */}
          {releases.length > 0 && (
            <div>
              <p className="sw-section-label mb-1.5">{t("update.allVersions")}</p>
              <div className="max-h-56 sw-scroll-y -mx-1 px-1">
                {releases.map((r) => {
                  const rel = compare(r.version, current);
                  const isCurrent = rel === 0;
                  const older = rel < 0;
                  return (
                    <div key={r.tag} className="sw-list-item" data-testid={`release-${r.tag}`}>
                      <span className="text-[13px] truncate flex-1">
                        v{r.version}
                        {r.prerelease && <span className="ml-1.5 sw-badge sw-badge-mute">pre</span>}
                      </span>
                      <span className="sw-t-num sw-text-dim shrink-0">{date(r.publishedAt)}</span>
                      {isCurrent ? (
                        <span className="sw-badge sw-badge-mute shrink-0">{t("update.currentBadge")}</span>
                      ) : (
                        <button
                          data-testid={`install-${r.tag}`}
                          disabled={!!busyTag}
                          onClick={() => (older && confirmTag !== r.tag ? setConfirmTag(r.tag) : install(r.tag))}
                          className="sw-badge shrink-0 disabled:opacity-40"
                          style={{
                            background: confirmTag === r.tag
                              ? "color-mix(in srgb, var(--sw-warn) 22%, transparent)"
                              : "var(--sw-surface-2)",
                            color: confirmTag === r.tag ? "var(--sw-warn)" : "var(--sw-text-dim)",
                          }}
                        >
                          {confirmTag === r.tag
                            ? t("update.rollbackConfirm")
                            : <>{older ? <RotateCcw className="w-2.5 h-2.5" /> : <ArrowDownToLine className="w-2.5 h-2.5" />}
                              {older ? t("update.rollback") : t("update.install")}</>}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {confirmTag && <p className="sw-t-meta sw-text-dim mt-1.5">{t("update.rollbackHint")}</p>}
            </div>
          )}

          <DialogFooter className="sm:justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={recheck} disabled={checking} className="gap-2 sw-text-dim">
                <RefreshCw className={`w-4 h-4 ${checking ? "animate-spin" : ""}`} /> {t("update.checkNow")}
              </Button>
              <Button variant="ghost" onClick={() => openExternal(RELEASES_URL)} className="gap-2 sw-text-dim">
                <ExternalLink className="w-4 h-4" /> GitHub
              </Button>
            </div>
            <Button
              data-testid="open-feedback-btn"
              variant="ghost"
              onClick={() => { setOpen(false); setFeedbackOpen(true); }}
              className="gap-2"
            >
              <MessageSquare className="w-4 h-4" /> {t("update.feedback")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Фидбек уходит письмом автору прямо отсюда — без GitHub и аккаунта.
          Если письмо не ушло, форма остаётся открытой и предлагает issue. */}
      <Dialog open={feedbackOpen} onOpenChange={(v) => (v ? setFeedbackOpen(true) : closeFeedback())}>
        <DialogContent className="sm:max-w-md" data-testid="feedback-dialog">
          <DialogHeader>
            <DialogTitle>{t("update.feedbackTitle")}</DialogTitle>
            <DialogDescription>{t("update.feedbackHint")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            {[
              { id: "feedback", label: t("update.kindIdea") },
              { id: "bug", label: t("update.kindBug") },
            ].map((k) => (
              <button
                key={k.id}
                data-testid={`feedback-kind-${k.id}`}
                onClick={() => setFbKind(k.id)}
                className="h-8 px-3 rounded-lg border text-xs sw-btn"
                style={{
                  borderColor: fbKind === k.id ? "var(--sw-accent)" : "var(--sw-border)",
                  background: fbKind === k.id ? "color-mix(in srgb, var(--sw-accent) 14%, transparent)" : "transparent",
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
          <Input
            data-testid="feedback-title"
            value={fbTitle}
            onChange={(e) => setFbTitle(e.target.value)}
            placeholder={t("update.feedbackTitlePlaceholder")}
            className="bg-transparent sw-border-c"
          />
          <Textarea
            data-testid="feedback-body"
            value={fbBody}
            onChange={(e) => setFbBody(e.target.value)}
            rows={5}
            placeholder={t("update.feedbackBodyPlaceholder")}
            className="bg-transparent sw-border-c resize-none text-sm"
          />
          {/* Адрес нужен только для ответа — без него отзыв всё равно дойдёт. */}
          <Input
            data-testid="feedback-email"
            type="email"
            value={fbEmail}
            onChange={(e) => setFbEmail(e.target.value)}
            placeholder={t("update.feedbackEmailPlaceholder")}
            className="bg-transparent sw-border-c"
          />
          <p className="sw-t-meta sw-text-dim">{t("update.feedbackFooter", { version: current })}</p>

          {fbFailed && (
            <p className="sw-t-meta" style={{ color: "var(--sw-warn)" }} data-testid="feedback-failed">
              {t("update.feedbackFailedHint")}
            </p>
          )}

          <DialogFooter className="sm:justify-between gap-2">
            <Button variant="ghost" onClick={closeFeedback} className="gap-2 sw-text-dim">
              <X className="w-4 h-4" /> {t("common.cancel")}
            </Button>
            <div className="flex items-center gap-2">
              {fbFailed && (
                <Button
                  data-testid="feedback-github"
                  variant="ghost"
                  onClick={feedbackViaGithub}
                  className="gap-2 sw-text-dim"
                >
                  <ExternalLink className="w-4 h-4" /> GitHub
                </Button>
              )}
              <Button
                data-testid="feedback-send"
                onClick={submitFeedback}
                disabled={fbSending}
                className="gap-2 sw-accent-bg sw-accent-fg border-0"
              >
                <MessageSquare className={`w-4 h-4 ${fbSending ? "animate-pulse" : ""}`} />
                {fbSending ? t("update.feedbackSending") : t("update.feedbackSend")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
