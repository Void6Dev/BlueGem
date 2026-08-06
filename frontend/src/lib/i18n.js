// Переключение языка интерфейса. Русский и английский, без внешних библиотек.
//
// Язык — настройка приложения, а не проекта: он живёт в localStorage и общий
// для всех проектов (в отличие от темы и шрифта, которые хранятся в проекте).
//
// Использование в компоненте:
//     const t = useT();
//     <span>{t("common.save")}</span>
//     <span>{t("count.nodes", { count: 3 })}</span>
import { useMemo, useSyncExternalStore } from "react";
import en from "@/locales/en";
import ru from "@/locales/ru";

const DICTS = { en, ru };
const STORAGE_KEY = "bluegem:lang";

export const LANGUAGES = [
  { id: "ru", label: "Русский", short: "RU" },
  { id: "en", label: "English", short: "EN" },
];

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (DICTS[saved]) return saved;
  } catch {
    /* приватный режим — берём язык системы */
  }
  const system = (typeof navigator !== "undefined" && navigator.language) || "en";
  return system.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let lang = detect();
const listeners = new Set();

function lookup(dict, key) {
  return key.split(".").reduce((node, part) => (node == null ? node : node[part]), dict);
}

function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (whole, name) =>
    (vars && name in vars ? String(vars[name]) : whole));
}

/**
 * Какую форму множественного числа брать.
 * У русского их три (1 узел, 2 узла, 5 узлов), у английского две.
 */
function pluralIndex(count) {
  if (lang !== "ru") return count === 1 ? 0 : 1;
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

/**
 * Перевод по ключу. Значение-массив считается набором форм множественного
 * числа и выбирается по vars.count.
 */
export function t(key, vars) {
  // Английский — запасной словарь: недоведённый перевод не оставит пустоту.
  const value = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key);
  if (value == null) return key; // забытый ключ видно сразу, а не пустотой
  if (Array.isArray(value)) {
    const forms = value;
    return fill(forms[Math.min(pluralIndex(vars?.count ?? 0), forms.length - 1)], vars);
  }
  return fill(value, vars);
}

/**
 * Массив как данные, а не как формы множественного числа: шаблоны полей узла
 * (`fieldTemplates`) — это подсказки, которые вставляются в проект.
 */
export function tList(key) {
  const value = lookup(DICTS[lang], key) ?? lookup(DICTS.en, key);
  return Array.isArray(value) ? value : [];
}

export function getLanguage() {
  return lang;
}

export function setLanguage(next) {
  if (!DICTS[next] || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* не сохранилось — язык продержится до конца сеанса */
  }
  if (typeof document !== "undefined") document.documentElement.lang = next;
  // Оболочка перестроит меню и системные диалоги под тот же язык.
  try {
    window.bluegem?.setLanguage?.(next);
  } catch {
    /* в браузере моста нет */
  }
  listeners.forEach((notify) => notify());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Текущий язык; компонент перерисуется при переключении. */
export function useLanguage() {
  return useSyncExternalStore(subscribe, getLanguage, getLanguage);
}

/**
 * Функция перевода для компонента.
 *
 * Идентичность меняется вместе с языком намеренно: списки меню и команд
 * собраны в useMemo с `t` в зависимостях, и без этого они остались бы
 * на прежнем языке до следующей правки данных.
 */
export function useT() {
  const current = useLanguage();
  return useMemo(() => {
    const translate = (key, vars) => t(key, vars);
    translate.lang = current;
    return translate;
  }, [current]);
}

/** Проставляем язык документа сразу, до первой отрисовки. */
if (typeof document !== "undefined") document.documentElement.lang = lang;
