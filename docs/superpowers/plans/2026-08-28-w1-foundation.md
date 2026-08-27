# W1 «Foundation» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Работающий каркас Respo: окно с топ-баром и адресной строкой, N девайс-вьюпортов (WebContentsView) с честной CDP-эмуляцией, скролл/зум канваса без джиттера (снят риск R1), светлая+тёмная тема на токенах дизайн-системы.

**Architecture:** Main-процесс владеет WebContentsView через ViewManager и CDP через CDPController; renderer (React+Zustand) рисует рамки и шлёт rAF-батчи прямоугольников; весь IPC типизирован в `src/shared/ipc.ts`. Спека §4.

**Tech Stack:** Electron 33+ (WebContentsView), electron-vite, TypeScript strict, React 18, Tailwind v4, shadcn/ui, Zustand, electron-store, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-28-respo-design.md` (+ дизайн-токены: `docs/design/DESIGN-SYSTEM.md`, `docs/design/FAMILY-STYLE-REFERENCE.md`)

## Global Constraints

- Лицензии зависимостей: только MIT/Apache-2.0/BSD/ISC; GPL/AGPL и любой код responsively-app запрещены (CLAUDE.md §1).
- Только `WebContentsView`; `<webview>`/BrowserView запрещены (CLAUDE.md §2).
- Вьюшки: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; партиция `persist:respo` (спека §7a, §4.2).
- Никаких пер-событийных IPC: только rAF-коалесинг/батчи (спека §8).
- IPC-каналы только через `src/shared/ipc.ts`; renderer на диск не пишет (CLAUDE.md §6–7).
- UI-тексты — английский; доки — русский. Анимации только transform/opacity 120–180ms (DESIGN-SYSTEM.md).
- Коммиты атомарные с `Co-Authored-By: Claude Opus <noreply@anthropic.com>`.
- Перф-инвариант W1: скролл канваса с 10 вьюшками — визуально монолитен, p99 event-loop delay main < 16ms.

---

### Task 1: Scaffold (electron-vite + TS strict + Tailwind v4 + shadcn)

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/assets/main.css`
- Create: `components.json` (shadcn), `.npmrc`

**Interfaces:**
- Produces: команды `npm run dev`, `npm run typecheck`, `npm test`, `npm run build`; алиасы `@renderer/*`, `@shared/*` (`src/shared/*`).

- [ ] **Step 1: Скаффолд electron-vite**

```bash
npm create @quick-start/electron@latest . -- --template react-ts --skip-git
npm i
```

Если генератор отказывается работать в непустой папке — скаффолдить во временную подпапку и перенести содержимое (docs/, .claude/, CLAUDE.md, .gitignore не трогать; .gitignore — смержить).

- [ ] **Step 2: TS strict + алиасы**

В оба tsconfig: `"strict": true, "noUncheckedIndexedAccess": true`. В `electron.vite.config.ts` renderer-алиасы `@renderer` → `src/renderer/src`, `@shared` → `src/shared` (и в tsconfig paths).

- [ ] **Step 3: Tailwind v4 + shadcn**

```bash
npm i tailwindcss @tailwindcss/vite
npx shadcn@latest init
npm i @heroicons/react zustand
```

`main.css`: `@import "tailwindcss";` + блок `@theme` из FAMILY-STYLE-REFERENCE.md (секция Tailwind v4).

- [ ] **Step 4: Vitest**

```bash
npm i -D vitest
```

`package.json` scripts: `"test": "vitest run"`, `"typecheck": "npm run typecheck:node && npm run typecheck:web"` (electron-vite шаблон это уже даёт — проверить). Smoke-тест `src/shared/__tests__/smoke.test.ts`: `expect(1+1).toBe(2)`.

- [ ] **Step 5: Проверка и коммит**

Run: `npm run typecheck && npm test && npm run dev` (окно открывается, App рендерится).
Проверить лицензии добавленных пакетов: `npx license-checker-rseidelsohn --summary` — не должно быть GPL/AGPL.

