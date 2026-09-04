# W5 «Production Core» — план реализации

> **Исполнитель:** один агент Fable 5.1 (длинная сессия), ветка `w5-core` от `main`.
> **Режим:** последовательные задачи, коммит после каждой, рабочий лог в `docs/progress/W5-log.md`
> (чтобы прерванную сессию можно было продолжить с середины). Механические подзадачи (перенос данных
> каталога, форматирование, массовые правки) — делегировать субагентам на дешёвых моделях
> (`model: "haiku"` / `"sonnet"`), не тратить Fable-контекст.
> **Заменяет** [2026-08-28-w5-designer-tools.md](2026-08-28-w5-designer-tools.md) (два Opus-worktree) — тот план не стартовал.

**Goal:** закрыть всё, что спека обещает на стороне страницы/CDP, и добавить must-have-фичи из
gap-листа конкурентов, чтобы после W5 Respo функционально превосходил Responsively и держал паритет
с Polypane по эмуляции/симуляциям. Оболочка (меню, апдейтер, иконка, CI, справка) — в W6.

**Источники:** спека §4.2, §5.1–5.8, §7, §7a, §8 · [research/2026-09-05-competitors.md](../../research/2026-09-05-competitors.md) §C ·
[research/2026-09-05-spec-vs-code.md](../../research/2026-09-05-spec-vs-code.md) · [design/DESIGN-SYSTEM.md](../../design/DESIGN-SYSTEM.md).

## Глобальные ограничения (из CLAUDE.md, обязательны)

- Зависимости — только MIT/Apache-2.0/BSD/ISC; GPL/AGPL и любой код/данные responsively-app запрещены.
- Только WebContentsView; всё «браузерное» — через один `webContents.debugger`-аттач (CDPController). `webContents.insertCSS`/`removeInsertedCSS` допустимы для CSS-слоёв (скроллбары, guides, overlay, outline) — это не «инжектируемый клиент-скрипт». Одноразовый `Runtime.evaluate` в isolated world допустим для диагностики (overflow finder, CSS hot-swap); никаких постоянных скриптов и локальных серверов.
- Никаких пер-событийных IPC-потоков: rAF-коалесинг, батчи, очереди. Новые события из main (консоль-ошибки, overflow-статус, watcher) — батчами через существующий `MainEvent`-канал по образцу `load-state-batcher`.
- Безопасность §7a: sandbox+contextIsolation везде, URL-валидация, разрешения «спрашивать».
- IPC только через `src/shared/ipc.ts` (в этой волне агент владеет им сам — единый хаб, все новые каналы регистрируются там с валидацией payload в main).
- Zustand; персистентность через IPC в electron-store, схема версионируется (`schemaVersion` + миграция), частые записи — debounce.
- UI: shadcn/ui + Tailwind + Heroicons, тексты UI — английский; дизайн-система — `docs/design/DESIGN-SYSTEM.md`, обе темы.
- **UX-приоритет владельца:** основное действие в 1 клик, ничего не требует объяснений, нет визуального шума; редкие действия — в overflow/kebab-меню, не в основном тулбаре. Любая активная эмуляция должна быть видна (индикатор), чтобы страница «странно выглядит» не было загадкой.
- Известные грабли — список в CLAUDE.md «Запуск и проверка» (StrictMode dispose-latch, `about:blank`-праймер, координаты CDP zoom-relative, mobile-эмуляция игнорирует page zoom, скриншот-клип в CSS-px, zustand-селекторы через useMemo, тесты фокусно).

## UX-карта новых элементов (чтобы не раздувать тулбар)

