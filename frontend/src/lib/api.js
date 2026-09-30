import axios from "axios";
import { apiBase, apiToken, isDesktop } from "@/lib/desktop";
import { getLanguage, t } from "@/lib/i18n";

// Откуда брать API, в порядке приоритета:
//   1. адрес встроенного сервера, который передала десктопная оболочка;
//   2. REACT_APP_BACKEND_URL — для разработки в браузере;
//   3. тот же origin — в собранном приложении интерфейс отдаёт сам сервер.
const BACKEND_URL = apiBase || process.env.REACT_APP_BACKEND_URL || "";
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API, timeout: 20000 });

// Встроенный сервер слушает только 127.0.0.1, но на localhost может
// постучаться и посторонняя страница из браузера — поэтому общий секрет.
if (apiToken) client.defaults.headers.common["X-BG-Token"] = apiToken;

/**
 * Turn an axios failure into the most useful sentence we can show in a toast.
 * @param {unknown} e ошибка axios
 * @param {string} [fallbackKey] ключ перевода на случай, если сервер молчит
 */
export function apiErrorMessage(e, fallbackKey = "errors.generic") {
  const fallback = t(fallbackKey);
  if (e?.code === "ECONNABORTED") return t("errors.noResponse");
  if (e?.response?.status === 403) return t("errors.rejected");
  const detail = e?.response?.data?.detail;
  if (detail) {
    // Сервер отдаёт код ошибки, а не текст: подпись подбирает интерфейс,
    // чтобы она была на языке, который выбрал пользователь.
    if (typeof detail === "object" && !Array.isArray(detail) && detail.code) {
      const translated = t(`errors.${detail.code}`);
      return translated === `errors.${detail.code}` ? (detail.message || fallback) : translated;
    }
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail[0]?.msg || fallback;
  }
  if (e?.message === "Network Error") {
    return t(isDesktop ? "errors.offlineDesktop" : "errors.offlineWeb");
  }
  return fallback;
}

export const api = {
  listProjects: () => client.get("/projects").then((r) => r.data),
  // lang уходит на сервер: типы узлов и первый холст нового проекта заводятся
  // на языке интерфейса. Дальше это уже данные проекта и сами не переводятся.
  createProject: (data) => client.post("/projects", { lang: getLanguage(), ...data }).then((r) => r.data),
  // Что заводит каждый шаблон: типы узлов и страницы — уже на языке интерфейса.
  listTemplates: () => client.get("/templates", { params: { lang: getLanguage() } }).then((r) => r.data),
  getProject: (id) => client.get(`/projects/${id}`).then((r) => r.data),
  updateProject: (id, data) => client.put(`/projects/${id}`, data).then((r) => r.data),
  deleteProject: (id) => client.delete(`/projects/${id}`).then((r) => r.data),
  duplicateProject: (id) => client.post(`/projects/${id}/duplicate`).then((r) => r.data),
  exportProject: (id) => client.get(`/projects/${id}/export`).then((r) => r.data),
  importProject: (payload) => client.post("/projects/import", payload).then((r) => r.data),

  getGraph: (id) => client.get(`/projects/${id}/graph`).then((r) => r.data),
  createNode: (pid, data) => client.post(`/projects/${pid}/nodes`, data).then((r) => r.data),
  updateNode: (id, data) => client.put(`/nodes/${id}`, data).then((r) => r.data),
  deleteNode: (id) => client.delete(`/nodes/${id}`).then((r) => r.data),
  updatePositions: (pid, positions) =>
    client.put(`/projects/${pid}/nodes/positions`, { positions }).then((r) => r.data),

  createEdge: (pid, data) => client.post(`/projects/${pid}/edges`, data).then((r) => r.data),
  updateEdge: (id, patch) => client.put(`/edges/${id}`, patch).then((r) => r.data),
  deleteEdge: (id) => client.delete(`/edges/${id}`).then((r) => r.data),
};
