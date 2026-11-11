// Телефон: где мы запущены и что из этого следует.
//
// Весь остальной код спрашивает отсюда три вещи: работаем ли мы внутри
// Android-приложения (isNative), узкий ли экран под палец (useIsMobile) и как
// откликнуться рукой (haptic). Плагины Capacitor подтягиваются лениво: в
// десктопной сборке их код так и не загрузится.
import { useEffect, useRef, useSyncExternalStore } from "react";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

/** Приложение собрано Capacitor и запущено на устройстве, а не во вкладке. */
export const isNative = Capacitor.isNativePlatform();
export const nativePlatform = Capacitor.getPlatform(); // "android" | "ios" | "web"

/* ---------------- узкий экран ---------------- */

// Телефон — это не «маленькое окно», а другой способ держать устройство: в
// одной руке, большим пальцем. Планшет с пальцем остаётся на десктопной
// раскладке, но получает крупные цели нажатия через (pointer: coarse) в CSS.
const MOBILE_QUERY = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";

function mobileQuery() {
  return typeof window !== "undefined" && window.matchMedia ? window.matchMedia(MOBILE_QUERY) : null;
}

function subscribeMobile(cb) {
  const mq = mobileQuery();
  if (!mq) return () => {};
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

export function isMobileNow() {
  return !!mobileQuery()?.matches;
}

/** true на телефоне. Перерисовывает при повороте и смене размера окна. */
export function useIsMobile() {
  return useSyncExternalStore(subscribeMobile, isMobileNow, () => false);
}

/* ---------------- отклик рукой ---------------- */

let hapticsModule = null;
function loadHaptics() {
  if (!hapticsModule) hapticsModule = import("@capacitor/haptics").catch(() => null);
  return hapticsModule;
}

const VIBRATE = { tick: 6, light: 10, medium: 16, heavy: 24, success: [10, 40, 14], warning: [18, 60, 18] };

/**
 * Короткий отклик на действие: tick — переключение, light — касание, medium —
 * создано или выбрано, heavy — долгое нажатие, success/warning — итог.
 * Работает на телефоне; на компьютере молчит.
 */
export function haptic(kind = "light") {
  if (isNative) {
    loadHaptics().then((m) => {
      if (!m) return;
      const { Haptics, ImpactStyle, NotificationType } = m;
      if (kind === "tick") Haptics.selectionChanged?.().catch(() => {});
      else if (kind === "success") Haptics.notification({ type: NotificationType.Success }).catch(() => {});
      else if (kind === "warning") Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
      else {
        const style = kind === "heavy" ? ImpactStyle.Heavy : kind === "medium" ? ImpactStyle.Medium : ImpactStyle.Light;
        Haptics.impact({ style }).catch(() => {});
      }
    });
    return;
  }
  // Браузер на телефоне: короткая вибрация, если пользователь её не запретил.
  if (isMobileNow() && typeof navigator !== "undefined" && navigator.vibrate) {
    try { navigator.vibrate(VIBRATE[kind] ?? 10); } catch { /* запрещено политикой */ }
  }
}

/* ---------------- системная кнопка «назад» ---------------- */

// Стек слоёв: шторка поверх меню поверх холста. «Назад» закрывает верхний —
// ровно так, как ждёт любой человек с Android-телефоном в руке. Пока стек
// пуст, «назад» уходит в навигацию: из редактора к списку, из списка — в фон.
const backStack = [];
let fallbackBack = null;

/** Положить обработчик «назад» поверх остальных. Возвращает «снять». */
export function pushBack(handler) {
  const entry = { handler };
  backStack.push(entry);
  const remove = () => {
    const i = backStack.indexOf(entry);
    if (i !== -1) backStack.splice(i, 1);
  };
  // Верхний ли это слой — Esc на клавиатуре должен закрывать только его.
  remove.isTop = () => backStack[backStack.length - 1] === entry;
  return remove;
}

/** То же для компонента: пока active, «назад» зовёт handler. */
export function useBackHandler(handler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => (active ? pushBack(() => ref.current()) : undefined), [active]);
}

