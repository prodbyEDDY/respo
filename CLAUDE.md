# CLAUDE.md — Respo

> Этот файл читает **любой** инстанс Claude Code при работе с репозиторием. Здесь —
> факты о проекте и жёсткие правила. Подробности — в библиотеке `docs/`
> (начни с [`docs/README.md`](docs/README.md)).

---

## Проект

**Respo** — десктопное приложение (Windows сейчас, macOS позже) для разработки адаптивных
сайтов: одна страница одновременно в наборе девайс-вьюпортов с синхронизацией навигации и
взаимодействий, DevTools на каждый девайс, честной CDP-эмуляцией устройств, скриншотами и
инструментами дизайнера. Функциональный референс — Responsively App (AGPL), который мы
превосходим по производительности и UX. Полная спецификация:
[`docs/superpowers/specs/2026-08-28-respo-design.md`](docs/superpowers/specs/2026-08-28-respo-design.md).

Репозиторий: `https://github.com/prodbyEDDY/respo.git` (origin). Рабочая ветка — `main`;
фичи — в `feature/*`-ветках, мерж после ревью координатора.

## Стек

- **Оболочка:** Electron (актуальный стабильный), **WebContentsView** — по одному на девайс; main-процесс дирижирует всем «браузерным» через CDP (`webContents.debugger`).
- **UI:** React 18+ + TypeScript strict, **shadcn/ui с кастомной темой**, Tailwind, иконки Heroicons.
- **Стейт:** Zustand (renderer) + electron-store (персистентность через IPC). Redux запрещён.
- **Сборка/тесты:** electron-vite, electron-builder (NSIS), Vitest, Playwright (e2e для Electron).

## Документация — читать ПЕРВЫМ делом

1. [`docs/README.md`](docs/README.md) — карта всей документации.
2. [`docs/ROADMAP.md`](docs/ROADMAP.md) — §10 живой трек + §11 журнал решений (последние записи).
3. Спека: [`docs/superpowers/specs/2026-08-28-respo-design.md`](docs/superpowers/specs/2026-08-28-respo-design.md) — источник правды по архитектуре и функционалу.

**Правило doc-as-code:** меняешь код — в том же изменении актуализируй профильный
документ и при необходимости `ROADMAP.md` (§10/§11).

## Запуск и проверка

Команды проверены (W1, 2026-08-28):

```bash
npm run dev        # dev-режим (electron-vite)
npm run typecheck  # typecheck:node + typecheck:web
npm test           # Vitest (юниты, jsdom для renderer / node для main+shared)
npm run e2e        # Playwright (_electron.launch; пересобирает out/)
npm run lint       # ESLint
npm run build      # прод-сборка (typecheck + electron-vite build)
npm run build:win  # + NSIS-инсталлятор: dist/Respo-Setup-<version>.exe, latest.yml, .blockmap (W6)
npm run icons      # растры иконки из build/icon.svg — рендерит сам Electron, упаковка png-to-ico/png2icons (W6)
node scripts/release-notes.mjs 0.1.0   # секция CHANGELOG для тела GitHub-релиза (W6)
```

Релиз: тег `v<version>` (= `package.json`) на `main` → `.github/workflows/release.yml` собирает инсталлятор и публикует GitHub Release с телом из CHANGELOG; установленные копии обновляются сами (`docs/modules/updater.md`). Тестовый фид апдейтера: `RESPO_UPDATE_URL=http://127.0.0.1:<port>/` (только loopback), выключить — `RESPO_NO_UPDATER=1`.

