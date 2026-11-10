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

## Android

BlueGem also runs on Android phones, with an interface built for one hand:

* **Bottom dock** under your thumb: World list, Timeline, a big **+**, Undo and More.
* **Tap** a card to peek at it in a sheet; **swipe the sheet up** to edit, **down** to close.
* **Press and hold** a card, a link or empty canvas for its menu.
* **+ → a node type**: the card appears and opens on its name, ready to type.
* **Pinch** to zoom, drag with one finger to pan, the system **Back** button closes the top sheet.
* **Share** a project as `.bgproj` or Markdown through the system share sheet; open a `.bgproj` from Files or a messenger straight into the app.

Projects on the phone are stored inside the app (no server, no account) and move between devices as `.bgproj` files.

**Install:** open the latest **Android APK** run on the repository's *Actions* tab, download the `BlueGem-android` artifact and open the `.apk` on the phone (allow installing from that source when Android asks).

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
