// Картинки узлов вне самих узлов.
//
// Раньше картинка жила в узле строкой base64: каждая выборка графа, каждая
// резервная копия и каждый экспорт тащили её целиком, а проект с десятком
// портретов открывался заметно медленнее пустого. Теперь в узле лежит ссылка
// "bg-image:<sha256>", а сами байты — отдельно: на компьютере в таблице images
// встроенного сервера, на телефоне — в IndexedDB. В файл .bgproj картинка
// по-прежнему уходит строкой data:, так что формат файла не изменился.
import { useEffect, useState } from "react";

export const IMAGE_PREFIX = "bg-image:";

export const isImageRef = (v) => typeof v === "string" && v.startsWith(IMAGE_PREFIX);
export const imageHash = (v) => (isImageRef(v) ? v.slice(IMAGE_PREFIX.length) : "");

const DATA_URL = /^data:(image\/[\w.+-]+);base64,(.*)$/s;

function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function sha256Hex(bytes) {
  if (typeof crypto !== "undefined" && crypto.subtle?.digest) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, "0")).join("");
  }
  // Без SubtleCrypto (не защищённый контекст) — не криптография, а только
  // отпечаток для того, чтобы одинаковые картинки хранились один раз.
  let h = "";
  for (let seed = 0; seed < 8; seed += 1) {
    let x = 0x811c9dc5 ^ seed;
    for (let i = 0; i < bytes.length; i += 1) x = Math.imul(x ^ bytes[i], 0x01000193);
    h += (x >>> 0).toString(16).padStart(8, "0");
  }
  return h;
}

/**
 * data:image/... → запись для хранилища {hash, mime, blob, ref}.
 * Всё остальное (пусто, ссылка http, уже ссылка bg-image) → null.
 */
export async function toImageRecord(value) {
  if (typeof value !== "string" || !value.startsWith("data:image/")) return null;
  const m = DATA_URL.exec(value);
  if (!m) return null;
  let bytes;
  try { bytes = base64ToBytes(m[2]); } catch { return null; }
  if (!bytes.length) return null;
  const hash = await sha256Hex(bytes);
  return { hash, mime: m[1], blob: new Blob([bytes], { type: m[1] }), ref: IMAGE_PREFIX + hash };
}

/** Blob → data:… (для экспорта в файл). */
export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  // Кусками: String.fromCharCode(...огромный массив) переполняет стек.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(bin)}`;
}

/* ---------------- показ ---------------- */

// Откуда брать байты по ссылке. Ставит lib/api.js: у сервера это адрес
// /api/images/<hash>, у хранилища в приложении — Blob из IndexedDB.
let resolver = { url: () => "", load: null };

export function setImageResolver(next) {
  resolver = next;
}

const objectUrls = new Map(); // hash → Promise<string>

/** Синхронный адрес картинки, если он известен без загрузки. */
export function imageSrcNow(value) {
  if (!value) return "";
  if (!isImageRef(value)) return value;
  const hash = imageHash(value);
  if (resolver.url) {
    const url = resolver.url(hash);
    if (url) return url;
  }
  return objectUrls.get(hash)?.resolved || "";
}

/** Адрес картинки для <img src>: строка data:/http как есть, ссылка — через хранилище. */
export async function resolveImageSrc(value) {
  const now = imageSrcNow(value);
  if (now || !isImageRef(value) || !resolver.load) return now;
  const hash = imageHash(value);
  if (!objectUrls.has(hash)) {
    const p = resolver.load(hash).then((blob) => {
      const url = blob ? URL.createObjectURL(blob) : "";
      p.resolved = url;
      return url;
    }).catch(() => "");
    objectUrls.set(hash, p);
  }
  return objectUrls.get(hash);
}

/** То же для компонентов: пока байты грузятся из хранилища — пустая строка. */
export function useImageSrc(value) {
  const [src, setSrc] = useState(() => imageSrcNow(value));
  useEffect(() => {
    let alive = true;
    const now = imageSrcNow(value);
    setSrc(now);
    if (!now && isImageRef(value)) {
      resolveImageSrc(value).then((url) => { if (alive) setSrc(url); });
    }
    return () => { alive = false; };
  }, [value]);
  return src;
}
