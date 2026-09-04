# Статус-матрица: спека vs код (срез 2026-09-05)

> Read-only разведка (Sonnet 5) по заданию координатора. Срез — `main` = `1cc4fe9` (merge W4).
> Используется как исходник для планов production-волн W5/W6. Номера строк — на момент среза.

## A) Матрица по спеке §4.2 и §5.1–5.9

### §4.2 Модули main-процесса

| Модуль | Статус | Файл(ы) |
|---|---|---|
| ViewManager | ✅ | `src/main/view-manager.ts`, виртуализация через `setVisible` — `view-manager.ts:268`, `view-backend.ts:357,466` |
| ViewManager: аудио-мьют + throttling невидимых | 🟡 | только `setVisible(false)`; `setAudioMuted`/`setBackgroundThrottling` не вызываются |
| CDPController | ✅ | `src/main/cdp-controller.ts` — metrics (:282,323), touch (:286), UA (:295), screenshot+captureBeyondViewport (:525), inspect (:408), Input.dispatch* (:334,340), getBoxModel (:434) |
| CDPController: UA + Client Hints | 🟡 | передаётся только `{ userAgent }` (`cdp-controller.ts:291-296`), без `userAgentMetadata` |
| SyncEngine | ✅ | `src/main/sync-engine.ts`, rAF-коалесинг, скролл по доле, пер-девайс отключение (`stores/sync.ts`, `DeviceFrame.tsx:96-121`) |
| ScreenshotQueue | ✅ | `src/main/screenshot-queue.ts`, `SHOT_CONCURRENCY = 3` (:116), N из M через batchId |
| DevToolsManager | ✅ | `src/main/devtools-manager.ts`, док bottom/right + detach |
| FileWatcher | ❌ | нет модуля, нет `chokidar` |
| PermissionsManager | ✅ | `src/main/permissions.ts`, хендлеры в `security.ts:73,91` |
| AuthHandler | ✅ | `src/main/auth.ts`, корреляция по id — `index.ts:400-415` |
| ProtocolHandler / CLI | ❌ | нет `respo://`, нет `setAsDefaultProtocolClient`, нет разбора `process.argv`; только env `RESPO_START_URL` (`index.ts:154-180`) |
| Updater | ❌ | `electron-updater` не установлен; `electron-builder.yml:32-34` содержит заглушку `publish.url: https://example.com/auto-updates` |
| SettingsStore | 🟡 | `src/main/persistence.ts` + `shared/persistence-types.ts` — есть devices/suites/bookmarks/permissions/screenshots/devtools/sync; нет `guides`/`designOverlays` |

### §5.1 Превью и раскладки

| Пункт | Статус | Файл(ы) |
|---|---|---|
| Column/Flex/Masonry/Individual | ✅ | `persistence-types.ts:81-89`, `TopBar.tsx:170-202`, `lib/canvas-layout.ts` |
| Зум 25–200% + ctrl+колесо | ✅ | `stores/layout.ts:17`, `Canvas.tsx:199-222` |
| Раздельный зум Individual | ✅ | `stores/layout.ts:82,150-152` |
| Поворот всех / одного | ✅ | `TopBar.tsx:438-440`, `DeviceFrame.tsx:131-153` |
| Reload / scroll-to-top / спиннер / оверлей ошибки | 🟡 | reload, спиннер, оверлей ошибки ✅; **scroll-to-top по устройству — нет** |
| Оверлей «страница упала» + перезапуск | ❌ | нет обработчика `render-process-gone` в `src/main` |
| Скрытие скроллбаров на мобильных (insertCSS) | ❌ | ни одного `insertCSS` в `src/` |
| Виртуализация невидимых | ✅ | `view-manager.ts:188,268` |

### §5.2 Эмуляция устройств

| Пункт | Статус | Файл(ы) |
|---|---|---|
| Каталог 90+ устройств | 🟡 | **38 устройств** в `shared/deviceCatalog.ts:46-91` |
| Кастомные девайсы CRUD, авто-UA, запрет дублей | ✅ | `shared/custom-devices.ts:172`, `DeviceEditDialog.tsx`, `deviceCatalog.ts:118-122` |
| CDP-эмуляция метрик/DPR/touch/UA | ✅ | CDPController |
| UA + Client Hints | 🟡 | нет `userAgentMetadata` |
| `prefers-color-scheme` эмуляция для страниц | ❌ | есть только тема самого UI (`stores/settings.ts:42`); `setEmulatedMedia` не вызывается |

