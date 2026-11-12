//! Ядро BlueGem: проекты, узлы, связи, картинки, резервные копии над SQLite и
//! их HTTP API. Одно и то же ядро работает в двух местах:
//!
//! * на компьютере — отдельным процессом-сервером (src/main.rs), который
//!   запускает Electron;
//! * на телефоне — библиотекой внутри приложения (src/android.rs): запросы
//!   приходят из интерфейса через плагин Capacitor, без сети и без портов.
//!
//! Раньше у телефона было своё хранилище на IndexedDB с той же логикой,
//! написанной второй раз на JavaScript; теперь логика одна.
pub mod catalog;
pub mod error;
pub mod routes;
pub mod store;

#[cfg(target_os = "android")]
mod android;

use std::io::Write;

/// Строка в лог (stdout). Никогда не падает — это всего лишь лог.
pub fn emit(line: &str) {
    let mut out = std::io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}
