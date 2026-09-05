# Contributing to Respo

Thanks for taking the time to contribute. Respo is a desktop app for responsive web
development — one page rendered across a set of device viewports at once, with real
Chromium device emulation via CDP, per-device DevTools, screenshots, and designer tools.

**Scope:** Windows is the supported platform today. macOS support is planned but not yet
in place — please don't open PRs targeting macOS-specific packaging or behaviour until
that lands.

## Prerequisites

- Node.js >= 20.19 and npm
- Windows 10 or 11
- Git

## Setup

```bash
npm ci
npm run dev
```

`npm ci` installs exact dependency versions from the lockfile. `npm run dev` starts the
app in development mode (electron-vite).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app in development mode |
| `npm run typecheck` | Type-check main and renderer (TypeScript, no emit) |
| `npm run lint` | Run ESLint |
| `npm test` | Run unit tests (Vitest) |
| `npm run e2e` | Run end-to-end tests (Playwright, drives the real Electron app) |
| `npm run build:win` | Build the Windows installer |
| `npm run icons` | Regenerate app icons from `build/icon.svg` |

## Project layout

```
src/main/      Electron main process — ViewManager, CDPController, SyncEngine,
               updater, persistence
src/preload/   Two sandboxed preload scripts
src/renderer/  React 19 UI — Zustand, shadcn/ui, Tailwind
src/shared/    Typed IPC hub (src/shared/ipc.ts), persistence schema, device catalog
e2e/           Playwright specs
docs/          Design docs, roadmap, and per-wave reports (written in Russian)
```

## Ground rules

These are hard rules, not preferences. PRs that don't follow them will be asked to
change before review continues.

1. **Dependency licenses:** MIT, Apache-2.0, BSD, or ISC only. GPL/AGPL is forbidden.
   Nothing is copied from responsively-app (AGPL) — it's a functional reference only,
   never a source of code or data.
2. **Device pages live only in `WebContentsView`.** No `<webview>` tag, no `BrowserView`,
   anywhere in the codebase.
3. **Everything "browser-ish" goes through CDP.** Device emulation, screenshots,
   inspection, and input mirroring are implemented via the Chrome DevTools Protocol on
   `webContents.debugger` — not injected scripts, not local servers.
4. **IPC is typed and centralized.** Every IPC channel and payload type lives in
   `src/shared/ipc.ts`, and every payload is validated on arrival in main. No channels
   that bypass this module.
5. **State is Zustand, persisted through IPC.** The renderer never writes to disk
   directly; persistence goes through IPC into `electron-store` in main.
6. **Performance is an invariant, not a later optimization.** No per-event IPC streams
   (coalesce on `requestAnimationFrame`), load events are batched, screenshots go
   through a queue.
7. **Security.** Device views run with `sandbox: true`, `contextIsolation: true`,
   `nodeIntegration: false`. URLs from the CLI, deep links, or drag-and-drop are
   validated (`http`, `https`, `file` only). Permissions default to "ask".
8. **Language.** UI text and code identifiers are in English. (Project docs in `docs/`
   are in Russian — see below.)
9. **Keep the UX minimal.** One click, no clutter, no popups or notification feeds.

## Testing expectations

- Unit tests live next to the code they cover, in `__tests__` directories.
- End-to-end tests (Playwright) cover behaviour that crosses the IPC boundary between
  main and renderer.
- While working, run the focused suite relevant to what you're changing. Run the full
  suite (`npm run typecheck`, `npm run lint`, `npm test`, `npm run e2e`) before pushing.

## Commits and PRs

- Small, atomic commits with meaningful messages.
- Open PRs against `main`.
- Describe how the change was verified (commands run, manual checks) in the PR
  description — the PR template has a checklist for this.
- If your change alters behaviour, update the matching document under `docs/` (and
  `docs/ROADMAP.md` where relevant) in the same PR. Docs there are written in Russian.

## Where to look first

- [`CLAUDE.md`](CLAUDE.md) — project facts and hard rules, read by any Claude Code
  instance working on this repo.
- [`docs/README.md`](docs/README.md) — map of the documentation library.