**Топ-бар** (сейчас: Nav · Address · notices · Clear · Suite · SYNC · Inspect · Theme · ⋯):
- Добавить **одну** кнопку **Emulate** (иконка `AdjustmentsHorizontalIcon`) слева от SYNC → Popover с секциями: *Appearance* (Color scheme: System/Light/Dark; Reduced motion; Forced colors), *Media* (screen/print), *Vision* (None + 6 CDP-типов), *Network* (Online / Fast 4G / Slow 4G / 3G / Offline), *Location* (Off / пресеты городов / Custom lat,lng), *Locale & timezone* (Off / язык-регион, timezone) — компактные сегменты и селекты, всё глобально на все девайсы. Кнопка показывает точку-бейдж, когда что-то активно; в popover — «Reset all».
- В ⋯-меню добавить: **Debug ▸** (Outline all elements — toggle; Rulers on all devices — toggle; Hide mobile scrollbars — toggle, по умолчанию on).
- Адресная строка: справа маленький индикатор **Watching** (пульсирующая точка + tooltip «Live reload: <file>»), видим только для `file://`; клик — пауза/возобновление.

**Шапка девайса** (сейчас: title · spinner · Mirror · Rotate · Shot▾ · DevTools):
- Добавить **⋯ (kebab)** последним: Reload · Reload ignoring cache · Scroll to top · Rulers (toggle) · Design overlay… · Vision ▸ (Inherit global / None / 6 типов) · Copy URL.
- Слева от Mirror — зона **статус-чипов** (появляются только при событии): красный `N errors` (клик → DevTools console этого девайса), янтарный `↔ overflow` (клик → подсветка виновников + список). Чипы компактные, mini-иконка + число.
- Оверлей «Page crashed» с кнопкой Restart — по образцу `LoadError`.

## Задачи

### Task 1: Emulation pack — media, vision, network, location, locale/timezone/Accept-Language
**Files:** `src/main/cdp-controller.ts` (новые методы), новый `src/main/emulation.ts` (EmulationManager: хранит глобальный профиль и пер-девайс override для vision, применяет ко всем вьюшкам, реаппликация при создании вьюшки и после навигации если CDP-настройка не переживает её — проверить и задокументировать), `src/shared/ipc.ts` (типы `EmulationProfile`, канал `emulation:set`/`emulation:get`, событие в `MainEvent`), `src/shared/persistence-types.ts` (слайс `emulation`, миграция схемы), renderer: `stores/emulation.ts`, `components/toolbar/EmulatePopover.tsx`, кнопка в `TopBar.tsx`, пункт Vision в kebab девайса (Task 5).
**CDP:** `Emulation.setEmulatedMedia({media, features:[{name:'prefers-color-scheme',value},{name:'prefers-reduced-motion',...},{name:'forced-colors',...}]})`; `Emulation.setEmulatedVisionDeficiency({type})` (типы: none, achromatopsia, blurredVision, deuteranopia, protanopia, tritanopia, reducedContrast — проверить поддержку в текущем Chromium, неподдерживаемые скрыть); `Network.emulateNetworkConditions({offline, latency, downloadThroughput, uploadThroughput})` с пресетами как в DevTools (Fast 4G / Slow 4G / 3G); `Emulation.setGeolocationOverride({latitude, longitude, accuracy})` / `clearGeolocationOverride` (пресеты: 6–8 городов + custom; геопермишен остаётся «спрашивать» — при выборе локации показать подсказку в popover); `Emulation.setTimezoneOverride({timezoneId})`, `Emulation.setLocaleOverride({locale})` и Accept-Language через `Network.setUserAgentOverride({userAgent, acceptLanguage, ...})` (объединить с Task 2 — один вызов UA-override собирает всё).
**DoD:** все настройки применяются ко всем вьюшкам мгновенно и к новым; переживают навигацию и рестарт (persist); кнопка Emulate показывает бейдж активности; Reset all сбрасывает всё; юниты на EmulationManager (fake CDP) и стор; e2e: `emulation-pack.spec.ts` — страница-фикстура печатает `matchMedia('(prefers-color-scheme: dark)').matches`, `navigator.language`, `Intl.DateTimeFormat().resolvedOptions().timeZone`, и это меняется от настроек; offline даёт ошибку загрузки на всех девайсах.