/** Что делать, когда закрывать уже нечего (навигация по страницам). */
export function setBackFallback(handler) {
  fallbackBack = handler;
  return () => { if (fallbackBack === handler) fallbackBack = null; };
}

/** Сработать как кнопка «назад». true — кто-то её обработал. */
export function handleBack() {
  const top = backStack[backStack.length - 1];
  if (top) {
    top.handler();
    return true;
  }
  return fallbackBack ? fallbackBack() !== false : false;
}

let nativeReady = false;

/**
 * Один раз при старте: кнопка «назад», цвет системных панелей, клавиатура.
 * В браузере не делает ничего.
 */
export async function initNative() {
  if (!isNative || nativeReady) return;
  nativeReady = true;
  document.documentElement.classList.add("sw-native", `sw-native-${nativePlatform}`);

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", () => {
      if (!handleBack()) App.minimizeApp?.().catch(() => App.exitApp());
    });
  } catch { /* без плагина «назад» работает по-системному */ }

  try {
    const { Keyboard } = await import("@capacitor/keyboard");
    Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.classList.add("sw-keyboard");
      document.documentElement.style.setProperty("--sw-keyboard-h", `${info?.keyboardHeight || 0}px`);
    });
    Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.classList.remove("sw-keyboard");
      document.documentElement.style.setProperty("--sw-keyboard-h", "0px");
    });
  } catch { /* клавиатура без событий — нижняя панель просто останется на месте */ }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    // Заставку убираем, когда интерфейс уже нарисован, — без белой вспышки.
    requestAnimationFrame(() => requestAnimationFrame(() => SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => {})));
  } catch { /* заставка уйдёт по таймеру */ }
}

/**
 * Значки системных панелей — под тему приложения: светлые на тёмной теме,
 * тёмные на светлой. Сами панели прозрачные (edge-to-edge), фон под ними —
 * фон приложения, а отступы от них даёт CSS (--sw-safe-*).
 */
export function syncSystemBars(light) {
  if (!isNative) return;
  SystemBars.setStyle({ style: light ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
}

/* ---------------- клавиатура в браузере телефона ---------------- */

// В вебе событий клавиатуры нет — узнаём о ней по тому, что поле в фокусе, а
// видимая область заметно ужалась. Нужна, чтобы нижняя панель не ехала
// поверх клавиатуры вместе с полем ввода.
if (typeof window !== "undefined" && !isNative && window.visualViewport) {
  let tallest = window.visualViewport.height;
  const sync = () => {
    const vv = window.visualViewport;
    tallest = Math.max(tallest, vv.height);
    const el = document.activeElement;
    const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    const open = typing && vv.height < tallest - 140;
    document.documentElement.classList.toggle("sw-keyboard", !!open);
  };
  window.visualViewport.addEventListener("resize", sync);
  window.addEventListener("focusin", sync);
  window.addEventListener("focusout", () => setTimeout(sync, 60));
}

/* ---------------- файлы: поделиться вместо «сохранить как» ---------------- */

/**
 * На телефоне нет диалога «Сохранить как» — есть «Поделиться». Файл кладём во
 * временную папку приложения и отдаём системному меню: оттуда его можно
 * сохранить в «Файлы», на Диск или отправить в мессенджер.
 * @returns {Promise<{saved: boolean, canceled?: boolean}>}
 */
export async function shareTextFile(filename, text, { title, base64 = false } = {}) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  // base64 — двоичный файл (картинка): без кодировки Filesystem пишет байты.
  const written = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    ...(base64 ? {} : { encoding: Encoding.UTF8 }),
  });
  try {
    await Share.share({ title: title || filename, files: [written.uri], dialogTitle: title || filename });
    return { saved: true };
  } catch (e) {
    // Закрыли меню, ничего не выбрав, — это не ошибка.
    if (/cancel/i.test(String(e?.message || e))) return { saved: false, canceled: true };
    throw e;
  }
}

/** Прочитать файл, который открыли из другого приложения (content://…). */
export async function readSharedFile(uri) {
  const { Filesystem, Encoding } = await import("@capacitor/filesystem");
  const res = await Filesystem.readFile({ path: uri, encoding: Encoding.UTF8 });
  return typeof res.data === "string" ? res.data : await res.data.text();
}
