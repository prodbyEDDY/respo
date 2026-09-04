# W6 «Production Shell» — план реализации

> **Исполнитель:** один агент Fable 5.1 (вторая длинная сессия), ветка `w6-shell` от `main` после
> приёмки W5. Режим — как в W5: последовательные задачи, коммит после каждой, лог `docs/progress/W6-log.md`,
> механические подзадачи — субагентам на дешёвых моделях. **Черновик:** уточняется координатором
> после приёмки W5 (список хоткеев, e2e-покрытие, follow-ups W5).

**Goal:** превратить функционально полный Respo в устанавливаемый, обновляемый, самодокументируемый
продукт: брендинг, оболочка (меню, About, окно), обновления, справка/хоткеи/палитра, устойчивость,
первый запуск и полировка UX, сборка инсталлятора и CI. Плюс дешёвые «wow»-фичи из gap-листа, если
останется бюджет.

**Источники:** спека §5.9, §7, §7a, §8, §9, §10 · [research/2026-09-05-spec-vs-code.md](../../research/2026-09-05-spec-vs-code.md) §B ·
[research/2026-09-05-competitors.md](../../research/2026-09-05-competitors.md) §D · [design/DESIGN-SYSTEM.md](../../design/DESIGN-SYSTEM.md).

## Глобальные ограничения
Те же, что в [W5](2026-09-05-w5-production-core.md) (CLAUDE.md: лицензии, WebContentsView/CDP, перф, безопасность, IPC-хаб, Zustand, UI-язык, UX-приоритет). Новые зависимости этой волны (все MIT): `electron-updater`, `electron-log`, `sharp`/`png-to-ico` (devDependencies, только для генерации иконок).

## Задачи

