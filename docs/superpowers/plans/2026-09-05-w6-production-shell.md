# W6 «Production Shell + Release 0.1.0» — план реализации

> **Исполнитель:** один агент Fable 5.1 (вторая длинная сессия), ветка `w6-shell`, worktree
> `C:\CODING\My Coding Projects\Respo-W6`. База — `main` **после** приёмки W5 (перед стартом:
> `git merge main`). Режим — как в W5: последовательные задачи, коммит после каждой, лог
> `docs/progress/W6-log.md`, механические подзадачи — субагентам на дешёвых моделях, ревью — Opus.
> **Все Agent-вызовы и Bash-команды — только в foreground** (`run_in_background: false`): сессия,
> ушедшая «ждать» фоновые задачи, обрывается.

**Goal.** Две фазы в одной сессии. **Фаза A «Release 0.1.0»** — Respo становится публичным
open-source продуктом: иконка, автообновление с кнопкой **Update** в шапке, лицензия MIT, README
уровня «страница продукта», CI и release-workflow, сборка инсталлятора и **публикация v0.1.0 в
GitHub Releases**. **Фаза B «Shell»** — меню/About/окно/deep-link/CLI, реестр хоткеев + справка +
палитра, устойчивость, welcome и полировка, перф-гейт. Фаза B релизится как 0.1.x; MCP (W7) — 0.2.0.

**Решения владельца (2026-09-05):** проект open source и бесплатный; лицензия **MIT**; репозиторий
`github.com/prodbyEDDY/respo` **сделать публичным** перед публикацией релиза; обновления — GitHub
Releases; проверка обновлений **раз в день при первом запуске** (+ вручную); при наличии — **видимая
кнопка «Update» в шапке**; клик — всё скачивается и устанавливается само, пользователю остаётся
перезапустить; никаких попапов.

**Источники:** [research/2026-09-05-spec-vs-code.md](../../research/2026-09-05-spec-vs-code.md) §B ·
[research/2026-09-05-competitors.md](../../research/2026-09-05-competitors.md) (сравнение для README) ·
[design/DESIGN-SYSTEM.md](../../design/DESIGN-SYSTEM.md) · спека §5.9, §7, §7a, §8, §10.

## Глобальные ограничения
Те же, что в W5 (CLAUDE.md: лицензии MIT/Apache/BSD/ISC, WebContentsView/CDP, батчи, §7a, IPC-хаб
с валидацией, Zustand, UI по-английски, UX без перегруза). Новые зависимости волны (все MIT):
`electron-updater`, `electron-log`; devDependencies для иконок: `sharp` (Apache-2.0), `png-to-ico` (MIT).
**Никаких токенов в приложении.** Перед переключением репозитория в public — скан истории на секреты.

---

## Фаза A — Release 0.1.0

### Task A1: Иконка приложения
`build/icon.{png,ico,icns}` и `resources/icon.png` — дефолтный логотип Electron. Нарисовать знак Respo
(SVG, палитра дизайн-системы: link-blue `#0086fc` + ink/cream; идея — три ступенчатых вьюпорта или «R»
из рамок; читаемо в 16 px, без текста), `build/icon.svg` → скрипт `scripts/icons.mjs` (sharp) →
`build/icon.png` 1024², `build/icon.ico` (16…256), `resources/icon.png`, `build/installerIcon.ico`,
`build/uninstallerIcon.ico`; `.icns` — доверить electron-builder или сгенерировать. `BrowserWindow.icon`,
знак в About и в welcome. Проверить в taskbar/alt-tab/инсталляторе.
**DoD:** нигде не осталось логотипа Electron.

