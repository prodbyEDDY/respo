# Updater и логирование (`src/main/updater.ts`, `src/main/log.ts`)

> Модуль main-процесса. Появился в W6 Task A2. Связанные документы:
> [спека §5.9/§10](../superpowers/specs/2026-08-28-respo-design.md), [ROADMAP §11 → 2026-09-05 «Open source (MIT)…»](../ROADMAP.md),
> [план W6](../superpowers/plans/2026-09-05-w6-production-shell.md).

## Что это

Автообновление через GitHub Releases (`electron-updater`, NSIS) и единственный UI для него —
**чип в топ-баре**, который виден только пока есть что сказать. Плюс файловый лог (`electron-log`)
и диалог **About**. Никаких модалок, попапов и «what's new».

## Правила (решения владельца, 2026-09-05)

| Правило | Где в коде |
|---|---|
| Проверка при запуске **не чаще раза в сутки** (+ вручную из About) | `scheduleStartupCheck` → `isCheckDue(lastCheckAt, now)`, задержка `STARTUP_CHECK_DELAY_MS` = 10 с после `ready` |
| Ничего не скачивается без клика | `autoUpdater.autoDownload = false`; `download()` вызывает только чип (`updates:download`) |
| Один клик — скачать, второй — перезапуститься | `install()` → `quitAndInstall(isSilent=true, isForceRunAfter=true)`: тихий NSIS, приложение перезапускается само |
| Скачанное, но не установленное ставится при выходе | `autoInstallOnAppQuit = true` |
| Выключено в dev/e2e | `resolveUpdaterMode`: `!app.isPackaged` → `{enabled:false, reason:'dev'}`; `RESPO_NO_UPDATER=1` → `'env'` |

## State-машина (`createUpdater`)

```
idle ──check()──▶ checking ──update-not-available──▶ up-to-date   (stamp lastCheckAt)
                     │
                     └──update-available──▶ available ──download()──▶ downloading ──update-downloaded──▶ downloaded ──install()──▶ quitAndInstall
                                                                          │  (download-progress: percent, push только на смене целого %)
error ◀── 'error' из любой стадии (version сохраняется, если падала загрузка → чип предлагает retry)
```

- Payload `UpdateStatePayload` (`src/shared/ipc.ts`): `stage`, `enabled`, `autoCheck`, `current`, `version`,
  `percent`, `error`, `lastCheckAt`. Всегда **целое состояние**, не дельта.
- **`lastCheckAt` ставится только на `up-to-date`.** Если проверка нашла релиз, а чип не нажали — следующий
  запуск проверит снова и чип вернётся. Ошибка проверки тоже не ставит штамп (оффлайн → повтор на следующем
  запуске).
- `download()` допустим из `available` **и** из `error` с известной `version` (electron-updater хранит
  результат проверки — повторная проверка не нужна). `install()` — только из `downloaded`.
- Прогресс: `download-progress` приходит из `ProgressCallbackTransform` electron-updater не чаще раза в
  секунду; мы пушим `update-state` только при смене целого процента — ≤ 100 сообщений на загрузку.
- `electron-updater` спрятан за `AutoUpdaterLike` (5 событий + 3 метода) — юниты гоняют fake
  (`src/main/__tests__/updater.test.ts`, 24 теста).

## Персистентность

Слайс `updates: { lastCheckAt: number|null, autoCheck: boolean }` в `PersistedState` — **поле main**
(как `permissions`): `validatePersistedPatch` его отбрасывает, единственная дверь для предпочтения —
канал `updates:set-auto-check`. Документ старой версии без слайса читается как «никогда не проверяли,
проверять ежедневно» (`sanitizeUpdates`, без бампа `SCHEMA_VERSION`).

## IPC (`src/shared/ipc.ts`)

| Канал | Что |
|---|---|
| `updates:get` / `updates:check` / `updates:download` | отвечают целым состоянием |
| `updates:install` | `void`; `quitAndInstall` |
| `updates:set-auto-check [boolean]` | предпочтение, `validateBoolean` |
| `app:get-info` | `AppInfo` — версии Electron/Chromium/Node, платформа |
| `app:open-resource ['logs'\|'notices']` | `shell.openPath` папки логов или `NOTICE.md` (`validateAppResource`, путь резолвит main) |
| событие `update-state` | push при каждом движении машины |

