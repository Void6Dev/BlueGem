# BlueGem

BlueGem is an offline visual worldbuilding tool for writers, game developers, and storytellers. Build complex worlds by connecting **characters, factions, locations, events, organizations, and ideas** on an infinite canvas.

Everything runs locally on your computer—no cloud, no accounts, no Internet connection required.

## Features

* Infinite visual graph editor
* Multiple canvases per project
* Rich node editor with Markdown support
* Wiki-style links (`[[Node Name]]`, `[[Node Name|shown text]]`) with backlinks ("Mentioned in")
* Timeline generated from node dates
* Command Palette that searches titles, descriptions and fields
* Your own node templates
* Automatic project saving and automatic backups
* Sync between devices through any cloud folder
* Import and export projects: `.bgproj`, Markdown, an HTML/PDF world book, PNG/SVG of a canvas
* Completely offline
* SQLite-based local storage, served by a small embedded server written in Rust

## Installation

Download one of the files from the latest release.

| File                     | Description                                                     |
| ------------------------ | --------------------------------------------------------------- |
| **BlueGem-Setup.exe**    | Standard installer with desktop shortcut and file associations. |
| **BlueGem-Portable.exe** | Portable version that stores all data beside the executable.    |

Launch the application—everything starts automatically.

## Linux

| File                              | Description                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- |
| **BlueGem-x.y.z-x86_64.AppImage** | Single file, runs on any modern distribution, updates itself from the app. |
| **BlueGem-x.y.z-amd64.deb**       | Package for Ubuntu, Debian, Mint: menu entry and `.bgproj` association.    |

**AppImage:** make it executable and run it:

```bash
chmod +x BlueGem-*.AppImage
./BlueGem-*.AppImage
```

Some distributions (Ubuntu 22.04+) need FUSE 2 for AppImages: `sudo apt install libfuse2`.

**deb:** `sudo apt install ./BlueGem-*.deb`, then start BlueGem from the application menu. Updates: download the new `.deb` and install it the same way (the app opens the release page for you).

Data lives in `~/.config/BlueGem`.

**Build it yourself** on Linux (Node 20+, Rust — https://rustup.rs):

```bash
npm install
cd frontend && yarn install && cd ..
npm run dist:linux        # → release/*.AppImage and release/*.deb
```

The Linux build has to run on Linux: the embedded server (Rust, `server/`) is compiled for the system the build runs on. The **Linux** GitHub workflow builds both files on every tagged version.

## Android

BlueGem also runs on Android phones, with an interface built for one hand:

* **Bottom dock** under your thumb: World list, Timeline, a big **+**, Undo and More.
* **Tap** a card to peek at it in a sheet; **swipe the sheet up** to edit, **down** to close.
* **Press and hold** a card, a link or empty canvas for its menu.
* **+ → a node type**: the card appears and opens on its name, ready to type.
* **Pinch** to zoom, drag with one finger to pan, the system **Back** button closes the top sheet.
* **Share** a project as `.bgproj` or Markdown through the system share sheet; open a `.bgproj` from Files or a messenger straight into the app.

Projects on the phone are stored inside the app (no server, no account) and move between devices as `.bgproj` files.

**Install:** on the phone, open **[BlueGem.apk](https://github.com/Void6Dev/BlueGem/releases/download/android/BlueGem.apk)** and tap the downloaded file (allow installing from that source when Android asks). The link always points to the latest build; newer builds install over the old one and keep your projects. The same file is attached to the [BlueGem for Android](https://github.com/Void6Dev/BlueGem/releases/tag/android) release, which the desktop app ignores when it checks for updates.

**Build it yourself** (Node 20+, JDK 21, Android SDK):

```bash
cd frontend && yarn install && cd ..
npm run android:apk    # → frontend/android/app/build/outputs/apk/debug/app-debug.apk
npm run android        # or open the project in Android Studio
```

## Data

BlueGem stores all projects locally on your computer.

* Installed version: `%APPDATA%\BlueGem`
* Portable version: `BlueGem-Data` next to the executable
* Linux: `~/.config/BlueGem`

Your data is never uploaded or shared.

### Backups

Every project is backed up automatically before a change, at most once every 10 minutes. The last 12 backups are kept, plus one per day for a month. **Settings → Backups** lists them: make one now or go back to any of them. A restore backs up the current state first, so it can be undone too.

### Sync between devices

BlueGem has no cloud of its own and needs no account. On a computer, click **Sync** on the projects screen and choose a folder inside Google Drive, Dropbox, OneDrive or Syncthing — the same folder on every computer. Each project is kept there as a `.bgproj` file and merged with changes from other devices: the latest edit of every node and link wins, and deleted things stay deleted.

On a phone, open a project file from that folder (through the drive app): if the project is already on the phone, it is merged rather than duplicated. To send phone edits back, share the project into the same folder.

## Keyboard Shortcuts

| Action          | Shortcut     |
| --------------- | ------------ |
| Command Palette | **Ctrl + K** |
| Search          | **Ctrl + F** |
| New Project     | **Ctrl + N** |
| Open Project    | **Ctrl + O** |
| New Note        | **N**        |
| Save            | **Ctrl + S** |
| Undo            | **Ctrl + Z** |
| Auto Layout     | **L**        |
| Fit to Screen   | **F**        |
| Show Shortcuts  | **?**        |

## Projects

Projects are saved as **.bgproj** files.

BlueGem can also import projects created with older versions (`.swproj` and `.json`).

## Export

Projects can be exported as:

* **.bgproj** — complete project backup
* **Markdown** — structured world documentation
* **World book (HTML or PDF)** — a self-contained document: contents by type, images, dates, fields, links and backlinks
* **Canvas image (PNG or SVG)** — every card of the current canvas

## Building from Source

Requirements:

* Node.js 20+
* Rust (stable, https://rustup.rs) — the embedded server in `server/` is written in Rust; `npm run dev` and `npm run dist` build it themselves

```bash
npm install
npm run dev
```

Create a release build:

```bash
npm run dist
```

## Tests

```bash
# Embedded server (Rust): its own tests, then the API over HTTP —
# including opening a database created by BlueGem 1.5.0
cd server && cargo test --release && cargo build --release && cd ..
pip install -r server/api_tests/requirements.txt
python -m pytest server/api_tests

# Interface: sync merge, search, backlinks, backups, phone storage
cd frontend && yarn test --watchAll=false

# End to end, in a real browser (needs `yarn build` in frontend and the server built first)
cd e2e && npm ci && npx playwright install chromium && npx playwright test
```

All three run on every push (`.github/workflows/tests.yml`).

## License

See the LICENSE file for licensing information.
