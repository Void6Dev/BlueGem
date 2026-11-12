// Ядро на Rust внутри приложения для Android (server/src/android.rs).
//
// На телефоне нет отдельного сервера: запросы к API уходят в ядро через
// плагин Capacitor (BlueGemCorePlugin.java) — те же пути, тела и ответы, что
// у встроенного сервера на компьютере. Поэтому интерфейс говорит с ядром тем
// же axios-клиентом: меняется только «адаптер», который вместо сети зовёт
// плагин.
import { AxiosError } from "axios";
import { Capacitor, registerPlugin } from "@capacitor/core";

const Core = registerPlugin("BlueGemCore");

/** Ядро есть: собранное приложение для Android с плагином. */
export const hasCore = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BlueGemCore");

/** Один запрос к ядру: {status, contentType, body | base64}. */
export function coreRequest(method, path, body = "") {
  return Core.request({ method, path, body });
}

/**
 * Адаптер axios: запрос не в сеть, а в ядро. Ответ и ошибки — в том виде,
 * в каком их отдал бы сервер по HTTP: apiErrorMessage читает код ошибки из
 * error.response.data.detail так же, как на компьютере.
 */
export async function coreAdapter(config) {
  const uri = new URL(config.baseURL ? `${config.baseURL.replace(/\/$/, "")}/${(config.url || "").replace(/^\//, "")}` : config.url, "http://core");
  for (const [k, v] of Object.entries(config.params || {})) {
    if (v !== undefined && v !== null) uri.searchParams.set(k, String(v));
  }
  const method = (config.method || "get").toUpperCase();
  const body = typeof config.data === "string" ? config.data : config.data == null ? "" : JSON.stringify(config.data);
  const res = await coreRequest(method, `${uri.pathname}${uri.search}`, body);
  const response = {
    data: res.body ?? "",
    status: res.status,
    statusText: String(res.status),
    headers: { "content-type": res.contentType || "" },
    config,
    request: null,
  };
  const ok = config.validateStatus ? config.validateStatus(res.status) : res.status >= 200 && res.status < 300;
  if (ok) return response;
  throw new AxiosError(
    `Request failed with status code ${res.status}`,
    res.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  );
}

/** Картинка из ядра по хэшу — Blob для показа. */
export async function coreImage(hash) {
  const res = await coreRequest("GET", `/api/images/${hash}`);
  if (res.status !== 200 || !res.base64) return null;
  const bin = atob(res.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: res.contentType || "image/png" });
}