### Task A2: Автообновление + кнопка Update + About + логирование
**Files:** `src/main/updater.ts`, `src/main/log.ts`, `src/shared/ipc.ts` (`updates:check`, `updates:download`,
`updates:install`, `updates:get`, событие `updates` в `MainEvent`), persistence-слайс `updates`
(`lastCheckAt`, `autoCheck: true`), renderer `stores/updates.ts`, `components/toolbar/UpdateChip.tsx`,
`components/AboutDialog.tsx`, Settings → General/Updates.
**Поведение:** `electron-updater` (provider GitHub `prodbyEDDY/respo`, канал latest, `autoDownload: false`,
`autoInstallOnAppQuit: true`); при старте, если `now − lastCheckAt ≥ 24 ч` (или никогда) — проверка через
10 с после ready; «Check for updates» в About/Settings и в меню. Выключено в dev/e2e (`RESPO_NO_UPDATER=1`,
`is.dev`). **Чип в топ-баре** (справа от адресной строки, mint-акцент, только когда есть что сказать):
`Update to 0.1.1` → клик → скачивание с процентом в том же чипе → `Restart to update` → клик →
`quitAndInstall()` (NSIS oneClick ставит молча, приложение перезапускается само; если перезапуск не
удался — пользователь запускает вручную, установка уже прошла). Ошибки — тихо в лог + tooltip чипа
«Update failed — retry». Никаких модалок.
`electron-log`: файл в `userData/logs` с ротацией, main `uncaughtException`/`unhandledRejection` → лог,
renderer `console.error` в проде → лог батчем; «Open logs folder» в About. **About:** версия, Electron/
Chromium/Node, статус апдейтера + Check now, ссылки (GitHub, Issues, Changelog), Third-party notices.
**Проверка:** юниты на state-машину апдейтера (fake autoUpdater); e2e на весь путь чипа с локальным
mock-сервером обновлений (`generic`-провайдер electron-updater на `127.0.0.1`, `dev-app-update.yml`);
после публикации (A5) — проверка на реальном GitHub-релизе (см. A5 п.5).
**DoD:** сценарий «есть релиз новее → чип → клик → скачалось → Restart → новая версия» пройден фактически.

### Task A3: Лицензия, README, CHANGELOG, NOTICE, шаблоны репозитория
- `LICENSE` — MIT, `Copyright (c) 2026 prodbyEDDY`; `package.json`: `"license": "MIT"` (`private: true`
  оставить — в npm не публикуем), `description`, `keywords`, `bugs`, `homepage`.
- `README.md` (English, продуктовая страница; docs/ остаются на русском). Структура: hero (знак + tagline,
  например **«Respo — the open-source responsive design browser. A faster, cleaner Responsively
  alternative: one page on every device at once, real device emulation, per-device DevTools, and an
  MCP server for AI coding agents (coming in 0.2).»** — MCP упоминать честно как next), бейджи (release,
  downloads, license MIT, CI), 2–3 скриншота/GIF (light + dark; снимать через `BrowserWindow.capturePage`
  или OS-скриншот из Playwright-сессии — `page.screenshot` не видит WebContentsView), **Why Respo**
  (перф: WebContentsView + CDP, батчи; честная эмуляция; UX), **Features** (сгруппировано: Preview &
  layouts · Emulation (devices 110+, Client Hints, color scheme/motion/forced colors/print, vision
  simulation, network, geo/locale/timezone) · Sync · DevTools & diagnostics (errors, overflow finder) ·
  Designer tools (rulers/guides, design overlay, outline) · Screenshots · Live reload · Privacy
  (no telemetry, no external favicon services)), **Compare** — таблица Respo / Responsively (free, AGPL) /
  Polypane ($11/mo) / Sizzy ($15/mo) / Blisk по 10–12 строкам из research (только подтверждённые факты,
  без выдуманного), **Install** (Windows installer из Releases; SmartScreen: сборка не подписана —
  «More info → Run anyway»; macOS — soon), **Keyboard shortcuts** (таблица), **Roadmap** (MCP for AI
  agents — 0.2, macOS, command palette…), **Development** (команды из CLAUDE.md), **License** MIT +
  третьи стороны (NOTICE), благодарности источникам данных (Chromium DevTools device list).
