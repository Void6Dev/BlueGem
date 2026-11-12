// Среда для тестов хранилища в приложении: Node, но с теми веб-объектами,
// которые есть в любом WebView и нужны IndexedDB (fake-indexeddb), — Jest 27
// из react-scripts пускает в песочницу только малую часть глобальных объектов.
const NodeEnvironment = require("jest-environment-node");

class NodeWebEnvironment extends NodeEnvironment {
  async setup() {
    await super.setup();
    const g = this.global;
    for (const name of [
      "structuredClone", "DOMException", "Blob", "atob", "btoa", "TextEncoder", "TextDecoder",
      "fetch", "Headers", "Request", "Response", "URL", "URLSearchParams", "AbortController",
    ]) {
      if (typeof g[name] === "undefined" && typeof globalThis[name] !== "undefined") g[name] = globalThis[name];
    }
    if (typeof g.crypto === "undefined") g.crypto = require("crypto").webcrypto;
  }
}

module.exports = NodeWebEnvironment;
