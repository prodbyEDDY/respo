# W2 «Sync + Suites» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (адаптация владельца: без пер-таск ревью, одно финальное ревью ветки).

**Goal:** Сердце продукта — зеркалирование взаимодействий между девайсами (SyncEngine) + полный Device Manager (каталог, кастомные девайсы, сьюты, импорт/экспорт) + персистентность + follow-ups W1.

**Architecture:** Спека §4.2 (SyncEngine), §5.2–5.3. Захват ввода ведущего — минимальный sandboxed-preload девайс-вьюшек (rAF-коалесинг, ipcRenderer→main); применение к последователям — CDP (`Input.dispatchMouseEvent/dispatchKeyEvent`, скролл — по доле документа через `Runtime.evaluate scrollTo`). Персистентность — electron-store через типизированный IPC.

**Tech Stack:** как W1 + dnd-kit, @fontsource/inter.

**Spec:** `docs/superpowers/specs/2026-08-28-respo-design.md` · Дизайн: `docs/design/DESIGN-SYSTEM.md` · Грабли: CLAUDE.md «Запуск и проверка».

## Global Constraints

Все из плана W1 (лицензии; только WebContentsView; CDP-first; rAF-коалесинг, никаких пер-событийных IPC; sandbox/contextIsolation; IPC только через `src/shared/ipc.ts` аддитивно; Zustand; renderer не пишет на диск; UI английский; UX-приоритет: просто/чисто/интуитивно, основное действие в 1 клик; коммиты с Co-Authored-By). Плюс:
- Preload девайс-вьюшек: sandbox-совместимый, только contextIsolated-захват ввода, никакого доступа к контенту страницы сверх координат/скролла/размеров; события к main — не чаще кадра.
- Шрифт: @fontsource/inter (OFL — разрешено для шрифтов ruling'ом координатора), self-hosted.
- Перф-бюджет: непрерывный скролл ведущего с 9 последователями — p99 event-loop main < 16 мс.

---

### Task 1: Персистентность (electron-store через IPC)

**Files:** Create `src/main/persistence.ts`, `src/shared/persistence-types.ts`; Modify `src/main/index.ts`, `src/shared/ipc.ts` (аддитивно), сторы renderer.
**Produces:** electron-store (`npm i electron-store`) c `schemaVersion: 1`; типы `PersistedState { schemaVersion; customDevices: DeviceSpec[]; suites: Suite[]; activeSuiteId: string; ui: { theme: ThemeSource } }`; `type Suite = { id: string; name: string; deviceIds: string[] }`; IPC `store:load → PersistedState` и `store:save(patch: Partial<PersistedState>) → void` (main мержит и пишет с debounce 300 мс; тест debounce с fake timers). Сторы `useDevices`/`useSettings` гидратируются при старте (`store:load`) и сохраняют изменения через `store:save`. Дефолт: сьют «Default» c 5 девайсами W1. Тесты: merge-патчей, миграционный скелет (unknown schemaVersion → дефолты + бэкап-ключ), debounce.
**Acceptance:** смена темы/сьюта переживает рестарт приложения (проверить руками в dev).

### Task 2: SyncEngine — main-сторона

**Files:** Create `src/main/sync-engine.ts`, `src/preload/device-view.ts` (новый preload для вьюшек), `src/main/__tests__/sync-engine.test.ts`; Modify `src/main/view-backend.ts` (подключить preload), `src/main/cdp-controller.ts` (методы dispatch), `src/shared/ipc.ts` (аддитивно).
**Produces:**
- Preload вьюшки (webPreferences.preload, sandbox:true остаётся): в isolated world слушает `wheel/scroll` (пассивно), `mousedown/mouseup/click`, `keydown/keyup`, коалесирует через rAF и шлёт `ipcRenderer.send('sync:input', InputEventPayload)` — не чаще кадра, пакетом. `InputEventPayload = { kind: 'scroll'; ratioX: number; ratioY: number } | { kind: 'mouse'; type: 'down'|'up'; xNorm: number; yNorm: number; button: 'left'|'middle'|'right' } | { kind: 'key'; type: 'down'|'up'; key: string; code: string; modifiers: number }` (нормализация: xNorm = clientX/innerWidth, ratio = scrollY/(scrollHeight-innerHeight), с защитой от деления на 0).
- `class SyncEngine { setLead(deviceId | null); setEnabled(deviceId, enabled); handleInput(sourceWcId, payload) }`: события применяются ко всем enabled-девайсам кроме источника; **источник = только текущий lead** (события не-лида игнорируются); mouse → `Input.dispatchMouseEvent` (координаты xNorm*width девайса), key → `Input.dispatchKeyEvent`, scroll → `Runtime.evaluate window.scrollTo({...ratio*max})` (throttle: не чаще кадра на девайс, последнее значение побеждает). Юнит-тесты: нормализация/денормализация координат, игнор не-лида, отключённые девайсы не получают, коалесинг «последний скролл побеждает».
- Валидация `sync:input` payload в main (числа конечны, 0..1 кламп).
**Acceptance:** dev-прогон: скролл одного девайса синхронно скроллит остальные без видимого лага; клик по ссылке на лиде кликает на последователях.

### Task 3: SyncEngine — UI + lead-election

**Files:** Create `src/renderer/src/stores/sync.ts` (+тест); Modify `DeviceFrame.tsx`, `TopBar.tsx`, `Canvas.tsx`, `src/shared/ipc.ts` (аддитивно: `sync:set-lead`, `sync:set-enabled`, `sync:set-global`).
**Produces:** `useSync()`: `{ globalEnabled: boolean; disabled: Record<string, boolean>; toggleGlobal(); toggleDevice(id) }` (persist через Task 1). Lead-election: `mouseenter` на DeviceFrame → `sync:set-lead(deviceId)` (rAF-дебаунс), уход с канваса → null. UI: маленький SYNC-чип в топ-баре (глобальный тумблер, primary-цвет при активе), в шапке девайса — иконка-тумблер зеркалирования (Heroicons `LinkIcon`/`LinkSlashIcon`, tooltip). Активный lead — тонкая primary-обводка рамки (transition 150ms). Также: пере-выбор lead при удалении девайса (follow-up W1) — в navigation store.
**Acceptance:** UX: всё понятно без объяснений; отключение девайса мгновенно исключает его из зеркалирования.

### Task 4: Device Manager — каталог + кастомные девайсы

**Files:** Create `src/renderer/src/components/device-manager/DeviceManagerView.tsx`, `DeviceCard.tsx`, `DeviceEditDialog.tsx`, стор-расширения в `devices.ts` (+тесты utils); Modify `App.tsx` (view-переключение), `TopBar.tsx` («+»-кнопка).
**Produces:** полноэкранный вид Device Manager (замещает канвас, ESC/крестик — назад): поиск по имени/`WxH`, секции «Default devices» (read-only, инфо) и «Custom devices»; создание/редактирование кастомного девайса — shadcn Dialog: name (уник.), width/height (число, 100–10000), dpr (0.5–4), type (phone/tablet/desktop → авто-UA при смене типа), userAgent (textarea), touch/rotatable-чекбоксы; удаление с подтверждением (удаляет из всех сьютов, минимум 1 девайс в активном сьюте — защита). `useDevices` расширяется: `customDevices`, `addCustom/updateCustom/removeCustom`, `allDevices` (каталог+кастомные). Персист через Task 1. Zustand-тесты CRUD+защит.
**Acceptance:** создать кастомный девайс → он появляется в сетке превью после добавления в активный сьют; переживает рестарт.

### Task 5: Сьюты — CRUD, состав, порядок, селектор, импорт/экспорт

**Files:** Create `src/renderer/src/components/device-manager/SuitesPanel.tsx`, `SuiteSelector.tsx` (TopBar), `src/shared/backup.ts` (+тесты); Modify `devices.ts` стор, `DeviceManagerView.tsx`, `TopBar.tsx`, `src/main/persistence.ts` (диалоги save/open через `dialog` в main: `backup:export`, `backup:import`).
**Produces:** стор: `suites`, `activeSuiteId`, `createSuite(name)` (дефолт iPhone 15 Pro), `deleteSuite` (нельзя последний), `setActiveSuite`, `toggleDeviceInSuite` (минимум 1), `reorderSuiteDevices(from,to)` (dnd-kit в SuitesPanel: чипы девайсов активного сьюта перетаскиваются). SuiteSelector в топ-баре: DropdownMenu с чекмарком активного + «Manage…» → Device Manager. Импорт/экспорт: `backup.ts` — `serializeBackup(state) → RespoBackupV1 {version:1; customDevices; suites}` и `parseBackup(json) → Result` (валидация структуры, merge по имени с перезаписью); main пишет/читает файл через системный диалог (renderer на диск не пишет). Reset: подтверждение → дефолтный сьют, кастомные удалены. Тесты: parse/serialize round-trip, битый JSON → ошибка, merge-семантика, защиты CRUD.
**Acceptance:** экспорт → файл; импорт на чистом состоянии восстанавливает; порядок девайсов в сетке = порядок в сьюте.

### Task 6: Follow-ups W1

**Files:** Modify `e2e/` (+clipping guard), `NavControls.tsx` + view-backend (back/forward enable-state в load-state батче: `canGoBack/canGoForward`), `DeviceFrame.tsx` (кнопка rotate девайса — только rotatable), `main.css` + `main.tsx` (@fontsource/inter, веса 400/500/600), `AddressBar.tsx` (лёгкая индикация невалидного URL — ring destructive 1.5s).
**Produces:** e2e-гард клиппинга: вьюшка, прокрученная под топ-бар, не рисуется поверх него (скриншот-проба области бара или bounds-проверка через CDP). `LoadStatePayload` аддитивно получает `canGoBack?/canGoForward?`; кнопки дизейблятся честно. Тесты обновлены.
**Acceptance:** `npm run e2e` зелёный (включая новый гард), Inter реально применяется (font-family проверка в e2e или руками).

---

## Definition of Done W2

typecheck/test/e2e зелёные; перф-бюджет синка соблюдён (замер в отчёте); финальное ревью ветки (Opus) + одна фикс-волна; отчёт `docs/progress/W2-...md`; ROADMAP §10/§11; CLAUDE.md-грабли пополнены при находках.