- `CHANGELOG.md` (Keep a Changelog): `0.1.0 — 2026-09-XX` — сводка W1–W6 по группам.
- `NOTICE.md` — дополнить (шрифт Inter — OFL через `@fontsource/inter`, проверить).
- `.github/ISSUE_TEMPLATE/bug_report.md`, `feature_request.md`, `PULL_REQUEST_TEMPLATE.md`,
  `CONTRIBUTING.md` (коротко: setup, тесты, правила из CLAUDE.md), `SECURITY.md` (как сообщать).
**DoD:** README читается как страница продукта; все факты о конкурентах — из research с датой.

### Task A4: Сборка, CI, release-workflow
- `electron-builder.yml`: `publish: {provider: github, owner: prodbyEDDY, repo: respo}` (убрать
  `example.com`), `nsis`: `oneClick: true`, `perMachine: false`, `installerIcon`/`uninstallerIcon`,
  `artifactName: Respo-Setup-${version}.${ext}`, `deleteAppDataOnUninstall: false`; `win.target: nsis`
  (+ `portable`, если дёшево); linux-таргеты убрать; mac оставить на будущее. `npm run build:win` локально →
  `dist/Respo-Setup-0.1.0.exe` + `latest.yml`; инсталлятор ставится, запускается, иконка на месте.
- `.github/workflows/ci.yml`: на push/PR в `main` — windows-latest: `npm ci`, typecheck, lint, unit, e2e
  (артефакт playwright-report при падении), `build:unpack`.
- `.github/workflows/release.yml`: на тег `v*` — windows-latest: `npm ci`, typecheck, unit, `electron-builder
  --win --publish always` с `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` → релиз с `Respo-Setup-x.y.z.exe`,
  `.blockmap`, `latest.yml`; тело релиза — из CHANGELOG (скрипт `scripts/release-notes.mjs`).
**DoD:** CI зелёный на ветке; workflow релиза проверен реальным тегом (A5).

### Task A5: Публикация v0.1.0
1. Скан истории на секреты (`git log -p | grep -iE "token|secret|api[_-]?key|password"` + проверка
   `.gitignore` на `.env`, `dev-app-update.yml`); убедиться, что в истории нет чужого кода/данных
   (responsively-app) — только ссылки-запреты.
2. `git merge main` в `w6-shell` (W5 уже в main), все гейты зелёные, ветка сдана координатору на ревью
   **до** публикации (короткий цикл: ревью Opus-субагентом + фиксы). Мерж в `main` — координатор;
   после мержа исполнитель продолжает:
3. `gh repo edit prodbyEDDY/respo --visibility public --description "<tagline>"` + topics
   (`responsive-design, electron, devtools, web-development, browser, chromium, screenshots,
   device-emulation, mcp, ai-agents`), включить Issues/Discussions.
4. Тег `v0.1.0` на `main`, push → release-workflow → релиз с ассетами; проверить, что `latest.yml` и
   `.exe` в релизе, скачать инсталлятор из релиза, поставить, запустить.
5. Проверка автообновления с реального релиза: в ветке поднять версию до `0.1.1-test.1`, опубликовать
   как **pre-release** с `latest.yml` только если канал этого не подхватит; безопаснее — временный
   черновик-релиз в тестовом репозитории или `generic`-сервер с уже собранными ассетами. Выбрать
   способ, который не покажет пользователям мусорную версию; записать в лог.
**DoD:** https://github.com/prodbyEDDY/respo/releases/tag/v0.1.0 существует с инсталлятором; репозиторий
публичный с описанием/топиками/README; свежая установка видит «up to date».

---

## Фаза B — Shell (после A5, версия 0.1.x)