### §5.3 Сьюты — ✅ полностью (`SuitesPanel.tsx`, `SuiteSelector.tsx`, `DeviceManagerView.tsx:142-228`, `stores/devices.ts`, dnd-kit).

### §5.4 Навигация и адресная строка

| Пункт | Статус | Файл(ы) |
|---|---|---|
| Авто-https/http, select-all, drag&drop | 🟡 | `normalizeUrl` (`shared/ipc.ts:725-738`) ✅; select-all/DnD в `AddressBar.tsx` не подтверждены построчно |
| «Открыть файл…» | ✅ | `main/index.ts:634-655`, `browsing.ts`, `TopBar.tsx:330-334` |
| Автодополнение + очистка + лимит 2000 | ✅ | `main/history.ts:26` |
| Favicon локально | ✅ | `main/favicons.ts` |
| Back/Forward/Reload (+ignore cache), home | 🟡 | **reload ignoring cache — нет отдельного канала** (`nav:reload` без параметра) |
| Закладки | ✅ | `BookmarkStar.tsx`, `stores/bookmarks.ts`, `TopBar.tsx:286-313` |
| Очистки + хоткеи | ✅ | `ClearMenu.tsx`, `ipc.ts:659-671`, `useClearHotkeys.ts` |
| Разрешения сайта | ✅ | `SitePermissions.tsx` (:80, :184-187, :200) |
| HTTP Basic Auth + insecure SSL | ✅ | `AuthDialog.tsx`, `main/auth.ts`, `SettingsDialog.tsx:98-141` |
| Popups: блок у не-ведущих, разрешены у ведущего | 🟡 | **блокируются у всех**, открываются во внешнем браузере (`view-backend.ts:361-365`, `security.ts:20-36`) |

### §5.5 DevTools и инспектор — ✅ полностью (`DevtoolsDock.tsx`, `devtools-manager.ts`, `main/inspector.ts`, `TopBar.tsx:212-268`, контекстное меню `view-backend.ts:416-432`).

### §5.6 Скриншоты

| Пункт | Статус | Файл(ы) |
|---|---|---|
| Пер-девайс viewport / full-page | ✅ | `cdp-controller.ts:525-527`, `DeviceFrame.tsx:224-280` |
| «Все» через очередь, N из M | ✅ | `ScreenshotQueue`, `ShotControls.tsx` |
| Звук затвора | ❌ | только визуальная вспышка (`useShutter`, `DeviceFrame.tsx:292-311`) |
| PNG/JPEG, папка, reveal, буфер | ✅ | `SettingsDialog.tsx:26-42`, `shot:reveal`/`shot:copy` |
| DPR 1 vs device | ✅ | `ShotDpr` (`ipc.ts:74`) |

### §5.7 Инструменты дизайнера — ❌ **весь раздел отсутствует** (линейки/направляющие, Design Overlay, симуляция зрения; нет `@scena/react-guides`, нет полей в `PersistedState`).

### §5.8 Live-reload — ❌ **отсутствует** (нет FileWatcher/chokidar).

### §5.9 Оболочка приложения

| Пункт | Статус | Файл(ы) |
|---|---|---|
| Хоткеи + модалка-справка | 🟡 | 10 хоткеев есть (см. §C); нет back/forward/reload/theme/zoom-step/rotate-all; **нет диалога справки** |
| Настройки: папка, Accept-Language, формат | 🟡 | папка+формат+DPR ✅; **Accept-Language отсутствует** |
| Тема UI, английский | ✅ | `TopBar.tsx:142-154` |
| `respo://`, CLI, `?urlToOpen=` | ❌ | отсутствуют |
| Автообновление, About | ❌ | отсутствуют |
| Нативное меню | ❌ | `autoHideMenuBar: true` (`index.ts:191`), `setApplicationMenu` не вызывается |
| Не делаем попапы | ✅ | подтверждено отсутствием |

## B) Инвентарь production-readiness

