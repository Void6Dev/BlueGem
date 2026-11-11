// Должен быть первым: вешает обработчик до dev-оверлея.
import "@/lib/quietResizeObserver";
// Локальные шрифты — до собственных стилей, чтобы те могли их переопределить.
import "@/fonts";
import React from "react";
import ReactDOM from "react-dom/client";
// React Flow first — our own sheet must be able to override it.
import "@xyflow/react/dist/style.css";
import "@/index.css";
// Телефон: шторки, нижняя панель, отступы от вырезов. После index.css —
// правила для узкого экрана должны перекрывать десктопные.
import "@/mobile.css";
import App from "@/App";
import { applyStoredAppearance } from "@/lib/settings";
import { initNative } from "@/lib/platform";

// Paint with the remembered theme/accent before React mounts — no white flash.
applyStoredAppearance();

// React Query здесь когда-то стоял провайдером — и ни одного запроса через
// него не шло: данные ходят через lib/api. Провайдер тянул в сборку всю
// библиотеку ради нуля вызовов.
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
// Android: кнопка «назад», клавиатура и заставка — сразу, не дожидаясь
// роутера. Заставка уходит, как только нарисован первый кадр; если что-то
// сломается раньше, её через пару секунд уберёт сама оболочка.
initNative();
