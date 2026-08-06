import "@/App.css";
import { Component, useEffect } from "react";
import { BrowserRouter, Routes, Route, Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Toaster } from "sonner";
import Dashboard from "@/pages/Dashboard";
import Editor from "@/pages/Editor";
import { isDesktop, onLanguage, onMenuCommand, onOpenProject, takePendingProject } from "@/lib/desktop";
import { openProjectText } from "@/lib/openProject";
import { setLanguage, t, useT } from "@/lib/i18n";

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
          <h1 className="font-serif-title text-3xl mb-3">{t("app.crashTitle")}</h1>
          <p className="sw-text-dim text-sm mb-5">
            {t("app.crashText")}
          </p>
          <pre className="text-left text-[11px] font-mono-sw sw-text-dim border sw-border-c rounded-lg p-3 overflow-x-auto mb-5">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            onClick={() => window.location.assign("/")}
            className="px-4 py-2 rounded-full sw-accent-bg text-white text-sm"
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
        toast.success(t(result.action === "imported"
          ? "dashboard.toasts.imported"
          : "dashboard.toasts.opened", { name: result.name }));
        navigate(`/project/${result.id}`);
      } catch (e) {
        toast.error(`${path ? `${path}: ` : ""}${e.message || t("errors.openFile")}`);
      }
    };

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

function NotFound() {
  const t = useT();
  return (
    <div className="min-h-screen sw-bg flex items-center justify-center px-6 text-center">
      <div>
        <p className="font-serif-title text-4xl mb-2">404</p>
        <p className="sw-text-dim text-sm mb-5">{t("app.notFoundText")}</p>
        <Link to="/" className="sw-accent-text text-sm underline underline-offset-4">{t("palette.home")}</Link>
      </div>
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <ErrorBoundary>
        <BrowserRouter>
          <DesktopBridge />
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/project/:id" element={<Editor />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
      {/* Colours come from --sw-* vars (see App.css), so toasts follow the theme. */}
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}

export default App;
