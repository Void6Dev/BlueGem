import "@/App.css";
import { Component, lazy, Suspense, useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Toaster } from "sonner";
// Две страницы — два куска сборки. Список проектов и редактор не нужны
// одновременно ни разу за сеанс, а вместе они тянут за собой всё: React Flow,
// анимации, разбор markdown. Первый экран должен стоить только себя.
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Editor = lazy(() => import("@/pages/Editor"));
import { isDesktop, onLanguage, onMenuCommand, onOpenProject, takePendingProject } from "@/lib/desktop";
import { openProjectText, openResultMessage } from "@/lib/openProject";
import { api, usesCore } from "@/lib/api";
import { folderSync } from "@/lib/sync/folderSync";
import { setLanguage, t, useT } from "@/lib/i18n";
import {
  initNative, isNative, readSharedFile, setBackFallback, useIsMobile,
} from "@/lib/platform";

/** A render crash shouldn't leave the author staring at a blank page. */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen sw-bg flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="sw-display text-3xl mb-3">{t("app.crashTitle")}</h1>
          <p className="sw-text-dim text-sm mb-5">
            {t("app.crashText")}
          </p>
          <pre className="text-left text-[11px] font-mono-sw sw-text-dim border sw-border-c rounded-lg p-3 overflow-x-auto mb-5">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.assign("/")}
            className="px-4 py-2 rounded-full sw-accent-bg sw-accent-fg text-sm"
          >
            {t("app.toProjects")}
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Связь с десктопной оболочкой: файлы .bgproj, открытые двойным кликом или
 * через «Файл → Открыть», и команды меню. В браузере компонент не делает
 * ничего — все подписки в lib/desktop.js вырождаются в пустышки.
 */
function DesktopBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isDesktop) return undefined;

    const accept = async ({ content, path }) => {
      try {
        const result = await openProjectText(content);
        if (!result) return;
        toast.success(openResultMessage(result));
        navigate(`/project/${result.id}`);
      } catch (e) {
        toast.error(`${path ? `${path}: ` : ""}${e.message || t("errors.openFile")}`);
      }
    };

    // Папка синхронизации: менеджер живёт всё время работы приложения, а
    // не только на главной, — правки из редактора тоже должны уходить.
    folderSync()?.start().catch(() => {});

    const offOpen = onOpenProject(accept);
    const offMenu = onMenuCommand((command) => {
      if (command === "new-project") navigate("/?new=1");
    });
    // «Вид → Язык» в меню оболочки: интерфейс переключается следом.
    const offLanguage = onLanguage((lang) => setLanguage(lang));
    // Файл, с которым приложение запустили, ждёт в основном процессе.
    takePendingProject().then((file) => file && accept(file));

    return () => {
      offOpen();
      offMenu();
      offLanguage();
    };
  }, [navigate]);

  return null;
}

/**
 * Android: системная «назад» и файлы проектов, открытые из других приложений.
 *
 * Шторки и меню сами перехватывают «назад», пока открыты (lib/platform.js).
 * Когда закрывать уже нечего, кнопка ведёт по страницам: из редактора — к
 * списку проектов, со списка — сворачивает приложение, как любое другое.
 *
 * Файл .bgproj, открытый из «Файлов» или мессенджера, приходит ссылкой
 * content:// — читаем его и открываем так же, как импорт с панели проектов.
 */
function NativeBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  useEffect(() => setBackFallback(() => {
    if (pathRef.current === "/") return false;
    navigate("/");
    return true;
  }), [navigate]);

  // Первый запуск версии с ядром на Rust: проекты переезжают из IndexedDB.
  // Сообщаем об этом один раз — и о неудаче тоже: старые данные остались на
  // месте, перенос повторится при следующем запуске.
  useEffect(() => {
    if (!usesCore) return;
    api.migration().then(({ moved, failed }) => {
      if (moved) toast.success(t("mobile.coreMigrated", { count: t("count.projects", { count: moved }) }));
      if (failed) toast.error(t("mobile.coreMigrateFailed", { count: failed }));
    });
  }, []);

  useEffect(() => {
    if (!isNative) return undefined;
    initNative();
    let alive = true;
    let remove = null;
    const accept = async (url) => {
      if (!url || !/^(content|file):/i.test(url)) return;
      try {
        const text = await readSharedFile(url);
        const result = await openProjectText(text);
        if (!result || !alive) return;
        toast.success(openResultMessage(result));
        navigate(`/project/${result.id}`);
      } catch (e) {
        toast.error(e?.message || t("errors.openFile"));
      }
    };
    import("@capacitor/app").then(async ({ App: CapApp }) => {
      const launch = await CapApp.getLaunchUrl().catch(() => null);
      if (launch?.url) accept(launch.url);
      const handle = await CapApp.addListener("appUrlOpen", (e) => accept(e.url));
      if (alive) remove = handle; else handle.remove();
    }).catch(() => {});
    return () => { alive = false; remove?.remove(); };
  }, [navigate]);

  return null;
}

function NotFound() {
  const t = useT();
  return (
    <div className="min-h-screen sw-bg flex items-center justify-center px-6 text-center">
      <div>
        <p className="sw-display text-4xl mb-2">404</p>
        <p className="sw-text-dim text-sm mb-5">{t("app.notFoundText")}</p>
        <Link to="/" className="sw-accent-text text-sm underline underline-offset-4">{t("palette.home")}</Link>
      </div>
    </div>
  );
}

function App() {
  // Телефон — отдельная раскладка: класс на <html> включает mobile.css.
  const mobile = useIsMobile();
  useEffect(() => {
    document.documentElement.classList.toggle("sw-is-mobile", mobile);
  }, [mobile]);

  // Соседняя страница подтягивается в простое: переход «список → редактор»
  // должен быть мгновенным, а не ждать загрузки куска.
  useEffect(() => {
    const warm = () => { import("@/pages/Dashboard"); import("@/pages/Editor"); };
    const idle = window.requestIdleCallback;
    if (!idle) { const t = setTimeout(warm, 1500); return () => clearTimeout(t); }
    const handle = idle(warm, { timeout: 4000 });
    return () => window.cancelIdleCallback?.(handle);
  }, []);

  return (
    <div className="App">
      <ErrorBoundary>
        <BrowserRouter>
          <DesktopBridge />
          <NativeBridge />
          {/* Заглушка пустая: у обеих страниц свой скелетон, а вспышка
              «загрузка…» между ними была бы шумом на десятки миллисекунд. */}
          <Suspense fallback={null}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/project/:id" element={<Editor />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ErrorBoundary>
      {/* Colours come from --sw-* vars (see App.css), so toasts follow the theme. */}
      {/* На телефоне — сверху: снизу живут нижняя панель и шторки. */}
      <Toaster
        position={mobile ? "top-center" : "bottom-right"}
        richColors
        closeButton={!mobile}
        mobileOffset={{ top: "calc(var(--sw-safe-top) + 64px)", left: 12, right: 12 }}
        swipeDirections={mobile ? ["top", "left", "right"] : undefined}
      />
    </div>
  );
}

export default App;
