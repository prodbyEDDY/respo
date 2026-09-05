# Changelog

All notable changes to Respo are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

Release notes on GitHub are generated from this file (`scripts/release-notes.mjs`).

## [Unreleased]

## [0.1.1] - 2026-09-05

### Fixed

- Retained the latest canvas geometry when it arrives before native device creation, preventing loaded previews from remaining invisible until the next resize or scroll.
- Menus, nested dropdowns, selections, tooltips and dialogs now display above native device previews and docked DevTools. Visible previews are briefly represented by stills while floating UI is open; closing restores the live surfaces without reloading pages.
- Fixed custom typography tokens being silently removed by class merging when a text color was also set.
- Kept native device views out of the canvas scrollbar gutter, so the scrollbar remains accessible.
- Prevented focus restoration after Escape from reopening a tooltip and holding the native surfaces hidden.
- Bounded popovers and dialogs to the window with internal scrolling, including the minimum 720×480 window.
- Release packaging uploads the installer, update manifest and blockmap to a single draft before publishing, avoiding duplicate drafts and missing differential-update assets.

### Changed

- Thin themed shell scrollbars, consistent 20px toolbar and 16px device-action icons, and a larger screenshot-options target.
- Two-line device captions with truncated names and adaptive quick actions; device actions remain available from the menu at small canvas zoom.
- Theme and rotation actions remain available through the main menu in compact windows. Motion respects the system reduced-motion preference.
- New R monogram selected by the maintainer, regenerated Windows/macOS icon formats, and three editable vector concepts.
- Refreshed README with real compositor screenshots, a responsive demo and a reproducible capture script. Removed the dated competitor comparison and redundant marketing claims.

## [0.1.0] - 2026-09-05

The first public release: everything built in waves W1–W6.

### Added

**Preview and layouts**

- One page in a set of device viewports at once, each a real Chromium `WebContentsView`
  driven over the Chrome DevTools Protocol.
- Layouts: Column, Flexible rows, Masonry and One device (`Ctrl+Shift+L` cycles them).
- Canvas zoom 25–200% (`Ctrl` + mouse wheel, or the menu); zoom never changes what the
  page sees, media queries stay honest.
- Rotate all devices or one; per-device reload, reload ignoring cache, scroll to top and
  copy URL from the device's ⋯ menu.
- A crashed page shows an overlay with **Restart** on that device only; the others keep
  running.
- Pop-ups open only from the device you are interacting with, in a sandboxed window.

**Devices, suites and emulation**

- 110 device presets (phones, foldables, tablets, laptops, monitors — 2014 to 2026),
  custom devices with an automatically derived user agent, and suites of up to 20
  devices you can reorder and switch between. Import/export as JSON.
- Faithful device emulation: viewport, device pixel ratio, touch, user agent and
  User-Agent Client Hints (`Sec-CH-UA-*`, `navigator.userAgentData`); Safari devices
  correctly expose no Client Hints.
- **Emulate** panel: `prefers-color-scheme`, `prefers-reduced-motion`, print media;
  vision deficiency simulation (achromatopsia, deuteranopia, protanopia, tritanopia,
  blurred vision, reduced contrast) globally or per device; network presets (Fast 4G,
  Slow 4G, 3G, offline); geolocation by city, locale, time zone and `Accept-Language`.

**Sync**

- Scroll, click and typing mirrored across every device through CDP input events — the
  device under your pointer leads. Global switch in the toolbar, per-device mute.

**DevTools and diagnostics**

- DevTools per device, docked at the bottom or right or in its own window; the dock
  edge and size are remembered.
- Inspect element (`Ctrl+I`): click anything in any device to open that device's
  DevTools on the node. Context menu on a device: Inspect, Console, Reload, Copy URL.
- Per-device chips for console errors (click opens the console) and horizontal
  overflow (lists the culprits, hover to highlight, "Highlight all").
- Debug ▸ Outline all elements.

**Designer tools**

- Rulers with draggable guides per viewport size, drawn into the page and remembered
  (`Alt+R`).
- Design overlay: drop a mockup over the page with opacity and a curtain slider, or view
  it side by side.

**Screenshots**

- Viewport or full-page screenshots of one device or all of them, through a queue
  (three at a time), at the device's pixel ratio or 1×, PNG or JPEG; copy to clipboard,
  reveal in folder. `Ctrl+S` for all devices, hold `Alt` for full pages.

**Live reload**

- Local `file://` pages reload when their files change; CSS edits are hot-swapped
  without a reload.

**Address bar and browsing**

- History with suggestions (local favicons, no third-party services), bookmarks, a home
  page, Open file… (`Ctrl+O`), clear storage / cookies / cache for the current site
  (`Ctrl+Alt+Q` / `A` / `Z`, `Ctrl+Alt+Backspace` for all).
- Per-site permissions: pages ask, you answer inline; decisions are remembered per site
  and editable from the shield panel.
- HTTP Basic Auth prompts (one dialog for all devices; passwords are never stored) and
  an opt-in **Allow invalid certificates** switch for device views only.

**App**

- Light and dark themes, system-aware.
- Automatic updates from GitHub Releases: a daily check on launch (can be turned off),
  a chip in the toolbar when a newer version exists, one click to download, one more to
  restart into it — a downloaded update also installs when you quit. No pop-ups.
- About dialog with versions, updater status, links, logs folder and third-party
  notices. A file log in the profile's `logs` folder.
- Windows installer (NSIS, one click). Builds are not code-signed yet — see the README
  for the SmartScreen note.

### Security

- Device views run sandboxed with context isolation and no Node integration; the UI
  window too.
- Every URL Respo is asked to load is validated (http, https, file only). Every IPC
  payload is validated in the main process.
- Permissions default to "ask"; nothing is granted silently.
- No telemetry, no analytics, no external favicon or update services beyond GitHub
  Releases.

[Unreleased]: https://github.com/prodbyEDDY/respo/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/prodbyEDDY/respo/releases/tag/v0.1.0
