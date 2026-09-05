<p align="center">
  <img src="docs/assets/logo.png" width="96" height="96" alt="Respo">
</p>

<h1 align="center">Respo</h1>

<p align="center">
  <strong>The open-source responsive design browser.</strong><br>
  One page on every device at once — real Chromium device emulation, per-device DevTools, designer tools.<br>
  A faster, cleaner, free alternative to Responsively, Polypane and Sizzy. MCP for AI coding agents coming in 0.2.
</p>

<p align="center">
  <a href="https://github.com/prodbyEDDY/respo/releases/latest"><img src="https://img.shields.io/github/v/release/prodbyEDDY/respo?label=release&color=0086fc" alt="Latest release"></a>
  <a href="https://github.com/prodbyEDDY/respo/releases"><img src="https://img.shields.io/github/downloads/prodbyEDDY/respo/total?color=0086fc" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-0086fc" alt="MIT license"></a>
  <a href="https://github.com/prodbyEDDY/respo/actions/workflows/ci.yml"><img src="https://github.com/prodbyEDDY/respo/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/platform-Windows-0086fc" alt="Windows">
</p>

<p align="center">
  <a href="https://github.com/prodbyEDDY/respo/releases/latest"><b>⬇ Download for Windows</b></a> ·
  <a href="#install">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#compare">Compare</a> ·
  <a href="#keyboard-shortcuts">Shortcuts</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

![Respo — five devices side by side, light theme](docs/assets/screenshot-light.png)

<details>
<summary>Dark theme</summary>

![Respo — dark theme](docs/assets/screenshot-dark.png)

</details>

## Install

**Windows 10/11 (x64)** — one line in PowerShell downloads the latest installer from GitHub Releases and runs it:

```powershell
irm https://raw.githubusercontent.com/prodbyEDDY/respo/main/scripts/install.ps1 | iex
```

