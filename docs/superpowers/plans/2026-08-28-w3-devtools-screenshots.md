# W3 «DevTools + Screenshots» Implementation Plan

> Режим владельца: 2 диспатча, без пер-таск ревью, одно финальное ревью + фикс-волна (без реревью при e2e-доказательствах). Тесты — фокусно, полный набор один раз перед коммитом.

**Goal:** DevTools на каждый девайс (док/андок/ресайз, инспект-режим, контекстное меню) + полный скриншот-пайплайн (видимая область / full-page / все девайсы, очередь, настройки) + фикс zoom-viewport десктопов.

**Spec:** спека §5.5–5.6, §4.2 (DevToolsManager, ScreenshotQueue), §8 (очередь ≤3). Дизайн: DESIGN-SYSTEM.md. Constraints — как W1/W2 (лицензии, CDP-first, батчи, валидация IPC, renderer без диска, UX-приоритет, Co-Authored-By).

### Task 1: DevToolsManager (док/андок/ресайз)

**Files:** Create `src/main/devtools-manager.ts` (+тест), `src/renderer/src/components/devtools/DevtoolsDock.tsx`, стор `panels.ts`; Modify view-manager/index/ipc (аддитивно), TopBar/DeviceFrame (кнопка `</>` на девайсе).
**Produces:** карта viewId→DevTools (НЕ синглтон): dock bottom/right — отдельный WebContentsView + `setDevToolsWebContents` + `openDevTools({mode:'custom'})`, undocked — `{mode:'detach'}`; IPC `devtools:open(deviceId)`, `devtools:close`, `devtools:set-bounds(rect)` (rAF-батч из renderer-ресайзера), `devtools:set-dock('bottom'|'right'|'undocked')` (persist). DevtoolsDock: панель с ресайз-ручкой (re-resizable не нужен — свой drag на transform), заголовок: имя девайса, переключатель дока, кнопки undock/close. Канвас-рамки пересчитываются (док отъедает область — layout уже реагирует на размер контейнера). Никаких CSS-хаков внутри DevTools-фронтенда. Одновременно открыт максимум один док (открытие для другого девайса переключает цель) — undocked окон может быть много.
**Acceptance:** открыть DevTools девайса из шапки → док снизу; ресайз тянется плавно; переключение right/undocked работает; закрытие возвращает канвас.

### Task 2: Инспект-режим + контекстное меню

**Files:** Create `src/main/inspector.ts` (+тест); Modify cdp-controller (Overlay-методы), TopBar (кнопка inspect, `mod+i`), view-backend (context-menu), ipc.
**Produces:** глобальный инспект-тумблер: на всех вьюшках CDP `Overlay.enable` + `Overlay.setInspectMode('searchForNode', highlightConfig)`; по `Overlay.inspectNodeRequested` → открыть DevTools этого девайса (Task 1) и `DOM.inspect`-фокус на узле (через `Overlay.inspectNodeRequested` backendNodeId → `dom.setInspectedNode`/`Runtime` — использовать `devtools://` API `wc.inspectElement(x,y)` как простой fallback, если backendNode-путь хрупок; выбрать и задокументировать). Выход из режима — Esc/повторный клик/после выбора. Контекстное меню вьюшки (main, `context-menu` event): Inspect Element (→ `wc.inspectElement(x,y)` + открыть док), Open DevTools Console, Reload, Copy URL. 
**Acceptance:** mod+i → клик по элементу на любом девайсе открывает его DevTools на этом узле; правый клик — меню работает.

### Task 3: ScreenshotQueue (main)

**Files:** Create `src/main/screenshot-queue.ts` (+тесты очереди/имён), Modify cdp-controller (`Page.captureScreenshot`), persistence (настройки скриншотов), ipc.
**Produces:** очередь (конкуренция 3, fail одного не роняет пакет, отчёт N/M): `shot:device(deviceId, {fullPage, format})`, `shot:all({fullPage, format})` → результаты MainEvent-батчем (`shot-state`: queued/active/done/failed + путь). Захват: видимая область — `capturePage()`; full-page — CDP `Page.captureScreenshot {captureBeyondViewport:true, format}` при текущей эмуляции (вернуть/проверить метрики после); DPR-опция: 'device' | 1 (через временный `deviceScaleFactor` override — вернуть после). Файлы: `<саниz(имя девайса)>-<WxH>-<yyyyMMdd-HHmmss>[-N].png|jpg` в настраиваемую папку (default `%USERPROFILE%\Pictures\Respo`), защита от коллизий `-N`; `shot:copy(deviceId)` — capturePage → clipboard.writeImage; `shot:reveal(path)` — showItemInFolder (валидация: путь внутри папки скриншотов).
**Acceptance:** full-page скриншот высокой страницы содержит контент ниже фолда; «все девайсы» кладёт M файлов, отчёт при частичном фейле.

### Task 4: Скриншот-UI + настройки + zoom-фикс десктопов

**Files:** Create `src/renderer/src/components/settings/SettingsDialog.tsx`, стор `shots.ts` (+тест); Modify DeviceFrame (камера: клик = видимая область, alt+клик или сплит-меню = full-page; спиннер прогресса), TopBar (screenshot-all кнопка, `mod+s`), kebab (Settings…), main (эмуляция при зуме).
**Produces:** SettingsDialog (shadcn): папка скриншотов (кнопка «Choose…» → диалог в main), формат png/jpeg, DPR device/1 — persist. Тосты результатов (успех: путь + «Show in folder»; częściowy fail: N/M). Шаттер-фидбек: короткая вспышка рамки девайса (opacity, 150ms). **Zoom-фикс:** эмулируемая ширина/высота десктоп-девайсов (`mobile:false`) не должна зависеть от zoomFactor — фиксировать `Emulation.setDeviceMetricsOverride` шириной девайса всегда (как у мобильных) + e2e: desktop-девайс при zoom 0.5 видит `innerWidth === spec.width`.
**Acceptance:** e2e: зум-инвариант для десктопа; скриншоты из UI работают в обеих темах; настройки переживают рестарт.

## DoD W3
typecheck/test/e2e зелёные (полные прогоны — по разу на диспатч); финальное ревью + фикс-волна; отчёт progress/W3; ROADMAP; грабли → CLAUDE.md.