| Пункт | Есть? | Файл |
|---|---|---|
| Иконка приложения | ❌ | `build/icon.{png,ico,icns}`, `resources/icon.png` — **дефолтный логотип Electron** |
| electron-builder конфиг | ✅ | `electron-builder.yml` |
| NSIS-опции | 🟡 | минимум (:14-18); нет `oneClick: false`, `allowToChangeInstallationDirectory`, installer icons |
| appId/productName | ✅ | `com.prodbyeddy.respo` / `Respo`; AppUserModelId — `index.ts:719` |
| Автообновление | ❌ | нет `electron-updater`; placeholder publish.url |
| Логирование | ❌ | нет `electron-log`; разрозненные `console.*` (`index.ts:170,348-350`) |
| Single instance lock | ❌ | `requestSingleInstanceLock` не вызывается |
| Персистентность окна | ❌ | фиксированное `1400×900` (`index.ts:185-189`) |
| Нативное меню | ❌ | — |
| About | ❌ | — |
| Справка по хоткеям | ❌ | — |
| First-run / empty state | 🟡 | дефолтный сьют из 5 устройств (`deviceCatalog.ts:103-109`); онбординга нет |
| Error boundaries (React) | ❌ | 0 совпадений |
| Renderer CSP | ✅ | `src/renderer/index.html:6-10` |
| Deep-link / CLI | ❌ | — |
| Crash reporter | ❌ | — |
| Покрытие Settings | 🟡 | screenshots + insecure-certs только |
| README / LICENSE / CHANGELOG | ❌ | отсутствуют; `package.json` `"license": "UNLICENSED"` |
| CI (GitHub Actions) | ❌ | `.github` нет |

## C) Хоткеи (из кода; реализованы через `keydown`, не через `tinykeys`)

| Комбинация | Действие | Файл |
|---|---|---|
| `Mod+Shift+L` | Цикл раскладок | `hooks/useLayoutHotkeys.ts:17-21,56-65` |
| `Escape` (individual) | Выход из individual | `useLayoutHotkeys.ts:67-79` |
| `Mod+L` | Фокус адресной строки | `useAddressHotkeys.ts:53-62` |
| `Mod+D` | Закладка | `useAddressHotkeys.ts:64-73` |
| `Mod+O` | Открыть файл | `useAddressHotkeys.ts:75-78` |
| `Mod+Alt+Q` / `A` / `Z` / `Delete` | Очистить storage / cookies / cache / всё | `useClearHotkeys.ts:14-26` |
| `Mod+I` | Инспектор | `useInspectHotkeys.ts:13-16,52-61` |
| `Escape` (inspect) | Выключить инспектор | `useInspectHotkeys.ts:63-68` |
| `Mod+S` (+`Alt` = full-page) | Скриншот всех | `useShotHotkeys.ts:12-15,39-51` |

Кириллические дубли раскладки учтены. Отсутствуют: back/forward/reload, тема, зум с клавиатуры, поворот всех, всё для §5.7.

## D) Покрытие e2e (16 spec)

auth · bookmarks · clear-data · clipping · devtools · emulation · insecure-certificates · inspect · layouts · navigation · permissions · persistence · screenshots · suites · sync · zoom.
**Не покрыто:** кастомное устройство, переживающее рестарт (только юниты); перф-бюджет §8 как автоматический гейт (только dev-монитор `main/perf.ts`, `index.ts:345-351`).

## E) TODO/FIXME и env-флаги

- TODO/FIXME/HACK в `src/` — 0. Открытые вопросы живут в `docs/progress/*.md` («Follow-ups»).
- `RESPO_START_URL` — стартовый URL (e2e). `RESPO_CANVAS_LAYER` — `!== '0'` включает canvas-layer (`index.ts:295`). `RESPO_SPIKE`, `RESPO_SPIKE_DELTA`, `RESPO_SPIKE_DIR` — R1-спайк, только dev (`index.ts:362-367`).
- Follow-ups W4: гонка в панели разрешений (origin на момент хендлера); Cancel в auth при нескольких вьюпортах; favicon-фетч без content-length; накопление e2e-профилей на Windows.

## F) Несостыковки и незавершённое

1. §5.7 и §5.8 отсутствуют в коде, хотя ROADMAP помечал W5 🟡 — работа не начата (worktrees созданы, коммитов нет).
2. Каталог — 38 устройств вместо 90+.
3. Хоткеи — вручную, не `tinykeys` (спека §3). Работает; спеку привести к факту или мигрировать.
4. Popup-политика: блок у всех, не только у не-ведущих. Осознанное упрощение ради безопасности — спеку привести к факту.
5. UA Client Hints не реализованы.
6. `prefers-color-scheme` для страниц отсутствует.
7. Оверлей краша рендерера (`render-process-gone`) отсутствует.
8. Иконка — дефолтный Electron, уже подключена в сборку.
9. `publish.url` — placeholder.
10. README/LICENSE/CHANGELOG/CI отсутствуют; лицензия не решена.
11. Нет React error boundary.
12. Скрытие мобильных скроллбаров отсутствует.
13. Документация (`ROADMAP`, `progress/*`) совпадает с кодом по W1–W4 — надёжный источник.