```bash
git add -A && git commit -m "feat: electron-vite scaffold, TS strict, Tailwind v4, shadcn, vitest"
```

### Task 2: Токены темы + light/dark переключение

**Files:**
- Modify: `src/renderer/src/assets/main.css`
- Create: `src/renderer/src/stores/settings.ts`, `src/renderer/src/stores/__tests__/settings.test.ts`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Produces: `useSettings()` (Zustand): `{ theme: 'light'|'dark'|'system', resolvedTheme: 'light'|'dark', setTheme(t) }`; CSS-переменные shadcn (`--background`, `--card`, `--primary`, ...) в обоих режимах.

- [ ] **Step 1: Тест стора**

```ts
import { describe, it, expect } from 'vitest'
import { useSettings } from '../settings'

describe('settings store', () => {
  it('defaults to system theme', () => {
    expect(useSettings.getState().theme).toBe('system')
  })
  it('setTheme dark resolves dark and toggles class', () => {
    useSettings.getState().setTheme('dark')
    expect(useSettings.getState().resolvedTheme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
```

Run: `npm test` → FAIL (store не существует). (Vitest environment: jsdom — `npm i -D jsdom`, `environment: 'jsdom'` в конфиге для renderer-тестов.)

- [ ] **Step 2: Реализация стора + CSS-токены**

`settings.ts`: Zustand-store; `setTheme` пишет класс `dark` на `document.documentElement`; `system` слушает `matchMedia('(prefers-color-scheme: dark)')`.

`main.css` — shadcn-переменные из таблицы DESIGN-SYSTEM.md:

```css
:root {
  --background: #fbfaf9; --foreground: #343433;
  --card: #ffffff; --card-foreground: #474645;
  --muted: #f2f0ed; --muted-foreground: #7e7e7d;
  --primary: #0086fc; --primary-foreground: #ffffff;
  --secondary: #f6f4ef; --secondary-foreground: #121212;
  --destructive: #ff2b3a; --border: #f2f0ed; --ring: #0086fc;
  --radius: 10px;
}
.dark {
  --background: #151413; --foreground: #f2f0ed;
  --card: #1e1d1b; --card-foreground: #c9c7c4;
  --muted: #2a2927; --muted-foreground: #8a8886;
  --primary: #4da3ff; --primary-foreground: #10131a;
  --secondary: #242322; --secondary-foreground: #f2f0ed;
  --destructive: #ff2b3a; --border: #2a2927; --ring: #4da3ff;
}
```

- [ ] **Step 3: Проверка и коммит**

Run: `npm test` → PASS; `npm run dev` — переключить тему временной кнопкой в App, обе темы соответствуют DESIGN-SYSTEM.md.

```bash
git add -A && git commit -m "feat: design tokens light/dark, settings store"
```

### Task 3: Типизированный IPC-слой

**Files:**
- Create: `src/shared/ipc.ts`, `src/shared/__tests__/ipc.test.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/main/ipc.ts`

**Interfaces:**
- Produces:
  - `src/shared/ipc.ts`: `type IpcInvokeMap = { 'app:get-version': { args: []; result: string }; 'views:set-layout': { args: [ViewRect[]]; result: void }; 'nav:navigate': { args: [string]; result: void } }` (расширяется задачами ниже); `type ViewRect = { deviceId: string; x: number; y: number; width: number; height: number; zoom: number }`; `type MainEvent = { type: 'load-state'; payload: LoadStatePayload[] }`; `type LoadStatePayload = { deviceId: string; state: 'loading'|'ready'|'failed'; url: string; title?: string; errorCode?: number; errorDesc?: string }`; `function normalizeUrl(input: string): string | null` (авто-https, http для localhost/127.0.0.1, null для запрещённых схем).
  - preload: `window.respo = { invoke<K extends keyof IpcInvokeMap>(channel: K, ...args): Promise<result>, onMainEvent(cb: (e: MainEvent) => void): () => void }`.
  - `src/main/ipc.ts`: `registerHandler<K>(channel: K, handler)` — единственная точка регистрации.

