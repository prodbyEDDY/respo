# Respo — спецификация дизайна

Дата: 2026-08-28. Статус: утверждено по секциям в диалоге, ожидает финального ревью.

## 1. Что это

**Respo** — десктопное приложение (Windows сейчас, macOS позже) для разработки адаптивных сайтов: одна страница одновременно отображается в наборе девайс-вьюпортов (телефоны/планшеты/десктопы) с синхронизацией навигации и взаимодействий, DevTools на каждый девайс, скриншотами и инструментами дизайнера.

Функциональный референс — [Responsively App](https://responsively.app) (AGPL-3.0). Мы повторяем и улучшаем его функционал, **не используя ни строчки его кода и его списка устройств** — только собственная реализация и разрешённые лицензии.

**Главные цели, отличающие нас от референса:**

1. **Производительность.** Responsively лагает из-за: `<webview>`-тега (устаревший, тяжёлая композиция), нетроттленного потока scroll-IPC (60+ сообщений/сек с каждого девайса), зеркалирования взаимодействий через встроенный browser-sync HTTPS-сервер с сокетом в каждой странице, скриншотов «все сразу» без лимита параллелизма. Мы устраняем каждый из этих источников архитектурно.
2. **UX.** Современный, быстрый, чистый интерфейс (shadcn + кастомная тема), без маркетинговых попапов.
3. **Честная эмуляция.** У референса «эмуляция» — это UA-строка и CSS-размер. У нас — настоящая эмуляция метрик устройства через CDP (DPR, touch, viewport), страницы ведут себя как на реальном устройстве.

## 2. Лицензионные правила

- Разрешённые зависимости: MIT, Apache-2.0, BSD, ISC.
- Запрещено: GPL, AGPL и любой код/данные из репозитория responsively-app (включая их deviceList.ts).
- Каталог устройств берём из Chromium DevTools frontend (emulated devices, BSD-3) + открытые справочники.
- Лицензия самого Respo: решается позже; код пишется так, чтобы не блокировать ни закрытую, ни открытую модель.

## 3. Технологический стек

| Слой | Выбор |
|---|---|
| Оболочка | Electron (актуальный стабильный), **WebContentsView** (не `<webview>`, не BrowserView) |
| Сборка | electron-vite, electron-builder (Windows NSIS; mac dmg — позже), electron-updater |
| Язык | TypeScript strict везде |
| UI | React 18+, **shadcn/ui с кастомной темой**, Tailwind, иконки **Heroicons** |
| Стейт | Zustand (renderer), типизированные IPC-контракты main↔renderer |
| Персистентность | electron-store |
| Линейки/гайды | собственные: canvas-полосы 20px (`renderer/lib/rulers.ts`) + направляющие CSS-слоем в странице (`main/guides.ts`); зависимость `@scena/react-guides` не понадобилась (W5) |
| DnD | dnd-kit |
| Хоткеи | собственные хуки `renderer/hooks/use*Hotkeys.ts` (keydown + гард по фокусу/Radix-диалогам); `tinykeys` не подключался — решение W5: набор хоткеев мал, а гард по фокусу библиотека не даёт |
| Файл-вотчер | chokidar 4 (MIT), лениво импортируется, только для `file://` |
| Тесты | Vitest (юниты), Playwright + Electron (e2e) |

Принцип: максимум готовых проверенных OSS-блоков; собственный код — только там, где готового нет (ViewManager, SyncEngine, оркестрация раскладок — ~20% кодовой базы).

## 4. Архитектура

### 4.1 Процессная модель

Один main-процесс — дирижёр «браузерной» части; один renderer — UI-приложение (React); N WebContentsView — страницы девайсов.

UI рисует только **рамки-плейсхолдеры** девайсов. Main накладывает WebContentsView поверх рамок. При скролле/зуме/переразметке канваса renderer шлёт новые прямоугольники **одним rAF-батчем** → main применяет `setBounds` ко всем вьюшкам за один проход.

### 4.2 Модули main-процесса

- **ViewManager** — жизненный цикл N WebContentsView: создание/уничтожение при смене сьюта, позиционирование, **виртуализация**: девайсы вне видимой области канваса выгружаются или замораживаются (`setVisible(false)` + аудио-мьют + throttling), возвращаются при появлении.
  - **Зум:** рамка вьюшки = логический размер девайса × zoom (`setBounds`), содержимое масштабируется `webContents.setZoomFactor(zoom)` при **неизменной** CDP-эмуляции метрик — media queries и layout страницы видят честные W×H девайса при любом зуме.
  - **Сессия:** все вьюшки в одной персистентной партиции `persist:respo` — куки/логины общие между девайсами и переживают рестарт (как в обычном браузере); очистка storage/cookies — через session-API этой партиции по origin.
- **CDPController** — по одному `webContents.debugger`-аттачу на view (единожды, на весь жизненный цикл). Через него: `Emulation.setDeviceMetricsOverride` (W×H/DPR/mobile/touch), `Emulation.setTouchEmulationEnabled`, `Network.setUserAgentOverride` (UA + `acceptLanguage` + `userAgentMetadata` — Client Hints выводятся из UA-строки девайса, `shared/client-hints.ts`), `Page.captureScreenshot` (`captureBeyondViewport` для full-page), `Overlay.setInspectMode` (инспект-оверлей), `Input.dispatch*` (синхронизация ввода), `DOM.getBoxModel`; **Emulation pack (W5):** `Emulation.setEmulatedMedia` (color-scheme/media type/reduced-motion), `Emulation.setEmulatedVisionDeficiency`, `Network.emulateNetworkConditions` (без `Network.enable`), `Emulation.setGeolocationOverride`, `Emulation.setTimezoneOverride`, `Emulation.setLocaleOverride`; `Runtime.enable` + `exceptionThrown`/`consoleAPICalled` для диагностики; одноразовые `Runtime.evaluate` (измерения, overflow-скан, подмена href css) — результат считается недоверенным и валидируется. Все override'ы переживают навигацию, реплей нужен только при реаттаче (`onDetach`).
- **SyncEngine** — зеркалирование взаимодействий:
  - «Ведущий» вьюпорт — тот, с которым взаимодействует пользователь (по hover/фокусу).
  - События ввода ведущего коалесируются через rAF и рассылаются остальным как CDP `Input.dispatchMouseEvent/dispatchKeyEvent` с нормализацией координат под размеры каждого девайса.
  - Скролл синхронизируется **по относительной позиции** (доля прокрутки документа), не по сырым deltas — страницы разной высоты не разъезжаются.
  - Пер-девайс флаг «не зеркалировать» (вход и/или выход).
  - Никакого локального сервера и инжектируемых клиент-скриптов.
  - **Известные пределы (задокументированное поведение, не баги):** зеркалирование набора текста требует, чтобы поле было в фокусе и у последователей — фокус зеркалируется предшествующим кликом, но сложные виджеты могут расходиться; скролл «по доле» может плыть на страницах с lazy-load контентом разной высоты. Лечение в обоих случаях — пер-девайс отключение синхронизации.
- **ScreenshotQueue** — очередь скриншотов с лимитом параллелизма (по умолчанию 2–3); PNG/JPEG, сохранение в настраиваемую папку и/или копия в буфер обмена; «все девайсы» = задания в очередь, итоговый отчёт N из M.
- **DevToolsManager** — карта viewId → DevTools. Док снизу/справа: отдельный WebContentsView + `setDevToolsWebContents`; undocked: `openDevTools({mode:'detach'})`. Ресайз панели — bounds из renderer. Без CSS-хаков внутри DevTools-фронтенда, без глобального синглтона.
- **FileWatcher** — chokidar (ленивый импорт), активируется **только** для `file://`-страниц: следит за папкой страницы (`depth: 3`, без `node_modules`/`.git`, расширения html/htm/css/js/mjs), debounce 100 мс; залп только из css — hot-swap: одноразовый `Runtime.evaluate` подменяет `href` у `<link rel=stylesheet>` с тем же `file:`-путём (`?respo-reload=<ts>`), а не `CSS.setStyleSheetText` (не нужны `CSS.enable`/`DOM.enable` и stylesheetId); если в какой-то вьюшке подменять нечего (`@import`) или в залпе есть html/js — reload всех вьюшек. Индикатор в адресной строке, пауза кликом.
- **EmulationManager** (W5) — профиль эмуляции (глобальный) + пер-девайс vision; применяется через CDPController по группам с диффом; восстанавливается из персистентности до создания вьюшек.
- **DiagnosticsManager** (W5) — счётчики `console.error`/исключений и overflow-скан (одноразовый `Runtime.evaluate`, результат валидируется как недоверенный) на каждый девайс; батчи `diagnostics` в renderer; подсветка виновников overflow — insertCSS-слоем.
- **GuidesManager / DesignOverlayManager / DebugCssManager** (W5) — CSS-слои в странице через `insertCSS`/`removeInsertedCSS` (направляющие `html::after`, макет `html::before`, outline `*`), реинжект на `did-finish-load`; `set`, пришедший до регистрации вьюшки, ждёт в `pending`.
- **PermissionsManager** — `setPermissionRequestHandler/CheckHandler`; решения persist по origin+тип (camera, microphone, geolocation, notifications, clipboard-read, fullscreen, midi, pointerLock); коалесинг одновременных запросов; UI-промпт через IPC.
- **AuthHandler** — HTTP Basic Auth: `app.on('login')`, коалесинг по хосту, модалка в renderer, корреляция ответа по host (не `ipcMain.once` без фильтра — известный баг референса).
- **ProtocolHandler / CLI** — протокол `respo://` (deep link «открыть URL»), запуск `respo <url|file>` из командной строки.
- **Updater** — electron-updater (GitHub releases), выключен в dev/CI.
- **SettingsStore** — electron-store: devices, suites, bookmarks, history, guides, designOverlays, permissions, настройки приложения.

### 4.3 IPC-контракты

Все каналы описаны в общем типизированном модуле `shared/ipc.ts` (имена, payload-типы для invoke/handle и событий). Main валидирует входные payload'ы. События загрузки страниц (start/stop/fail/title/favicon/крах) стримятся из main батчами (сборка за кадр), а не по одному.

### 4.4 Поток данных (пример: ввод URL)

AddressBar → navigation store → один `invoke('navigate', url)` → ViewManager грузит URL во все вьюшки → события загрузки батчами обратно → store → рамки девайсов обновляют спиннеры/ошибки; история пополняется по факту навигации ведущего вьюпорта.

## 5. Функционал (полный паритет с референсом + улучшения)

### 5.1 Превью и раскладки
- Раскладки: Column, Flex (перенос), Masonry, Individual (один девайс + табы остальных).
- Зум: ступени 25–200% + плавный ctrl+колесо; раздельный зум для Individual.
- Поворот всех устройств / одного устройства (только rotatable-девайсы).
- Пер-девайс (kebab-меню рамки): reload / reload ignoring cache, scroll-to-top, спиннер загрузки, оверлей ошибки (код+описание; aborted и iframe-ошибки игнорируются), оверлей «Page crashed» с кнопкой Restart (`render-process-gone` → `wc.reload()`; общий reload обходит упавшие вьюшки). Хоткеи Mod+R / Mod+Shift+R.
- Скроллбары на мобильных девайсах не рисуются самой mobile-эмуляцией Chromium (проверено W5) — отдельный insertCSS не нужен и не делается.
- Виртуализация невидимых девайсов (наше, у референса нет).

### 5.2 Эмуляция устройств
- Каталог: 110 устройств (W5; источник метрик — Chromium DevTools, BSD-3, атрибуция в `NOTICE.md`, плюс публичные спецификации вендоров) с W×H, DPR, UA, типом (phone/tablet/desktop), touch/rotate-флагами; id стабильны навсегда (см. `docs/modules/device-catalog.md`).
- Кастомные девайсы: создание/редактирование/удаление, авто-подстановка UA по типу, запрет дублей имён.
- Честная эмуляция через CDP: метрики, DPR, touch, UA + Client Hints (`userAgentMetadata` выводится из UA-строки девайса: brands/platform/mobile/model; full-version-list берётся из движка только при совпадении major; для не-Chromium UA метаданные не шлются — как в настоящем Safari/Firefox).
- `prefers-color-scheme` и остальной Emulation pack — см. §5.10.

### 5.3 Сьюты (Preview Suites)
- Группы девайсов; создание/удаление (кроме default), активация, быстрый селектор в тулбаре.
- Состав сьюта чекбоксами, минимум один девайс, drag-and-drop порядок (dnd-kit).
- Импорт/экспорт JSON (кастомные девайсы + сьюты), merge по имени, сброс к дефолту с подтверждением.
- Поиск/фильтр девайсов по имени и W×H.

### 5.4 Навигация и адресная строка
- URL-инпут: авто-https (http для localhost), select-all по фокусу, drag-and-drop ссылки.
- «Открыть файл…» — системный диалог выбора локального html (у референса этот пункт меню — нерабочая заглушка).
- Автодополнение из истории (заголовок+URL, стрелки, favicon); очистка истории; лимит истории ~2000 записей (FIFO). Favicon — из события `page-favicon-updated` с локальным кэшем, никаких внешних favicon-сервисов (референс сливает посещаемые URL в Google-эндпоинт).
- Back/Forward/Reload (+reload ignoring cache), домашняя страница (set/unset).
- Закладки: звезда, редактирование (имя/URL), удаление, список в меню.
- Очистка данных страницы: storage / cookies / cache по отдельности и всё разом (хоткеи как у референса).
- Разрешения сайта: индикатор у адресной строки, просмотр/переключение Allow/Block/Ask по 8 типам, Reset All, инлайн-промпт при запросе от сайта, баннер «обновите страницу».
- HTTP Basic Auth модалка. Тумблер Allow insecure SSL.
- Popups/`window.open`: у ведущей вьюшки разрешены только http(s) — дочернее окно наследует `sandbox`/`contextIsolation`/`nodeIntegration:false`/партицию `persist:respo` (`security.ts: popupDecision`), его собственные popups запрещены, окна закрываются вместе с вьюшкой; у не-ведущих — тихий deny (раньше уходили во внешний браузер — фактическое поведение W5).

### 5.5 DevTools и инспектор
- DevTools на любой девайс: док снизу/справа (ресайз) или отдельное окно; переключение дока.
- Инспект-режим: клик по элементу в любом девайсе → DevTools этого девайса на выбранном узле (CDP Overlay + DOM).
- Контекстное меню страницы: Inspect Element, Open Console.

### 5.6 Скриншоты
- Пер-девайс: видимая область и полная страница (CDP `captureBeyondViewport`, без ресайза вьюшки).
- «Все девайсы» через очередь с лимитом; звук затвора; отчёт об итоге.
- Форматы PNG/JPEG, папка сохранения в настройках, показ файла в проводнике, копия в буфер.
- Опция масштаба: снимать в DPR 1 (компактный файл) или в нативном DPR девайса (полная детализация) — full-page на DPR 3 иначе даёт огромные файлы.

### 5.7 Инструменты дизайнера
- Линейки (canvas-полосы 20px вокруг рамки, шаг делений по зуму, отсчёт от scroll offset страницы) + направляющие (CSS-слой `html::after` в странице, размер = измеренные `clientWidth × scrollHeight`), persist по разрешению (W×H, ≤ 50 на ось), синхронизация с прокруткой через тот же rAF-поток preload'а (без нового IPC-потока). Rulers — session-режим; Alt+R, kebab, ⋯ → Debug ▸ Rulers on all devices.
- Design Overlay: макет выбирается `<input type=file>` в renderer (файл читается один раз в data URL, путь renderer не знает), картинки — в electron-store под отдельным ключом (content-id SHA-256, ≤ 10 MB на файл, 100 MB LRU); режимы Overlay (CSS-слой `html::before`: opacity 0–100, шторка `clip-path`) и Side-by-side (`<img>` рядом с рамкой, панорамирование в такт скроллу), persist по разрешению, вкл/выкл/удаление. **Ограничение (проверено):** CSP страницы `img-src` без `data:` блокирует фон инжектированного стиля — для таких страниц Side by side; `Page.setBypassCSP` отвергнут (маскировал бы CSP-баги разработчика).
- Симуляция зрения (пер-девайс и глобально): ровно список CDP `Emulation.setEmulatedVisionDeficiency` — blurredVision, reducedContrast, protanopia, deuteranopia, tritanopia, achromatopsia (рендерится компоузитором страницы, попадает в скриншоты, переживает навигацию). Катаракта/глаукома/«солнечный свет» из референса не делаются — CDP их не даёт, а SVG-фильтры были бы инъекцией в страницу (§7a). Индикатор в шапке девайса, когда override активен.
- Debug ▸ Outline all elements: insertCSS `* { outline: 1px solid … !important }` на всех девайсах, session-режим, реинжект после навигации, снимается без следа.

### 5.8 Live-reload локальных файлов
- Открыт `file://*.html` → автослежение за папкой страницы (html/htm/css/js/mjs, глубина 3); залп только из css — горячая подмена `href` стилей, прочее — reload всех девайсов; индикатор-точка в адресной строке (watching / paused, клик — пауза). Без локального сервера, без инъекций в обычные сайты. Уход с `file://` выключает вотчер.

### 5.9 Оболочка приложения
- Хоткеи — весь набор референса (back/forward/reload/reload ignoring cache, bookmark, edit URL, inspect, theme, zoom, layout cycle, rotate all, screenshot all, rulers (Alt+R: лид, иначе все), очистки) + модалка-справка.
- Настройки: папка скриншотов, Accept-Language override, формат скриншотов.
- Тема UI light/dark (независимо от эмуляции страниц). Язык UI — английский.
- `respo://` deep links, CLI-запуск с URL, `?urlToOpen=` при старте.
- Автообновление (факт W6): `electron-updater` + GitHub Releases; проверка при запуске не чаще раза в сутки (+ «Check now» в About, выключается в Settings); при наличии релиза — чип «Update to X» в топ-баре → клик → скачивание с процентами в чипе → «Restart to update» → тихая NSIS-установка и перезапуск. Никаких попапов. Выключено в dev/e2e и под `RESPO_NO_UPDATER=1`. About: версия, Electron/Chromium/Node, статус апдейтера, ссылки GitHub/Issues/Changelog, папка логов, Third-party notices. Файловый лог `userData/logs/main.log` (electron-log, без диалогов). Подробно — [`../../modules/updater.md`](../../modules/updater.md).
- Нативное меню: File/View/Help (Windows), полный набор на macOS позже.
- **Не делаем:** спонсорские попапы, release-notes попапы, нотификейшн-лента.

### 5.10 Emulation pack (W5)
- Один глобальный профиль (`emulation` в персистентности) — кнопка **Emulate** в тулбаре (поповер), подсвечена, пока хоть что-то переопределено; **Reset all** — одним кликом:
  - Color scheme light/dark, media type screen/print, reduced motion, forced colors — `Emulation.setEmulatedMedia` (features `prefers-color-scheme` / `prefers-reduced-motion` / `forced-colors`);
  - Network: Online / Fast 4G / Slow 4G / 3G / Offline — `Network.emulateNetworkConditions` (не действует на `file://`);
  - Location: пресеты городов или lat,lng — `Emulation.setGeolocationOverride` (разрешение geolocation спрашивается как обычно);
  - Locale (BCP 47, валидируется — Chromium принимает мусор) + timezone (IANA, Chromium отвергает мусор) — `Emulation.setLocaleOverride`/`setTimezoneOverride`; locale также пересылает UA-override с `acceptLanguage`.
- Vision — пер-девайс (kebab → Vision ▸) поверх глобального (§5.7); `deviceVision` в персистентности, кап 256 записей.
- Применение — по группам с диффом (меняется только то, что поменялось); override'ы переживают навигацию, реплей — только при реаттаче CDP.

### 5.11 Diagnostics (W5)
- На каждом девайсе `Runtime.enable`; `exceptionThrown` и `consoleAPICalled(error)` считаются в main и уходят в renderer батчами (`diagnostics`); чип **N errors** в шапке девайса (клик — DevTools этого девайса на панели Console). Счётчик сбрасывается при новом документе (`executionContextsCleared`).
- Overflow-скан: через 1 с после загрузки одноразовый `Runtime.evaluate` ищет элементы шире `documentElement.clientWidth`; результат — недоверенный, валидируется (кап элементов, длины строк). Чип **overflow** (клик — список; подсветка виновника insertCSS-слоем `outline`, «all»/«none»).
- Бюджет §8 соблюдается с включённой диагностикой (замер в отчёте W5).

## 6. Стейт и персистентность

Zustand-сторы renderer: `devices` (каталог+кастомные+сьюты), `navigation` (url, история, закладки, статусы загрузки), `layout` (раскладка, зум, individual-таб), `settings`, `panels` (devtools-док, модалки); инструменты W5 — по стору на модуль main: `emulation` (профиль + vision пер-девайс), `diagnostics`, `guides` (направляющие по `WxH`), `scroll` (refcount причин трекинга скролла — rulers/overlay), `design-overlay`, `watcher`, `debug` (session-only). Persist — через IPC в electron-store (renderer не пишет на диск сам). Схема хранилища версионируется (поле `schemaVersion` + миграции). Частые записи (направляющие, design overlay, история) — с debounce, не на каждое движение.

## 7. Обработка ошибок

- `render-process-gone` вьюшки → оверлей «страница упала», перезапуск одного девайса, остальные не затронуты.
- Отвал CDP → авто-реаттач + восстановление эмуляции; повторный отвал → пометка девайса, синхронизация остальных живёт.
- Ошибки загрузки → оверлей с кодом; aborted/iframe игнорируются.
- Скриншоты: ошибки не роняют пакет, отчёт N из M.
- IPC: типизация + валидация payload в main; неизвестные каналы отвергаются.
- Файлы (импорт устройств): понятная ошибка на битом JSON, транзакционный merge (всё или ничего).

## 7a. Безопасность

Respo — это браузер, загружающий произвольные сайты, поэтому:

- Все WebContentsView: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, без preload с привилегиями (вся логика — через CDP со стороны main).
- UI-renderer: contextBridge-мост с минимальной поверхностью, строгий CSP в index.html.
- URL из `respo://`, CLI и drag-and-drop валидируются: только `http:`, `https:`, `file:`; всё прочее отбрасывается.
- Разрешения сайтов: по умолчанию «спрашивать», ничего не выдаётся молча.
- `window.open`/popups: разрешены только у ведущего вьюпорта (уже в §5.4), навигация вьюшек на `file://` с не-file страниц блокируется.
- Allow insecure SSL — явный пользовательский тумблер, по умолчанию выключен.

## 8. Производительность (бюджеты)

- 10 одновременных вьюпортов, непрерывный скролл: без блокировок main event loop > 16 мс (замер: `perf_hooks.monitorEventLoopDelay` в main, p99 отчитывается в e2e).
- Синхронизация: ≤ 1 рассылка на кадр (rAF-коалесинг), O(devices) на кадр, без промежуточного сервера.
- События загрузки — батчами за кадр.
- Скриншоты — очередь, параллелизм ≤ 3.
- Виртуализация: вне экрана вьюшки не рендерят кадры.

## 9. Тестирование

- **Vitest:** SyncEngine-математика (нормализация координат, доля скролла), сторы (сьюты, закладки, история), нормализация URL, импорт/экспорт JSON, миграции схемы хранилища.
- **Playwright+Electron e2e:** смоук — запуск; загрузка URL на N девайсов; синхронный скролл/клик; full-page скриншот сохраняется; DevTools открывается и докается; кастомный девайс создаётся и переживает рестарт; очистка cookies работает.
- **Перф-тест:** сценарий из §8 как автоматизированная проверка.

## 9a. Риски и порядок их снятия

| # | Риск | Митигация |
|---|---|---|
| R1 | **Джиттер позиционирования WebContentsView**: вьюшки композитятся поверх UI отдельным слоем; при скролле/зуме канваса рамки (React) и вьюшки (setBounds из main) могут визуально разъезжаться. Риск №1 проекта. | Снимается **первым спайком** до основной разработки: rAF-батч всех setBounds за один проход; перехват wheel-событий канваса в main (позиции считает main, UI следует); если джиттер неустраним — план Б: канвас-скролл целиком на стороне main. Критерий: скролл канваса с 10 вьюшками визуально монолитен. |
| R2 | Пределы точности зеркалирования (фокус при наборе текста, lazy-load при скролле по доле) | Задокументированы в §4.2 как ожидаемое поведение; пер-девайс отключение синхронизации. |
| R3 | Хрупкость докинга DevTools (`setDevToolsWebContents` — малодокументированный API) | Изолировать в DevToolsManager; undocked-режим (`mode:'detach'`) как всегда работающий fallback. |
| R4 | Windows SmartScreen без подписи кода | Осознанно отложено (§10); для себя/ранних пользователей приемлемо, подпись — перед публичным релизом. |

## 10. Дистрибуция

- Windows (факт W6): NSIS one-click per-user инсталлятор `Respo-Setup-<version>.exe` (`npm run build:win`, `electron-builder.yml`), автообновление через GitHub Releases (`latest.yml` + `.blockmap`; после первого обновления загрузки дифференциальные). Релиз собирает GitHub Actions по тегу `v*` (`.github/workflows/release.yml`: draft-релиз с ассетами → тело из CHANGELOG через `scripts/release-notes.mjs` → publish); CI (`ci.yml`) на windows-latest — typecheck/lint/unit/e2e/build:unpack. Подпись кода — отложена (R4): SmartScreen предупреждает, README описывает «More info → Run anyway».
- macOS: отложено; архитектура не должна использовать win-only API вне изолированных мест.

## 11. Вне скоупа (сейчас)

- Браузерное расширение (у референса есть — не делаем).
- Сетевой троттлинг/прокси (в референсе тоже нет; кандидат в будущее через CDP `Network.emulateNetworkConditions`).
- Запись видео/GIF, облачная синхронизация настроек, мультиокно.

## 12. Структура проекта

```
respo/
  src/
    main/           # ViewManager, CDPController, SyncEngine, DevToolsManager,
                    # ScreenshotQueue, FileWatcher, Permissions, Auth, Protocol, store
    preload/        # мост IPC (contextBridge), минимальный
    renderer/       # React UI: components/, stores/, hooks/, lib/
    shared/         # ipc.ts (типизированные контракты), types.ts, deviceCatalog.ts
  e2e/              # Playwright
  docs/superpowers/specs/
```
