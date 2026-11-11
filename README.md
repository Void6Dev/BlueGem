# BlueGem

BlueGem is an offline visual worldbuilding tool for writers, game developers, and storytellers. Build complex worlds by connecting **characters, factions, locations, events, organizations, and ideas** on an infinite canvas.

Everything runs locally on your computer—no cloud, no accounts, no Internet connection required.

## Features

* Infinite visual graph editor
* Multiple canvases per project
* Rich node editor with Markdown support
* Wiki-style links (`[[Node Name]]`)
* Timeline generated from node dates
* Powerful search and Command Palette
* Automatic project saving
* Import and export projects
* Completely offline
* SQLite-based local storage

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

**Build it yourself** on Linux (Node 20+, Python 3.10+):

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
npm install
cd frontend && yarn install && cd ..
npm run dist:linux        # → release/*.AppImage and release/*.deb
```

The Linux build has to run on Linux: the embedded server is frozen with PyInstaller, which only builds for the system it runs on. The **Linux** GitHub workflow builds both files on every tagged version.

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

## Building from Source

Requirements:

* Node.js 18+
* Python 3.11+

```bash
npm install
npm run dev
```

Create a release build:

```bash
npm run dist
```

## License

See the LICENSE file for licensing information.