## Renderer

- `stores/updates.ts` — зеркало состояния, `attachUpdatesBridge()` (refcount под StrictMode; при первом
  attach — `updates:get`, т.к. запусковая проверка могла завершиться до монтирования).
- `components/toolbar/UpdateChip.tsx` — mint-чип справа от адресной строки: `Update to 0.1.1` →
  `Updating… 43%` (disabled, спиннер) → `Restart to update`; при ошибке загрузки — красный
  `Update failed — retry` с причиной в tooltip. `selectChipVisible`: available/downloading/downloaded или
  error **с** version. Ошибка *проверки* в чип не попадает — только в About и лог.
- `components/about/AboutDialog.tsx` — ⋯ → About Respo: знак, версия, Electron/Chromium/Node, строка
  статуса апдейтера + одно действие (Check now / Update to X / Restart to update), ссылки GitHub / Report an
  issue / Changelog (внешний браузер через `setWindowOpenHandler` → `openExternalSafe`), Open logs folder,
  Third-party notices.
- Settings → Updates: чекбокс «Check for updates automatically» (disabled с подписью «Updates are off in
  this build», если апдейтер выключен).

## Тестовый фид (e2e и ручная проверка)

`RESPO_UPDATE_URL=http://127.0.0.1:<port>/` включает апдейтер в любом режиме (включая dev/e2e) и
переключает фид на `generic`-провайдер. **Принимаются только loopback-адреса** (`loopbackFeedUrl`:
`127.0.0.1` / `localhost` / `[::1]`, http(s)) — фид решает, что будет установлено, и env-переменная не
место для этого (спека §7a). Механика: main пишет в профиль `respo-update-feed.yml`
(`provider: generic`, `url`, `updaterCacheDirName: respo-updater-test`) и отдаёт его через
`autoUpdater.updateConfigPath` + `forceDevUpdateConfig` — тот же файл, что electron-builder кладёт в
`resources/app-update.yml`, поэтому вся цепочка (провайдер, кэш `%LOCALAPPDATA%\respo-updater-test\pending`,
манифест, загрузка, sha512) работает как в упакованной сборке. `setFeedURL` не подходит: он подменяет только
провайдер, а шаг загрузки читает `updaterCacheDirName` с диска.

`e2e/updater.spec.ts` поднимает http-сервер с `latest.yml` и 3-мегабайтным «инсталлятором» и проходит
весь путь: запусковая проверка (без клика, через 10 с) → чип → клик → проценты → `Restart to update` →
About говорит то же → клик → `quitAndInstall(true, true)` (единственная заглушка — сам вызов ОС, на
синглтоне `electron-updater`, через `createRequire` из `app.getAppPath()`).

Грабли: **запускать Electron по каталогу проекта** (`args: [ROOT]`), а не по `out/main/index.js` — иначе
`app.getVersion()` отдаёт версию Electron (44.0.0) и любой релиз считается даунгрейдом. Остальные spec'и
запускают по файлу, им версия не важна.

## Логирование (`src/main/log.ts`)

- `electron-log/main`, только файловый транспорт: `userData/logs/main.log`, ротация на 1 МБ в `main.old.log`.
  Без `log.initialize()` — рендерер-мост electron-log не нужен и не желателен.
- `log.errorHandler.startCatching({ showDialog: false })` — `uncaughtException`/`unhandledRejection` main
  уходят в файл, **без диалога**.
- Ошибки рендерера Respo — через событие `console-message` уровня `error` у `webContents` окна
  (`watchRendererErrors`, только в упакованной сборке; в dev тот же вывод уже идёт на stdout) плюс
  `render-process-gone` / `unresponsive`. Это main-событие, а не IPC-канал: страницы девайсов до него не
  дотягиваются, новых каналов нет.
- `autoUpdater.logger = log` — строки electron-updater («Checking for update», «Found version …») в том же файле.
- «Open logs folder» в About → `app:open-resource 'logs'` → `ensureLogsDirectory()` + `shell.openPath`.
