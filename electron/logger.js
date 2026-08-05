"use strict";
/**
 * Лог приложения. Пишется в файл рядом с данными пользователя
 * (%APPDATA%\BlueGem\logs\main.log) и дублируется в консоль при разработке.
 *
 * Последние строки держим в памяти: если сервер не поднялся, окно ошибки
 * показывает именно их — иначе пользователю нечего сообщить о поломке.
 */
const fs = require("node:fs");
const path = require("node:path");

const TAIL_LIMIT = 200;
const MAX_BYTES = 2 * 1024 * 1024; // лог не должен расти бесконечно

let stream = null;
let filePath = null;
const tail = [];

function init(logDir) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    filePath = path.join(logDir, "main.log");
    // Раз файл разросся — начинаем с чистого, старый оставляем как .old.
    try {
      if (fs.statSync(filePath).size > MAX_BYTES) {
        fs.renameSync(filePath, `${filePath}.old`);
      }
    } catch {
      /* файла ещё нет — это нормально */
    }
    stream = fs.createWriteStream(filePath, { flags: "a", encoding: "utf8" });
    write("info", `=== BlueGem запущен ${new Date().toISOString()} ===`);
  } catch (e) {
    // Без файла лога приложение всё равно должно работать.
    console.error("[log] не удалось открыть файл лога:", e.message);
  }
}

function write(level, ...parts) {
  const line = `${new Date().toISOString()} [${level}] ${parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ")}`;
  tail.push(line);
  if (tail.length > TAIL_LIMIT) tail.shift();
  if (stream) stream.write(`${line}\n`);
  if (!process.env.BG_QUIET) console.log(line);
}

module.exports = {
  init,
  info: (...a) => write("info", ...a),
  warn: (...a) => write("warn", ...a),
  error: (...a) => write("error", ...a),
  /** Хвост лога для окна ошибки. */
  recent: (n = 40) => tail.slice(-n).join("\n"),
  file: () => filePath,
};
