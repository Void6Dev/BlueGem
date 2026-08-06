const path = require("path");

// Maps the "@/..." import alias used across the app to the src/ folder.
module.exports = {
  webpack: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  devServer: {
    client: {
      overlay: {
        errors: true,
        warnings: false,
        // Подстраховка к патчу в src/lib/quietResizeObserver.js: даже если
        // браузер всё-таки сообщит про цикл ResizeObserver, оверлей не полезет
        // на весь экран. Все остальные ошибки показываются как обычно.
        runtimeErrors: (error) => !/^ResizeObserver loop/.test((error && error.message) || ""),
      },
    },
  },
};