### Task 1: Брендинг — иконка приложения
Сейчас `build/icon.{png,ico,icns}` и `resources/icon.png` — дефолтный логотип Electron, он попадёт в инсталлятор.
**Что:** нарисовать знак Respo в палитре дизайн-системы (link-blue #0086fc на cream/ink; идея — три вложенных/ступенчатых прямоугольника-вьюпорта или буква R из рамок; читаемо в 16 px), SVG в `build/icon.svg`; скрипт `scripts/icons.mjs` (sharp) генерирует `build/icon.png` 1024², `build/icon.ico` (16–256), `build/icon.icns` (или доверить electron-builder генерацию из PNG — проверить), `resources/icon.png`, а также `build/installerIcon.ico`/`uninstallerIcon.ico`; иконка окна (`BrowserWindow.icon`), иконка в About и в welcome-экране.
**DoD:** в taskbar/alt-tab/инсталляторе — знак Respo; нет следов electron-логотипа (grep по бинарным хэшам старых файлов).

### Task 2: Оболочка — нативное меню, About, окно, single instance, deep link, CLI
**Files:** `src/main/menu.ts` (File: Open URL…, Open File…, Screenshot all, Settings, Quit · Edit: роли · View: Layout ▸, Zoom in/out/reset, Rotate all, Rulers, Theme, DevTools dock ▸, Reload, Reload ignoring cache · Help: Keyboard shortcuts, Documentation, Report an issue, Check for updates, About; macOS-ready template с app-меню на darwin; `autoHideMenuBar` оставить `true` — меню доступно по Alt и через акселераторы, без визуального шума), `src/main/window-state.ts` (bounds/maximized в electron-store, восстановление с проверкой, что окно на существующем дисплее), `src/main/index.ts` (`requestSingleInstanceLock`; `second-instance` → фокус + открыть URL из argv; `setAsDefaultProtocolClient('respo')`; `respo://open?url=…`, `respo <url|file>`, `?urlToOpen=` — всё через одну функцию валидации: только http/https/file, иначе игнор + лог), `components/AboutDialog.tsx` (версии app/Electron/Chromium/Node, статус апдейтера, ссылки, «Open logs folder», лицензии третьих сторон — ссылка на NOTICE).
**DoD:** e2e: второй запуск с URL передаёт его первому окну; `respo://open?url=javascript:...` отбрасывается; окно восстанавливает размер/позицию; About показывает версии.

### Task 3: Автообновление и логирование
**Files:** `src/main/updater.ts` (`electron-updater`, provider GitHub `prodbyEDDY/respo`; авто-проверка через 10 с после старта, не чаще раза в 4 ч; выключен в dev/e2e (`RESPO_NO_UPDATER=1`); события в renderer батчем), `electron-builder.yml` (`publish: github`, убрать placeholder `example.com`), Settings → Updates (текущая версия, Check now, статус/прогресс, Restart to update; никаких попапов — ненавязчивый чип «Update ready» в топ-баре), `src/main/log.ts` (`electron-log`: файл в userData/logs с ротацией; main `uncaughtException`/`unhandledRejection` → лог; renderer `console.error` в проде → лог через IPC батчем).
**DoD:** dev-app-update.yml для проверки в dev; юниты на состояние апдейтера; в проде лог-файл создаётся, ошибки попадают в него.

### Task 4: Хоткеи как единый реестр + справка + командная палитра
**Files:** `src/shared/hotkeys.ts` (единственный источник правды: id действия, label, combo (Win/mac), scope; из него — хуки renderer, акселераторы меню, подписи в tooltips и DropdownMenuShortcut, диалог справки, палитра), миграция существующих `use*Hotkeys` на реестр (можно на `tinykeys` (MIT) — тогда обновить спеку §3, иначе привести спеку к факту), добавить недостающие: Back/Forward (`Alt+←/→`), Reload (`Mod+R`, `F5`), Reload ignoring cache (`Mod+Shift+R`), Theme (`Mod+Shift+T`), Zoom (`Mod+=`/`Mod+-`/`Mod+0`), Rotate all (`Mod+Shift+.`), Rulers (`Alt+R`), Emulate (`Mod+E`), Keyboard shortcuts (`Mod+/`), Command palette (`Mod+K`), Settings (`Mod+,`); кириллические дубли раскладки — как сейчас. `components/ShortcutsDialog.tsx` (группы, поиск), `components/CommandPalette.tsx` (cmdk-подобный список всех действий + устройств/сьютов/закладок, fuzzy, подписи хоткеев — главный инструмент discoverability).
**DoD:** все хоткеи работают из реестра; в tooltip каждой кнопки тулбара — её хоткей; палитра открывается и выполняет действия; e2e `hotkeys.spec.ts` для 5 ключевых; юниты на реестр (нет дублей комбо в одном scope).

### Task 5: Устойчивость
**Files:** `components/ErrorBoundary.tsx` (экран «Something went wrong» + Reload UI + Copy details; логируется), `src/main/index.ts` (UI-окно `render-process-gone`/`unresponsive` → пересоздание с восстановлением состояния), защита от «пустого» состояния стора после битого файла persistence (валидация + backup `.bak` при миграции, уже частично есть — проверить).
**DoD:** юнит на ErrorBoundary; ручная проверка через тест-хук, бросающий исключение в компоненте.

### Task 6: Первый запуск и полировка UX
- Welcome/empty state: адрес пуст → центрированный экран (знак, «Enter a URL or open a file», кнопка Open file…, 3 последних URL из истории), исчезает при первой навигации.
- Settings реструктурировать: General (home page, theme, Accept-Language — если не сделано в W5), Screenshots, Security (insecure certs — с видимым янтарным чипом «Insecure certs ON» в топ-баре, пока включено), Updates, Agents (заглушка-плейсхолдер для W7 — не показывать до W7), About.
- Аудит: tooltips у всех иконок (с хоткеями), `focus-visible`-кольца, tab-порядок, aria-label на icon-кнопках, dark-тема во всех новых диалогах W5/W6, минимальный размер окна 1024×700 и адекватная раскладка при нём, HiDPI-чёткость, `prefers-reduced-motion`.
- Уведомления (Notice/ShotNotice) — единый тихий toast-слой, автоскрытие, без стека дублей.
**DoD:** чек-лист в отчёте с скриншотами обеих тем (light/dark) главных экранов.

### Task 7: Сборка, CI, репозиторная гигиена
**Files:** `electron-builder.yml` (nsis: `oneClick: true` по умолчанию + `allowToChangeInstallationDirectory: true`, installer/uninstaller icons, `artifactName`, `perMachine: false`; `publish: github`; linux-таргеты убрать до востребования), `package.json` (`version` → `1.0.0-rc.1`, `description`, `build:win` проверить локально — артефакт `dist/respo-1.0.0-rc.1-setup.exe` реально ставится и запускается), `README.md` (English, user-facing: что это, скриншот-плейсхолдер, установка, фичи, хоткеи, roadmap, development; docs/ остаются на русском), `CHANGELOG.md` (Keep a Changelog; 1.0.0-rc.1 — сводка W1–W6), `NOTICE.md` (атрибуции: Chromium device list BSD-3, логотипы — в W7), `.github/workflows/ci.yml` (windows-latest: `npm ci`, typecheck, lint, unit, e2e с загрузкой playwright-report при падении), `.github/workflows/release.yml` (tag `v*` → `build:win` + publish в GitHub Releases через `GH_TOKEN`).
**LICENSE:** решение владельца (сейчас `UNLICENSED`, private) — **не добавлять файл лицензии**, вынести вопрос в отчёт.
**DoD:** CI зелёный на PR; локальная сборка инсталлятора проходит; README читается как продуктовая страница.

### Task 8: Перф-гейт (спека §8)
**Files:** `e2e/perf.spec.ts` (10 девайсов, 5 с непрерывного скролла лидера + включённая диагностика W5; p99 event-loop-delay main через тест-хук `perf:stats`; assert ≤ 16 мс локально; в CI — soft (аннотация), т.к. раннеры шумные), `src/main/perf.ts` (экспорт статистики по запросу).
**DoD:** тест стабилен 5/5 локально, цифры — в отчёт.

### Task 9 (опционально, по остатку бюджета, в порядке приоритета)
1. **Page info** (кнопка ⓘ у адресной строки): title, description, canonical, viewport-meta, favicon, OG/Twitter-карточка с превью — одноразовый `Runtime.evaluate` чтения `<head>` у лидера.
2. **Element screenshot** из inspect-режима (клик с `Alt` → `Page.captureScreenshot` с клипом `DOM.getBoxModel`).
3. **Contact sheet**: «All devices → one image» (склейка скриншотов в один PNG с подписями — `nativeImage`/`sharp`).
4. **Breakpoints → devices**: прочитать `@media (min/max-width)` из `document.styleSheets` лидера (cross-origin — пропускать) → диалог «Add devices for breakpoints» (создаёт кастомные девайсы шириной по брейкпоинтам).

### Task 10: Документация, ревью, отчёт
Спека (§5.9, §10 факт), `docs/modules/*` для новых модулей, `CLAUDE.md` (команды, грабли), ревью ветки субагентом (`model: "opus"`) + фикс-волна, отчёт `docs/progress/W6-production-shell-2026-09-XX.md`, черновик записи ROADMAP для координатора.

## DoD волны
Инсталлятор собирается и ставится; автообновление работает против GitHub Releases (проверка в dev через dev-app-update.yml); все хоткеи документированы в диалоге и палитре; CI зелёный; typecheck/lint/unit/e2e зелёные; отчёт с скриншотами.