### Task B1: Нативное меню, окно, single instance, deep link, CLI
`src/main/menu.ts` (File: Open URL…, Open File…, Screenshot all, Settings, Quit · Edit: роли · View:
Layout ▸, Zoom in/out/reset, Rotate all, Rulers, Theme, DevTools dock ▸, Reload, Reload ignoring cache ·
Help: Keyboard shortcuts, Documentation, Report an issue, Check for updates, About; macOS-ready шаблон;
`autoHideMenuBar: true` оставить), `src/main/window-state.ts` (bounds/maximized persist, проверка дисплея),
`requestSingleInstanceLock` + `second-instance` → фокус + URL из argv, `setAsDefaultProtocolClient('respo')`,
`respo://open?url=…`, `respo <url|file>`, `?urlToOpen=` — одна функция валидации (http/https/file).
**DoD:** e2e: второй запуск с URL уходит в первое окно; `respo://open?url=javascript:` отбрасывается;
окно восстанавливает геометрию.

### Task B2: Реестр хоткеев + справка + командная палитра
`src/shared/hotkeys.ts` — единственный источник правды (id, label, combo Win/mac, scope) → хуки renderer,
акселераторы меню, подписи в tooltips/`DropdownMenuShortcut`, диалог справки, палитра. Добавить: Back/
Forward (`Alt+←/→`), Reload (`Mod+R`, `F5` — `Mod+R`/`Mod+Shift+R` уже есть из W5, свести в реестр), Theme
(`Mod+Shift+T`), Zoom (`Mod+=`/`Mod+-`/`Mod+0`), Rotate all (`Mod+Shift+.`), Emulate (`Mod+E`), Shortcuts
(`Mod+/`), Command palette (`Mod+K`), Settings (`Mod+,`); кириллические дубли — как сейчас. `tinykeys`
(MIT) — использовать, если упрощает; спеку §3 привести к факту. `ShortcutsDialog.tsx` (группы, поиск),
`CommandPalette.tsx` (все действия + устройства/сьюты/закладки, fuzzy, подписи хоткеев).
**DoD:** все хоткеи из реестра работают; tooltip каждой кнопки тулбара показывает хоткей; e2e
`hotkeys.spec.ts` на 5 ключевых; юнит: нет дублей комбо в scope.

### Task B3: Устойчивость
`ErrorBoundary.tsx` («Something went wrong» + Reload UI + Copy details, в лог), UI-окно
`render-process-gone`/`unresponsive` → пересоздание, валидация persistence с `.bak` при миграции (проверить).

### Task B4: Welcome и полировка UX
Welcome/empty state (адрес пуст → знак, «Enter a URL or open a file», Open file…, 3 последних URL);
Settings по секциям: General (home page, theme, Accept-Language — если ещё не в Emulate), Screenshots,
Security (insecure certs + янтарный чип «Insecure certs ON» в топ-баре, пока включено), Updates, About;
аудит tooltips/`focus-visible`/tab-порядка/aria-label/dark-темы/минимального размера 1024×700/
`prefers-reduced-motion`; единый тихий toast-слой для Notice/ShotNotice.
**DoD:** чек-лист в отчёте со скриншотами обеих тем.

### Task B5: Перф-гейт §8 в CI
`e2e/perf-budget.spec.ts` из W5 — стабилизировать 5/5 локально; в CI — soft (аннотация) из-за шумных раннеров.

### Task B6 (опционально, по остатку): Page info (title/description/OG/Twitter-карточка), element screenshot
из inspect-режима, contact sheet «all devices → one image», breakpoints → devices.

### Task B7: Документация, ревью, отчёт, 0.1.1
Спека (§5.9, §10 факт), `docs/modules/*` для новых модулей (updater, menu, window-state, hotkeys),
`CLAUDE.md` (команды, грабли), ревью Opus + фиксы, отчёт `docs/progress/W6-production-shell-2026-09-XX.md`
с черновиком записей ROADMAP; после приёмки координатором — тег `v0.1.1` (release-workflow).

## DoD волны
Фаза A: релиз v0.1.0 опубликован, репозиторий публичный и оформлен, автообновление проверено на реальном
релизе. Фаза B: меню/хоткеи/палитра/welcome/устойчивость, CI зелёный, отчёт со скриншотами, v0.1.1.