- [ ] **Step 1: Тесты normalizeUrl**

```ts
import { normalizeUrl } from '../ipc'
it('adds https by default', () => expect(normalizeUrl('example.com')).toBe('https://example.com/'))
it('adds http for localhost', () => expect(normalizeUrl('localhost:3000')).toBe('http://localhost:3000/'))
it('keeps explicit scheme', () => expect(normalizeUrl('http://a.dev')).toBe('http://a.dev/'))
it('allows file:', () => expect(normalizeUrl('file:///C:/x.html')).toBe('file:///C:/x.html'))
it('rejects javascript:', () => expect(normalizeUrl('javascript:alert(1)')).toBeNull())
```

Run → FAIL.

- [ ] **Step 2: Реализация** `ipc.ts` (типы + normalizeUrl через `new URL` с try/catch), preload-мост через `contextBridge.exposeInMainWorld`, `registerHandler` с проверкой канала.

- [ ] **Step 3: Проверка и коммит**

Run: `npm run typecheck && npm test` → PASS. `npm run dev`: в консоли renderer `await window.respo.invoke('app:get-version')` возвращает версию.

```bash
git add -A && git commit -m "feat: typed IPC layer with url normalization"
```

### Task 4: ViewManager + канвас (СПАЙК R1 внутри)

**Files:**
- Create: `src/main/view-manager.ts`
- Modify: `src/main/index.ts`, `src/main/ipc.ts`
- Create: `src/renderer/src/components/previewer/Canvas.tsx`, `src/renderer/src/components/previewer/DeviceFrame.tsx`
- Create: `src/renderer/src/hooks/useViewRects.ts`

**Interfaces:**
- Consumes: `IpcInvokeMap['views:set-layout']`, `ViewRect` из Task 3.
- Produces: `class ViewManager { syncDevices(devices: DeviceSpec[]): void; applyLayout(rects: ViewRect[]): void; navigateAll(url: string): void; destroy(): void }`; `type DeviceSpec = { id: string; name: string; width: number; height: number; dpr: number; userAgent: string; touch: boolean }` (в `src/shared/types.ts`). Renderer: `useViewRects(containerRef)` — измеряет рамки через `getBoundingClientRect`, шлёт `views:set-layout` не чаще раза на rAF (и на scroll, и на resize через ResizeObserver).

- [ ] **Step 1: ViewManager** — создаёт `WebContentsView` на девайс (`webPreferences: { sandbox: true, contextIsolation: true, partition: 'persist:respo' }`), `contentView.addChildView`, `applyLayout` применяет все bounds одним синхронным проходом. `DeviceFrame` рендерит шапку (имя, W×H) и пустой прямоугольник-плейсхолдер под вьюшку.

- [ ] **Step 2: СПАЙК R1 — критерий приёмки задачи.** В `App.tsx` временно захардкодить 10 устройств, загрузить `https://example.com` во все. Скролл канваса (колесо/тачпад) и resize окна: вьюшки не отстают от рамок визуально (запись экрана или глаз — дёрганье недопустимо). Если джиттер есть — включить план Б из спеки §9a (wheel-перехват: renderer шлёт только дельту скролла, позиции всех рамок считает main) и зафиксировать результат в отчёте задачи.

- [ ] **Step 3: Перф-замер** — в `src/main/index.ts` dev-only: `monitorEventLoopDelay` из `perf_hooks`, лог p99 раз в 5с. Прогнать 30с непрерывного скролла: p99 < 16ms.

- [ ] **Step 4: Коммит**

```bash
git add -A && git commit -m "feat: ViewManager + canvas layout sync (R1 spike passed)"
```