Or grab `Respo-Setup-<version>.exe` from the [latest release](https://github.com/prodbyEDDY/respo/releases/latest).
It installs per user (no administrator rights), and updates itself: Respo checks GitHub Releases once a day and
shows an **Update** chip in the toolbar when a newer version exists — one click downloads it, one more restarts
into it.

> **SmartScreen.** Builds are not code-signed yet, so Windows may show "Windows protected your PC" —
> click **More info → Run anyway**. Every download comes over HTTPS from `github.com/prodbyEDDY/respo` and is
> checked against the release manifest's SHA-512.

**macOS** — planned. **Linux** — not yet.

### Quick start

1. Paste a URL (or `Ctrl+O` to open a local `.html` file) — it opens on the default suite of devices.
2. Scroll, click, type in any device; every other device follows.
3. Pick a suite or add devices in the library, hit **Emulate** for dark mode / slow 3G / Tokyo, `Ctrl+S` for screenshots of all of them.

## Why Respo

- **It does not lag.** Every device is a real Chromium `WebContentsView` — not a `<webview>` tag — driven over the
  Chrome DevTools Protocol from the main process. Input is mirrored per animation frame, load events are batched,
  screenshots are queued. Ten devices mirroring a scroll keep the main process at a p99 of a few milliseconds.
- **It emulates honestly.** Viewport, pixel ratio, touch, user agent *and* User-Agent Client Hints go through CDP,
  the way DevTools does it. A Pixel says `Sec-CH-UA-Platform: Android`; an iPhone exposes no
  `navigator.userAgentData` at all, because Safari does not. Color scheme, vision deficiencies, network
  conditions, geolocation, locale and time zone are emulated where the page runs, not painted over it.
- **It stays out of your way.** One toolbar, one click for the common things, no pop-ups, no release-notes
  dialogs, no feeds. Light and dark themes. No telemetry.

## Features

### 📱 Preview and layouts
- One page in a set of device viewports; scroll, click and typing mirrored across them (mute any device).
- Layouts: **Column**, **Flexible rows**, **Masonry**, **One device**. Canvas zoom 25–200% — zoom never changes
  what the page sees.
- Rotate all devices or one. Per device: reload, reload ignoring cache, scroll to top, copy URL.
- A page that crashes gets a **Restart** overlay on that device only. Pop-ups open from the device you are using,
  in a sandboxed window.

### 🎛 Devices and emulation
- **110 device presets** — iPhone 8 → 17 Pro Max, Pixel 3 → 10 and Fold, Galaxy S8 → S25 and Z Flip/Fold, iPads,
  Surface, MacBooks, monitors up to 4K — plus custom devices with an auto-derived user agent.
- **Suites**: named device sets; reorder, switch, import and export as JSON.
- **Client Hints** (`Sec-CH-UA-*`, `navigator.userAgentData`) derived from each device's user agent.
- **Emulate** panel: `prefers-color-scheme` · `prefers-reduced-motion` · forced colors · print media ·
  vision deficiency simulation (6 types, globally or per device) · network presets (Fast 4G, Slow 4G, 3G, offline) ·
  geolocation by city · locale, time zone and `Accept-Language`.

### 🔍 DevTools and diagnostics
- **DevTools per device**, docked bottom or right, or in its own window.
- **Inspect** (`Ctrl+I`): click anything in any device to open that device's DevTools on the node.
- Per-device chips for **console errors** (click → console) and **horizontal overflow** (lists the culprits,
  hover to highlight).
- Debug ▸ **Outline all elements**, **Rulers on all devices**.

### 📐 Designer tools
- **Rulers and guides** per viewport size, drawn into the page and remembered (`Alt+R`).
- **Design overlay**: a mockup over the page with opacity and a curtain slider, or side by side.

### 📸 Screenshots
- Viewport or full page, one device or all, at the device's pixel ratio or 1×, PNG or JPEG. Copy to clipboard,
  reveal in folder. `Ctrl+S` for all devices, `Ctrl+Alt+S` for full pages.

### ♻️ Live reload
- `file://` pages reload when their files change; CSS edits are hot-swapped without a reload.

### 🌐 Browsing
- Address bar with history suggestions and local favicons, bookmarks, home page, **Open file…**.
- Clear storage, cookies or cache for the current site in one gesture.
- **Per-site permissions** — pages ask, you answer inline, decisions are remembered per site.
- HTTP Basic Auth (one prompt for all devices, nothing stored); opt-in **Allow invalid certificates** for device
  views only.

### 🔒 Privacy and updates
- No telemetry, no analytics, no third-party favicon or update services.
- Device views run sandboxed with context isolation and no Node integration.
- Updates from GitHub Releases: daily check (can be turned off), a toolbar chip, one click to install.

## Compare

Compiled 2026-09-05 from the products' public pages; "—" means unconfirmed. Corrections welcome in an issue.

| | **Respo** | Responsively | Polypane | Sizzy | Blisk |
|---|---|---|---|---|---|
| Price | **Free** | Free | $11/mo | $15/mo | ~$8.49/mo |
| License | **MIT** | AGPL-3.0 | Proprietary | Proprietary | Proprietary |
| Sync scroll / click / typing | ✅ / ✅ / ✅ | ✅ / ✅ / ✅ | ✅ / ✅ / ✅ | ✅ / ✅ / ✅ | ✅ / — / — |
| Device presets | 110 + custom + suites | 30+ + custom | ✅ | ✅ | 89 |
| Media emulation (color scheme, reduced motion, print) | ✅ | ❌ | ✅ | 🟡 | ❌ |
| Vision deficiency simulation | ✅ 6 types, per device | ❌ | ✅ 8 + dyslexia | ❌ | ❌ |
| Network throttling | ✅ | ❌ | ✅ | ✅ | — |
| Geolocation / locale / time zone | ✅ | ❌ | ✅ / ✅ / — | ✅ | ❌ |
| Rulers and guides | ✅ | ❌ | ✅ | ❌ | ❌ |
| Design overlay | ✅ | ❌ | ✅ | 🟡 | ❌ |
| Full-page screenshots | ✅ | — | ✅ | ✅ | ✅ |
| Console errors in the UI | ✅ + overflow finder | ❌ | ✅ | ✅ | ✅ |
| Per-site permissions | ✅ | — | 🟡 | — | — |
| Live reload | ✅ `file://` | ✅ | — | — | ✅ |
| MCP for AI agents | 0.2 | ✅ | ❌ | ❌ | ❌ |
| Auto-update | ✅ | ✅ | ✅ | ✅ | ✅ |
| Platforms | Windows (macOS planned) | Win / Mac / Linux | Win / Mac / Linux | Win / Mac | Win / Mac / Linux |

Polypane and Sizzy are excellent, mature, paid tools with things Respo does not have yet (live CSS editing,
accessibility audits, a unified console, video recording, Polypane's Portal). Respo is the free, MIT-licensed one
that is fast, emulates faithfully, and is built for AI agents next.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+L` | Focus the address bar |
| `Ctrl+D` | Bookmark this page |
| `Ctrl+O` | Open a local file |
| `Ctrl+R` · `Ctrl+Shift+R` | Reload every device · reload ignoring cache |
| `Ctrl+I` · `Esc` | Inspect an element · stop inspecting |
| `Ctrl+S` · `Ctrl+Alt+S` | Screenshot every device · full pages |
| `Ctrl+Shift+L` · `Esc` | Cycle layouts · leave One-device layout |
| `Alt+R` | Rulers on the device under the pointer (or all) |
| `Ctrl+Alt+Q` / `A` / `Z` · `Ctrl+Alt+Backspace` | Clear storage / cookies / cache for this site · all three |
| `Ctrl` + mouse wheel | Zoom the canvas |

Cyrillic keyboard layouts are recognised for the letter chords.

## Roadmap

- **0.1.x** — native menu, `respo://` deep links and a CLI (`respo <url>`), shortcuts help and a command palette,
  welcome screen, crash-safe UI.
- **0.2** — **MCP server**: let Claude Code, Cursor, Codex and other agents open pages, switch devices, take
  screenshots, read console errors and overflow, and drive emulation — locally, no cloud.
- Later — macOS, a unified console across devices, element screenshots, breakpoint detection.

## Development

```bash
npm ci             # Node 20.19+ ; installs Electron
npm run dev        # electron-vite dev mode with HMR
npm run typecheck  # main + renderer
npm run lint
npm test           # Vitest unit tests
npm run e2e        # Playwright driving the real Electron app
npm run build:win  # NSIS installer into dist/
```

Electron · `WebContentsView` per device · CDP via `webContents.debugger` · React 19 · TypeScript strict ·
Zustand · shadcn/ui · Tailwind v4 · electron-vite · electron-builder. Ground rules in
[`CONTRIBUTING.md`](CONTRIBUTING.md); architecture notes in [`docs/`](docs/README.md) (in Russian).

## License

Respo is [MIT licensed](LICENSE). Third-party notices — the Chromium DevTools device list (BSD-3-Clause), the
Inter typeface (OFL-1.1) and the bundled npm packages — are in [`NOTICE.md`](NOTICE.md).

Responsively App is the functional reference Respo set out to beat; no code or data from it is used.
