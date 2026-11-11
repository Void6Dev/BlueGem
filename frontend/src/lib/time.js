/** «5 мин назад», «3 ч назад»; старше месяца — дата. */
export function relativeTime(iso, t, lang) {
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

/** Дата и время целиком — для подсказки и списка копий. */
export function fullTime(iso, lang) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(lang === "ru" ? "ru-RU" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