### Task 5: Каталог устройств + стор + сетка

**Files:**
- Create: `src/shared/deviceCatalog.ts`, `src/shared/__tests__/deviceCatalog.test.ts`
- Create: `src/renderer/src/stores/devices.ts`
- Modify: `src/renderer/src/App.tsx` (заменить хардкод Task 4 на стор)

**Interfaces:**
- Consumes: `DeviceSpec` из Task 4.
- Produces: `DEVICE_CATALOG: DeviceSpec[]` (≥25 актуальных устройств); `useDevices()`: `{ active: DeviceSpec[]; setActive(ids: string[]): void }` (дефолт: iPhone 15 Pro, Pixel 8, iPad Mini, MacBook 1280, Desktop 1440 — как на утверждённом концепте).

- [ ] **Step 1: Каталог.** Источник данных: Chromium DevTools emulated devices (BSD-3) — взять метрики (имя, W×H, DPR, UA, touch) для: iPhone SE/14/15 Pro/15 Pro Max, Pixel 7/8, Galaxy S20 Ultra, iPad Mini/Pro 11, Surface Pro 7, MacBook 1280×800, Desktop 1440×900, Desktop 1920×1080 и др. Данные переписать как собственный TS-массив (не копировать файл целиком). Тест: каталог непуст, id уникальны, все width/height/dpr > 0, UA непустые.

- [ ] **Step 2: Стор + подключение.** `useDevices` (Zustand); App строит `DeviceFrame` из `active`, `useViewRects` продолжает слать layout.

- [ ] **Step 3: Проверка и коммит**

Run: `npm run typecheck && npm test`; `npm run dev` — 5 дефолтных девайсов рендерят страницу.

```bash
git add -A && git commit -m "feat: device catalog and devices store"
```

### Task 6: CDP-эмуляция устройств

**Files:**
- Create: `src/main/cdp-controller.ts`
- Modify: `src/main/view-manager.ts`
- Create: `e2e/emulation.spec.ts` (+ `playwright.config.ts`, `npm i -D @playwright/test playwright`)

**Interfaces:**
- Consumes: `DeviceSpec`.
- Produces: `class CDPController { attach(wc: WebContents): Promise<void>; applyDevice(wc, spec: DeviceSpec): Promise<void>; detachSafe(wc): void }` — `attach` один раз на view (`wc.debugger.attach('1.3')` + обработчик `detach` с реаттачем), `applyDevice` шлёт `Emulation.setDeviceMetricsOverride {width, height, deviceScaleFactor, mobile}`, `Emulation.setTouchEmulationEnabled`, `Network.setUserAgentOverride`.

- [ ] **Step 1: e2e-тест эмуляции** (Playwright `_electron.launch`): приложение грузит `data:` страницу, которая пишет `innerWidth/devicePixelRatio/navigator.userAgent/maxTouchPoints` в title; тест ждёт и проверяет, что у вьюшки «iPhone 15 Pro» — 393 / 3 / iPhone-UA / touch>0. Run → FAIL.

- [ ] **Step 2: Реализация** CDPController, вызов из ViewManager при создании вьюшки и при смене девайса.

- [ ] **Step 3: Проверка и коммит**

Run: `npm run e2e` → PASS; `npm run dev` — mobile-сайты отдают мобильную вёрстку.

```bash
git add -A && git commit -m "feat: CDP device emulation (metrics, touch, UA)"
```

### Task 7: Топ-бар + адресная строка + статусы загрузки

**Files:**
- Create: `src/renderer/src/components/toolbar/TopBar.tsx`, `AddressBar.tsx`, `NavControls.tsx`
- Create: `src/renderer/src/stores/navigation.ts`, `src/renderer/src/stores/__tests__/navigation.test.ts`
- Modify: `src/main/view-manager.ts` (навигация + события загрузки батчами), `src/shared/ipc.ts` — только wiring-сниппетом координатору

