"use strict";
/**
 * Отправка отзыва прямо из приложения — без GitHub и без аккаунта.
 *
 * Слать почту напрямую нельзя: для SMTP нужны логин и пароль от ящика, а всё
 * содержимое app.asar распаковывается одной командой — пароль утёк бы с первой
 * же сборкой. Поэтому письмо отправляет свой ретранслятор на Google Apps Script
 * (scripts/feedback-relay.gs): приложение шлёт ему POST, он пишет на почту
 * автора. Наружу попадает только адрес развёртывания — сам по себе он позволяет
 * отправить письмо на заранее заданный ящик и ничего больше.
 *
 * Если адрес не задан или сеть недоступна, остаётся запасной путь — issue на
 * GitHub. Человек в любом случае не теряет написанный текст.
 */
const { app, net } = require("electron");

const log = require("./logger");

// Адрес развёртывания веб-приложения Apps Script — как его получить, написано
// в шапке scripts/feedback-relay.gs. Переменная окружения нужна, чтобы проверять
// отправку на тестовом развёртывании, не пересобирая приложение.
const RELAY_URL = process.env.BG_FEEDBACK_RELAY || "https://script.google.com/macros/s/AKfycbxeEORvX3bM6AKxNk98kvlUf6DG4D5GtSc5rZw3A12DpDwoBE76rB3J0K9Q-qrBbusD/exec";

const TIMEOUT_MS = 15000;
const MAX_BODY = 5000;

// Защита от того, что реально способно сжечь квоту: не поток живых отзывов,
// а зажатая кнопка и повторы одного и того же текста.
const MIN_INTERVAL_MS = 30000;
let lastSentAt = 0;
let lastDigest = "";

/** Строка «BlueGem 1.2.1 · win32 x64 · Electron 43.3.0» для подвала письма. */
function environmentLine() {
  return `BlueGem ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`;
}

/**
 * Отправить отзыв.
 *
 * @param title  тема; без неё письмо бесполезно, проверяется в интерфейсе
 * @param body   текст
 * @param kind   "bug" | "feedback" — попадает в тему письма, чтобы отделять
 *               ошибки от пожеланий прямо в ящике
 * @param email  необязательный обратный адрес: без него ответить некому
 *
 * @returns { ok: true } либо { ok: false, error } — интерфейс по ошибке
 *          предлагает открыть GitHub, текст при этом остаётся в форме.
 */
async function send({ title = "", body = "", kind = "feedback", email = "" } = {}) {
  if (!RELAY_URL) return { ok: false, error: "not-configured" };

  const subject = `[BlueGem ${kind === "bug" ? "bug" : "idea"}] ${String(title).slice(0, 150)}`;
  const message = [
    String(body).slice(0, MAX_BODY),
    "",
    "---",
    environmentLine(),
    email ? `Обратный адрес: ${email}` : "Обратный адрес не указан",
  ].join("\n");

  // Тот же текст второй раз — это не второй отзыв, а повторное нажатие.
  const digest = `${subject}\n${message}`;
  const now = Date.now();
  if (digest === lastDigest) return { ok: true, duplicate: true };
  if (now - lastSentAt < MIN_INTERVAL_MS) return { ok: false, error: "too-often" };

  // Таймаут обязателен: net.fetch без него висит до победного, а пользователь
  // в это время смотрит на крутящуюся кнопку.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await net.fetch(RELAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: abort.signal,
      // replyto ретранслятор поставит в reply-to письма, а не в «от кого»:
      // адрес приходит от пользователя и доверять ему нельзя.
      body: JSON.stringify({ subject, message, replyto: email || "", kind }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data && data.success === false) throw new Error(data.message || "rejected");
    lastSentAt = Date.now();
    lastDigest = digest;
    log.info("отзыв отправлен");
    return { ok: true };
  } catch (e) {
    const error = abort.signal.aborted ? "timeout" : (e.message || String(e));
    log.warn(`отзыв не отправлен: ${error}`);
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { send, configured: () => !!RELAY_URL, environmentLine };
