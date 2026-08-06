// Браузер бросает ошибку «ResizeObserver loop completed with undelivered
// notifications», когда колбэк наблюдателя сам меняет разметку и та же партия
// изменений не успевает разойтись за один проход. React Flow делает ровно это
// при изменении размера холста (перетаскивание боковой панели), а dev-оверлей
// CRA показывает любую ошибку окна во весь экран.
//
// Гасить событие слушателем нельзя: клиент dev-сервера регистрируется раньше
// нашего кода, а событие приходит прямо на window — то есть в фазе AT_TARGET,
// где порядок регистрации важнее capture-флага, и stopImmediatePropagation
// до него уже не дотягивается.
//
// Поэтому убираем саму причину: переносим колбэки наблюдателя на следующий
// кадр, чтобы вызванные ими перерасчёты не попадали в текущую партию.
if (typeof window !== "undefined" && typeof window.ResizeObserver === "function"
    && !window.ResizeObserver.__swPatched) {
  const Native = window.ResizeObserver;

  class PatchedResizeObserver extends Native {
    constructor(callback) {
      super((entries, observer) => {
        window.requestAnimationFrame(() => {
          if (!Array.isArray(entries) || !entries.length) return;
          callback(entries, observer);
        });
      });
    }
  }

  PatchedResizeObserver.__swPatched = true;
  window.ResizeObserver = PatchedResizeObserver;
}