### Task 2: Честная эмуляция — UA Client Hints
**Files:** `src/shared/deviceCatalog.ts` (тип устройства: `platform`, `platformVersion`, `model`, `architecture`, `mobile` — с дефолтами по типу), `src/main/cdp-controller.ts` (`Network.setUserAgentOverride` с `userAgentMetadata: {brands, fullVersionList, platform, platformVersion, architecture, model, mobile}`; brands собирать из версии Chromium приложения `process.versions.chrome`), тесты.
**DoD:** фикстура печатает `navigator.userAgentData.mobile/platform/brands` и они соответствуют девайсу (e2e в `emulation.spec.ts`); кастомные девайсы получают метаданные по типу.

### Task 3: Каталог устройств 90+
**Files:** `src/shared/deviceCatalog.ts`, `src/shared/__tests__/deviceCatalog.test.ts`, `docs/` (источник и лицензия), `NOTICE.md` (атрибуция BSD-3 Chromium DevTools).
**Что:** перенести актуальные устройства из Chromium DevTools `front_end/models/emulation/EmulatedDevices.ts` (BSD-3-Clause) — телефоны/планшеты/десктопы/складные, с W×H, DPR, UA, type, touch/rotatable, Client-Hints-метаданными; плюс актуальные линейки 2025–2026 (iPhone 16/17, Pixel 9/10, Galaxy S25, iPad Pro M4, современные ноутбуки/мониторы 1366/1536/1920/2560) из открытых справочников. **Запрещено** брать список Responsively. Перенос данных — делегировать субагенту (`model: "sonnet"`), а самому проверить тестами: уникальные id/имена, sane-размеры, DPR ∈ [1,4], UA непустой, ≥ 90 записей, дефолтный сьют по-прежнему валиден и содержит 5 узнаваемых устройств.
**DoD:** ≥ 90 устройств, поиск в Device Manager по ним работает, персистентные кастомные девайсы/сьюты пользователей не ломаются (миграция id — если id старых устройств меняются, сохранить старые id).

### Task 4: Надёжность страницы — crash overlay, scroll-to-top, reload ignoring cache, hide mobile scrollbars, popups у лидера
**Files:** `src/main/view-backend.ts`/`view-manager.ts` (`render-process-gone` → событие `LoadState 'crashed'` + `view:restart`), `src/shared/ipc.ts` (`nav:reload` с `{ignoreCache}`; `view:scrollToTop`; `view:restart`), `DeviceFrame.tsx` (оверлей Crashed + Restart; пункты kebab), `src/main/security.ts` + `view-backend.ts` (`setWindowOpenHandler`: для **ведущего** вьюпорта — `action:'allow'` с `overrideBrowserWindowOptions` (sandbox, contextIsolation, `partition:'persist:respo'`, без preload, `nodeIntegration:false`), только http/https; для остальных — deny; спека §5.4/§7a), `src/main/index.ts` (insertCSS `::-webkit-scrollbar{display:none}` для `mobile`-девайсов; сначала проверить — если mobile-эмуляция уже даёт overlay-скроллбары, задокументировать и пропустить), хоткей `Mod+Shift+R` (reload ignoring cache).
**DoD:** e2e: убить рендерер девайса (`webContents.forcefullyCrashRenderer()` через тест-хук) → оверлей и Restart возвращает страницу, остальные девайсы живы; popup с лидера открывается окном с общей сессией, с последователя — не открывается; юниты на новые каналы/валидацию.

### Task 5: Kebab-меню девайса + per-device Vision override
**Files:** `DeviceFrame.tsx` (компонент `DeviceMenu`), `stores/emulation.ts` (override по deviceId), `EmulationManager` (per-device приоритет над глобальным).
**DoD:** два одинаковых девайса в сьюте, у одного Deuteranopia — визуально разные (e2e через `Page.captureScreenshot` и сравнение средних цветов фикстуры), пункт «Inherit global» возвращает к глобальному.