**Interfaces:**
- Consumes: `normalizeUrl`, `nav:navigate`, `MainEvent('load-state')` из Task 3; ViewManager из Task 4.
- Produces: `useNavigation()`: `{ url: string; perDevice: Record<string, LoadStatePayload>; navigate(input: string): void; back(): void; forward(): void; reload(): void }`. Main шлёт `load-state` батчами (сборка изменений, flush раз в кадр через `setImmediate`-коалесинг). UI: TopBar по утверждённому концепту (shadcn Button/Input/DropdownMenu, Heroicons), спиннер в шапке девайса при `loading`, оверлей ошибки при `failed` (aborted -3 и iframe-ошибки игнорируются).

- [ ] **Step 1: Тест стора навигации** — `navigate('example.com')` вызывает invoke с `https://example.com/` (mock `window.respo`), `load-state` батч обновляет `perDevice`. Run → FAIL.
- [ ] **Step 2: Реализация** стора, TopBar/AddressBar (Enter → navigate, select-all по фокусу), back/forward/reload через ViewManager (`wc.navigationHistory`), батчер событий в main.
- [ ] **Step 3: Проверка и коммит**

Run: `npm run typecheck && npm test && npm run e2e`; `npm run dev` — ввод URL грузит все девайсы, спиннеры и ошибки работают, битый домен даёт оверлей.

```bash
git add -A && git commit -m "feat: top bar, address bar, batched load states"
```

### Task 8: Зум и поворот

**Files:**
- Modify: `src/renderer/src/stores/layout.ts` (создать), `Canvas.tsx`, `DeviceFrame.tsx`, `src/main/view-manager.ts`
- Create: `src/renderer/src/stores/__tests__/layout.test.ts`

**Interfaces:**
- Consumes: `ViewRect.zoom`, ViewManager, `useDevices`.
- Produces: `useLayout()`: `{ zoom: number; zoomIn(): void; zoomOut(): void; setZoom(z: number): void; rotated: Record<string, boolean>; rotate(id: string): void; rotateAll(): void }`; ступени зума `[0.25,0.33,0.5,0.67,0.75,0.9,1,1.1,1.25,1.5,2]`; ViewManager при `rect.zoom !== 1` ставит `wc.setZoomFactor(zoom)` (CDP-метрики не трогает). Поворот меняет W↔H в рамке и в `Emulation.setDeviceMetricsOverride`, только для touch-девайсов.

- [ ] **Step 1: Тест стора** — zoomIn/zoomOut идут по ступеням и клампятся; rotate переворачивает только touch-девайс. Run → FAIL.
- [ ] **Step 2: Реализация** + кнопки в TopBar (rotate-all) и ctrl+колесо на канвасе (плавный зум с клампом 0.25–2).
- [ ] **Step 3: Проверка и коммит**

Run: `npm run typecheck && npm test`; `npm run dev` — зум не ломает media queries (страница остаётся «мобильной»), поворот работает.

```bash
git add -A && git commit -m "feat: canvas zoom and device rotation"
```

---

## Definition of Done W1

- Все задачи закоммичены, `npm run typecheck` / `npm test` / `npm run e2e` зелёные.
- Критерий R1 из Task 4 зафиксирован (джиттера нет / включён план Б — отражено в отчёте волны).
- Обе темы соответствуют DESIGN-SYSTEM.md.
- Отчёт волны в `docs/progress/W1-foundation-<дата>.md`; ROADMAP §10/§11 обновлены координатором.

## Волновая карта после W1 (планы пишутся по мере приёмки)

W2 — SyncEngine + сьюты/Device Manager · W3 — DevTools/инспектор + скриншоты ·
W4 — адресные фичи (закладки/история/разрешения/auth/очистки) + layouts ·
W5 — инструменты дизайнера (линейки/overlay/vision) + file-watcher · W6 — полировка, хоткеи, настройки, апдейтер, дистрибуция.