Грабли, за которые уже платили: React StrictMode дважды гоняет cleanup эффектов (используй dispose-latch паттерн, см. layout-sync тесты); CDP-эмуляция вьюшки без committed-навигации крашит browser process (вьюшки праймятся `about:blank` — фильтруй его из load-событий); клиппинг вьюшек канвас-слоем — недокументированное поведение Chromium (fallback `RESPO_CANVAS_LAYER=0`); `about:blank`-праймер попадает в navigationHistory (canGoBack лжёт на старте — фильтруется); WebContentsView не виден в `page.screenshot` Playwright (гарды — через `View.children` из main); Escape-хендлеры окна конфликтуют с Radix-диалогами (гард по фокусу и `[data-slot]`); mouseenter над нативной вьюшкой не срабатывает (lead-election — hit-test); electron-store — ESM (`.default` в CJS-бандле main); sandboxed preload не должен делить runtime-модули с другими entry (rollup эмитит незагружаемый chunk); Chromium: mobile-эмуляция игнорирует page zoom (`setZoomFactor` её не уменьшает — телефон рисовался 1:1 и обрезался рамкой; с W6 мобильные вьюшки рисуются через `scale` в `Emulation.setDeviceMetricsOverride`), desktop — нет (метрики пре-делятся на зум); координаты `Input.dispatchMouseEvent` при обоих механизмах — CSS-px страницы при любом зуме (делить ничего не надо, e2e sync/zoom); `BrowserWindow.capturePage` не видит WebContentsView — скриншот окна целиком только OS-уровнем; `Page.captureScreenshot` без `clip` снимает виджет, а не вьюпорт (клип — в CSS-px из `Page.getLayoutMetrics`; ширину брать девайсную — `cssVisualViewport.clientWidth` обрезан скроллбаром); culling layout не распространять на эмуляцию (скрытая вьюшка — живая страница и объект съёмки); zustand-селектор, возвращающий новый объект — бесконечный ре-рендер/пустой DOM (производные через useMemo); тесты гонять фокусно, полный набор — один раз перед коммитом.

## Жёсткие правила

1. **Лицензии:** зависимости только MIT/Apache-2.0/BSD/ISC. **GPL/AGPL запрещены.** Любой код и данные из репозитория responsively-app (включая их deviceList) — запрещены; он только визуальный/функциональный референс.
2. **Только WebContentsView.** `<webview>`-тег и BrowserView не использовать нигде.
3. **CDP-first:** эмуляция устройств, скриншоты, инспект, синхронизация ввода — через `webContents.debugger` (один аттач на view на весь жизненный цикл), не через инжектируемые скрипты и локальные серверы.
4. **Производительность — инвариант, не оптимизация потом:** никаких пер-событийных IPC-потоков (только rAF-коалесинг), события загрузки — батчами, скриншоты — через очередь (параллелизм ≤3), вьюшки вне экрана виртуализируются. Бюджеты — в спеке §8.
5. **Безопасность (спека §7a):** вьюшки — `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`; URL из deep-link/CLI/DnD валидируются (только http/https/file); разрешения — по умолчанию «спрашивать».
6. **IPC только типизированный:** все каналы и payload'ы — в `src/shared/ipc.ts`, валидация на входе в main. Новых каналов «мимо» этого модуля не бывает.
7. **Стейт:** Zustand; персистентность только через IPC в electron-store (renderer на диск не пишет); схема хранилища версионируется, частые записи — с debounce.
8. **Язык:** документация и коммуникация — русский; UI приложения и идентификаторы в коде — английский.
9. **Субагенты:** ресёрч — Sonnet 5, реализация — Opus 5; Fable-агентов запускать запрещено (указывай `model` явно в каждом Agent-вызове).
10. Коммиты — осмысленные атомарные, `Co-Authored-By: Claude` в футере; не мержить в `main` без ревью координатора.

## Ключевые файлы

| Зона | Файлы |
|---|---|
| Спецификация (источник правды) | `docs/superpowers/specs/2026-08-28-respo-design.md` |
| Управление | `docs/ROADMAP.md`, `docs/prompts/`, `.claude/commands/lead.md` |
| Будущий hub-файл (владеет координатор) | `src/shared/ipc.ts` — агенты сдают wiring-сниппеты, не правят напрямую |
| Будущее ядро (менять только по спеке) | `src/main/` — ViewManager, CDPController, SyncEngine |

Актуальный статус работ и планы — **только** в [`docs/ROADMAP.md`](docs/ROADMAP.md).