### Task 6: Console errors badge + horizontal overflow detector
**Files:** новый `src/main/diagnostics.ts` (включить `Runtime` на вьюшках, слушать `Runtime.exceptionThrown` и `Runtime.consoleAPICalled` type error/assert, считать по deviceId с момента последней навигации; после `did-finish-load` и с debounce после `Page.frameResized`/скролла — одноразовый `Runtime.evaluate` в isolated world: `document.documentElement.scrollWidth > document.documentElement.clientWidth` + список до 10 элементов, чей `getBoundingClientRect().right > clientWidth`, вернуть селекторы (tag#id.class) и размеры), батч-событие `diagnostics` в `MainEvent` (коалесинг за кадр по образцу load-state-batcher), `src/shared/ipc.ts` (`diagnostics:highlight` → `Overlay.highlightNode`/`DOM.querySelector` для подсветки виновников; `diagnostics:clearHighlight`), renderer: `stores/diagnostics.ts`, чипы в `DeviceFrame.tsx` (`N errors` → открыть DevTools console девайса; `↔ overflow` → Popover со списком элементов, hover по элементу подсвечивает его в странице, «Highlight all»).
**Перф:** `Runtime.enable` на N вьюшках — проверить, что p99 event-loop main не растёт (perf-монитор `src/main/perf.ts`); консоль-события агрегировать (счётчик + последние 20 сообщений на девайс), не стримить каждое сообщение.
**DoD:** фикстура с `console.error` и `throw` → чип «2 errors»; фикстура с элементом `width:120vw` → чип «overflow» на мобильных девайсах и его нет на десктопе шире элемента; клик показывает селектор виновника; e2e `diagnostics.spec.ts`.

### Task 7: Линейки и направляющие
**Files:** renderer `components/previewer/Rulers.tsx`, `lib/rulers.ts` (геометрия: деления в CSS-px девайса с учётом зума и поворота), `stores/guides.ts` (persist по `WxH`, debounce), `src/main/guides.ts` (insertCSS-слой: линии направляющих внутри страницы — `html::after` с `background: linear-gradient(...)` на позициях, `pointer-events:none`, `z-index:2147483647`, `position:absolute` → скроллятся вместе с документом; реинжект после навигации), `src/shared/ipc.ts` (`guides:set {deviceId, h:number[], v:number[]}`), kebab-пункт Rulers и Debug ▸ «Rulers on all», хоткей `Alt+R` (лид-девайс).
**Архитектурный факт:** нативная вьюшка композитится выше DOM — DOM-элементы над страницей невидимы, а drag через область вьюшки не доходит до renderer. Поэтому: линейки (24px) — DOM **вне** прямоугольника вьюшки (рамка расширяется при включении), **линии направляющих — внутри страницы через CSS**, а **вся интеракция — на полосе линейки**: клик по линейке создаёт направляющую в этой позиции, маркер на линейке тянется вдоль неё, double-click/drag за край линейки — удаляет; значение позиции — tooltip. Скролл страницы: линейки следуют за scroll-позицией (уже приходит в sync-данных — переиспользовать, **не** создавать новый поток).
**DoD:** направляющие на 320×568 и на 1440×900 хранятся отдельно и переживают рестарт; линии видны на скриншоте страницы (e2e: пиксель нужного цвета в `Page.captureScreenshot`); при зуме 50% деления линеек и линии совпадают с CSS-px страницы.

### Task 8: Design Overlay
**Files:** renderer `components/previewer/DesignOverlayDialog.tsx` (загрузка изображения через main-диалог → data URL, кап 10 MB; opacity-слайдер; режим Overlay / Side-by-side; шторка (clip-path inset слева-направо) для Overlay; Enable/Disable/Remove), `stores/design-overlay.ts` (persist по `WxH`, изображение — в отдельном ключе persistence с лимитом 100 MB суммарно и LRU), `src/main/design-overlay.ts` (insertCSS: `html::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:<imgW>px;height:<imgH>px;background:url(data:...) no-repeat;opacity:X;clip-path:inset(0 0 0 Y%);pointer-events:none;z-index:2147483646}` — скроллится с документом; реинжект после навигации), side-by-side — чисто renderer (изображение рядом с рамкой, синхронный вертикальный сдвиг по scroll-доле).
**DoD:** overlay виден на скриншоте страницы, opacity/шторка меняют результат, side-by-side не трогает страницу; переживает навигацию и рестарт; при 10 MB+ — понятная ошибка. Если CSS-путь окажется хрупким на каких-то страницах (CSP страницы не влияет на insertCSS — проверить), задокументировать.

### Task 9: Live-reload для file://
**Files:** новый `src/main/file-watcher.ts` (chokidar v4, MIT: следить за html-файлом + соседними `**/*.{css,js,html}` до глубины 3, ignore `node_modules`/`.git`; debounce 100 мс, коалесинг залпа изменений; css → попытка hot-swap через одноразовый `Runtime.evaluate` (перезапись `href` у `<link rel=stylesheet>` с cache-bust) на всех вьюшках, иначе/прочее → `Page.reload` всех; стоп при уходе с `file://`; никаких вотчеров для http(s)), `src/shared/ipc.ts` (событие `watcher` в `MainEvent`: `{state:'watching'|'paused'|'off', file, lastReloadAt}`; `watcher:toggle`), renderer индикатор в `AddressBar.tsx`.
**DoD:** e2e: открыть фикстуру `file://`, изменить css → цвет элемента меняется без полной перезагрузки (или с ней — но не позже 500 мс), изменить html → reload; переход на http → индикатор пропадает и вотчер остановлен (проверка через тест-хук).

### Task 10: Debug ▸ Outline all elements
**Files:** `src/main/debug-css.ts` (insertCSS `*{outline:1px solid rgba(255,62,0,.6)!important}` — переключаемо, реинжект после навигации), пункт в ⋯ → Debug, стор.
**DoD:** toggle применяется ко всем девайсам, снимается без следа.

### Task 11: Документация, ревью, отчёт
- Обновить: спеку (§5.4 popups — фактическое поведение; §3 хоткеи — `tinykeys` заменён ручной реализацией или мигрировать, решить и записать; §5.2 — каталог; новая секция «Emulation pack», «Diagnostics»), `docs/README.md` (реверс-доки модулей: краткие описания новых модулей main в `docs/modules/` — по одному файлу на модуль: назначение, каналы IPC, CDP-методы, грабли), `CLAUDE.md` (новые грабли — только реально обнаруженные).
- Финальное ревью ветки: запустить субагента-ревьюера (`model: "opus"`) по диффу `main..w5-core` с чек-листом (безопасность §7a, перф §8, IPC-валидация, лицензии новых зависимостей), закрыть все Critical/Important.
- Отчёт `docs/progress/W5-production-core-2026-09-XX.md` по образцу W4-отчёта: что сделано, метрики (юниты/e2e/p99), решения, follow-ups.

## Порядок и коммиты
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Коммит после каждой задачи (осмысленное сообщение, футер `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`). Полный `npm test` + `npm run e2e` — по разу на задачу максимум, фокусные прогоны — по ходу. Перед финалом: `npm run typecheck && npm run lint && npm test && npm run e2e` — все зелёные, вывод в отчёт.

## DoD волны
Все 11 задач закрыты; typecheck/lint/unit/e2e зелёные; p99 event-loop main при 10 девайсах и включённой диагностике ≤ 16 мс (замер в отчёте); спека и доки актуальны; ветка `w5-core` готова к ревью координатора (не мержить самому).
