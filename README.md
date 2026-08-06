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
