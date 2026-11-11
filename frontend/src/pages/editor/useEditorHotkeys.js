// Горячие клавиши редактора. Один слушатель на окне; клавиша берётся по
// физическому положению (lib/hotkey), чтобы сочетания работали и в русской
// раскладке. Зависимости — те же, что были у эффекта внутри редактора.
import { useEffect } from "react";
import { hotkey } from "@/lib/hotkey";

export function useEditorHotkeys(ctx) {
  const {
    addNode, closeAll, copyNodes, duplicateNode, pasteNodes, rf, runLayout, searchRef,
    selectedNode, setFocusMode, setShowPalette, setShowShortcuts, setSidebar, settings,
    showPalette, showShortcuts, undo,
  } = ctx;

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const tag = (el.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;
      // Клавишу берём по физической позиции: на кириллице e.key — «и», а не "b".
      const key = hotkey(e);

      if (mod && key === "k") {
        e.preventDefault();
        setShowPalette((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        // Esc уже закрыл верхнюю шторку — остальное не трогаем.
        if (e.defaultPrevented) return;
        if (showPalette || showShortcuts) { setShowPalette(false); setShowShortcuts(false); return; }
        closeAll();
        return;
      }
      if (mod && key === "f") {
        e.preventDefault();
        // Поиск живёт в боковой панели — свёрнутую раскрываем заодно.
        setSidebar((s) => ({ ...s, open: true }));
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (mod && key === "z" && !typing) {
        e.preventDefault();
        undo();
        return;
      }
      if (typing || showPalette) return;
      if (mod && key === "d") {
        e.preventDefault();
        // Узлы спрашиваем у React Flow, а не держим их в зависимостях эффекта:
        // иначе слушатель клавиш переподписывался бы на каждый кадр переноса
        // карточки по холсту.
        duplicateNode(selectedNode || rf.getNodes().find((n) => n.selected)?.data);
        return;
      }
      if (mod && key === "c") { e.preventDefault(); copyNodes(); return; }
      if (mod && key === "v") { e.preventDefault(); pasteNodes(); return; }
      // Создание узлов — под Ctrl: голые N и цифры мешали печатать в холсте
      // и срабатывали случайно.
      if (mod && key === "n") { e.preventDefault(); addNode("note"); return; }
      if (mod && /^[1-9]$/.test(key)) {
        const t = (settings?.nodeTypes || [])[Number(key) - 1];
        if (t) { e.preventDefault(); addNode(t.id); }
        return;
      }
      if (mod) return;
      if (key === "g") { e.preventDefault(); setFocusMode((v) => !v); }
      else if (key === "f") { e.preventDefault(); rf.fitView({ padding: 0.2, duration: 400 }); }
      else if (key === "l") { e.preventDefault(); runLayout("layered"); }
      else if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); setShowShortcuts((v) => !v); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedNode, duplicateNode, addNode, runLayout, rf, settings, undo, closeAll,
      showPalette, showShortcuts, copyNodes, pasteNodes]);
}
