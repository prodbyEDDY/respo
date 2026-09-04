# Исследование рынка — responsive-design браузеры и multi-viewport dev-tools (2025–2026)

> Дата: 2026-09-05. Автор: research-агент (Sonnet 5) по заданию координатора. Источник для
> gap-листа production-волн W5/W6 и MCP-волны W7. Ссылки — на официальные страницы на момент сбора.

## A. Обзор конкурентов

### 1. Polypane — polypane.app
Премиальный Chromium-браузер «для разработчиков, которым не всё равно» — самый функционально насыщенный инструмент в нише; целится в профессиональных фронтендеров, агентства и accessibility-специалистов. Цена: Individual $11/мес ($108/год), Business $47/мес за 10 мест, Enterprise от $332/мес; 14-дневный trial без карты, все фичи на всех тарифах ([pricing](https://polypane.app/pricing/)).
Отличия от Respo: безлимитные resizable панели с 5 layout-режимами и **CSS-breakpoint auto-detection**; **Portal** — синхронизация внешних браузеров/телефонов через shareable URL ([portal](https://polypane.app/portal/)); live CSS/JS-редактирование в панели; **rulers/grids/guides** и **Measure tool** со снапом к guides ([docs](https://polypane.app/docs/rulers-grids-and-guides/)); симуляции — 8 типов цветовой слепоты (полная+лёгкая), дислексия, глаукома, катаракта, туннельное зрение, ночной режим ([blog](https://polypane.app/blog/developing-for-color-blindness-with-polypane/)); полный набор media-emulation (`prefers-reduced-motion/data/transparency/contrast`, `forced-colors`, `color-gamut`, print); автоматизированные WCAG-аудиты, a11y-дерево, focus-order visualization; SEO/meta-панель с соцпревью (X/FB/LinkedIn/Discord), broken-link checker, outline-панель; Chrome-расширения внутри браузера (Side Panel API) ([Polypane 30](https://polypane.app/blog/polypane-30-playgrounds-side-panel-extension-api-updated-video-recording-and-chromium-152/)); Workspaces/Projects/**Environments** (защита от спутывания prod/localhost). AI-функций и публичного CLI/MCP нет. Платформы: Win/macOS/Linux, x64+ARM.

### 2. Sizzy — sizzy.co
Инди-ориентированный «браузер для веб-разработчиков», акцент на устранении context-switching. Цена: $15/мес, $12/мес при годовой оплате, $499 lifetime, 14 дней trial ([sizzy.co](https://sizzy.co/)).
Отличия: sync scroll/click/forms с возможностью **отключить sync и тестировать разные страницы параллельно**; «Real Device Heights» — учёт chrome браузера/ОС; Universal DevTools + единая консоль; **API Inspector** (REST/GraphQL); Network Simulation (slow 3G/flaky wifi/offline); **Session Manager** — несколько залогиненных аккаунтов на разных устройствах; **Photo Studio Mode** — маркетинговые мокапы; QR-код для открытия URL на телефоне; command-palette «Butler». a11y-аудитов/симуляций нет — фокус на DX.

### 3. Blisk — blisk.io
Бюджетный инструмент, QA-lite сценарий «мобильный+десктоп рядом». Цена: Premium ~$8.49/мес (данные ~2022, перепроверить) ([saasworthy](https://www.saasworthy.com/product/blisk-io)).
Отличия: 89 устройств с нативными touch-событиями; URL Sync + Scroll Sync; **Error notifier** — уведомления о JS-ошибках и упавших ресурсах прямо в UI; auto-refresh при изменении кода; облачное хранилище скриншотов/записей с аннотатором; security-алерты. Live-CSS, a11y, AI, CLI — нет.

### 4. LT Browser 2.0 — LambdaTest (теперь «TestMu AI»)
Локальный клиент облачной cross-browser-платформы; в январе 2026 ребрендинг в **TestMu AI** — «Agentic AI QE Platform» ([producthunt](https://www.producthunt.com/products/lambdatest)). Цена: от $15/мес, есть free-тариф с ограничением.
Отличия: 50+ устройств + кастомные, до **6 устройств** одновременно ([gfg](https://www.geeksforgeeks.org/websites-apps/what-is-lt-browser-2-0/)); Scroll Sync ([docs](https://www.lambdatest.com/support/docs/scroll-sync/)); hot-reload; network throttling; запись сессий с шарингом; мост в облачный real-device grid.

### 5. Responsively App — функциональный референс (free, AGPL-3.0)
Ключевая новость 2025–2026: **встроенный MCP-сервер** (`@responsively/mcp`) — AI-агенты (Claude Code, Cursor) переключают устройства, скриншотят по устройствам, взаимодействуют со страницей; сервер стартует по требованию ([github](https://github.com/responsively-org/responsively-app)). **Единственный MCP среди всех рассмотренных конкурентов.** Остальное скромнее: 30+ устройств + кастомные, единый inspector (Ctrl+I подсвечивает элемент во всех панелях), one-click скриншоты всех устройств, hot reload, расширение для Chrome/Firefox/Edge. Live-CSS, rulers/measure, a11y-симуляций, network/geo/locale — нет.

### 6. Baseline: Chrome DevTools Device Mode / Firefox RDM
Бесплатны, встроены, **одна панель** — multi-viewport-синхронизация и есть базовая ценность ниши. Chrome: presets/custom, breakpoint-debug по `@media`, network/CPU throttling, touch, offline, скриншоты viewport/full/node ([docs](https://developer.chrome.com/docs/devtools/device-mode)). Firefox: presets, throttling, touch, поворот, UA spoofing, Ctrl+Shift+M.

### 7. Новички и тренд 2025–2026
Ниша смещается к «agentic AI QA»: LambdaTest → TestMu AI; **Thunders** — natural-language test authoring; **BrowserOS neo** — локальный AI-браузер. В лёгком сегменте — Responsive Viewer, Hoverify. Прямых новых конкурентов уровня Polypane/Sizzy нет — рынок консолидируется, инновация уходит в AI-агентов.

## B. Сводная матрица фич

Легенда: ✅ есть · 🟡 частично · ❌ нет · — нет данных · 📋 запланировано у Respo

| Функция | Polypane | Sizzy | Blisk | LT Browser 2.0 | Responsively | **Respo (2026-09-05)** |
|---|---|---|---|---|---|---|
| Sync: scroll | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sync: click | ✅ | ✅ | — | — | ✅ | ✅ |
| Sync: typing/forms | ✅ | ✅ | — | — | ✅ | ✅ |
| Sync: hover | ✅ | — | — | — | — | — |
| Sync: focus | ✅ | — | — | — | — | — |
| Единый inspector по всем панелям | ✅ | ✅ | 🟡 | 🟡 | ✅ | 🟡 (per-device) |
| Единая консоль/network панель | ✅ | ✅ | ❌ | 🟡 | ❌ | ❌ |
| Auto-detect CSS breakpoints | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Live CSS/JS-редактирование | ✅ | 🟡 | ❌ | ❌ | ❌ | ❌ |
| Layout/outline debugging | ✅ | 🟡 | ❌ | — | ❌ | ❌ |
| Автоматизированные a11y-аудиты | ✅ | 🟡 | ❌ | ❌ | ❌ | 📋 |
| Vision-deficiency симуляции | ✅ (8+дислексия) | ❌ | ❌ | ❌ | ❌ | 📋 |
| prefers-reduced-motion/forced-colors/print | ✅ | — | ❌ | ❌ | ❌ | ❌ |
| SEO/meta/соцпревью | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Structure/outline панель | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Measure tool | ✅ | ❌ | ❌ | ❌ | ❌ | 📋 |
| Rulers/guides | ✅ | ❌ | ❌ | ❌ | ❌ | 📋 |
| Design overlay | ✅ | 🟡 | ❌ | ❌ | ❌ | 📋 |
| Screenshot: viewport / full page | ✅/✅ | ✅/✅ | ✅/✅ | ✅/— | ✅/— | ✅/✅ |
| Screenshot: element / device frame | ✅/— | —/✅ | — | — | — | ❌/❌ |
| Screenshot: все панели одним файлом | ✅ | 🟡 | ✅ | — | ✅ | 🟡 (очередь, не stitched) |
| Video/GIF-запись | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Network throttling | ✅ | ✅ | — | ✅ | ❌ | ❌ |
| Geolocation / timezone / locale | ✅/—/✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| prefers-color-scheme toggle | ✅ | ✅ | — | — | — | ❌ |
| Touch/cursor emulation | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Permissions | 🟡 | — | — | — | — | ✅ |
| Workspaces/sessions/projects | ✅ | ✅ | 🟡 | — | ❌ | 🟡 |
| Device presets/custom/suites | ✅ | ✅ | ✅ (89) | ✅ (50+) | ✅ (30+) | ✅ (38) |
| Sharing (live cross-browser) | ✅ Portal | 🟡 QR | 🟡 | ✅ запись | ❌ | ❌ |
| Расширения внутри тула | ✅ | — | — | — | ✅ | ❌ |
| AI-функции | ❌ | ❌ | ❌ | ✅ (платформа) | ❌ | ❌ |
| CLI/API/MCP для агентов | ❌ | ❌ | ❌ | 🟡 cloud API | ✅ **MCP** | 📋 |
| Хоткеи (документированы) | ✅ | ✅ | — | — | — | 📋 |
| Auto-update | ✅ | ✅ | ✅ | ✅ | ✅ | 📋 |
| Платформы | Win/Mac/Linux | Win/Mac | Win/Mac/Linux | Win/Mac | Win/Mac/Linux | Win (macOS план) |

## C. Приоритизированный gap-лист для Respo

1. **Media-feature emulation** (prefers-color-scheme/reduced-motion/reduced-data/contrast, forced-colors, print) — ценность High, сложность Low: `Emulation.setEmulatedMedia({media, features})`. **Must-have.**
2. **Network throttling** — High / Low: `Network.emulateNetworkConditions`. **Must-have.**
3. **Vision-deficiency симуляция** — High / Medium: `Emulation.setEmulatedVisionDeficiency` (achromatopsia/deuteranopia/protanopia/tritanopia/blurredVision/reducedContrast); дислексия — не CDP. **Must-have.**
4. **Geolocation / timezone / locale override** — Medium-High / Low: `Emulation.setGeolocationOverride`, `setTimezoneOverride`, `setLocaleOverride`. **Must-have для паритета с Polypane.**
5. **Единая inspector/console/network панель** — High / High: фан-ин `Runtime.consoleAPICalled`/`Log.*` из N сессий в общую шину, `Overlay.highlightNode` во все вьюшки. **Must-have, среднесрочно** — самая дорогая, но самая «характерообразующая».
6. **AI/MCP-интеграция** — High и растёт / Medium: единственный конкурент с MCP — бесплатный Responsively; ни один платный не имеет. **Must-have.**
7. **Video/GIF recording** — Medium / Medium: `Page.startScreencast` + энкодинг. **Nice-to-have.**
8. **Measure tool + rulers/guides** — Medium / Medium: renderer-оверлей. Уже в плане. **Nice-to-have, дешёвый шаг.**
9. **Design overlay** — Medium / Low-Medium. Уже в плане. **Nice-to-have.**
10. **Meta/SEO/соцпревью + outline + broken-link checker** — Medium-High / Low-Medium: парсинг `<head>` через `DOM.getDocument`, outline — `Accessibility.getFullAXTree`. **Nice-to-have, дешёвый выигрыш.**
11. **CSS breakpoint auto-detection** — Medium / High: `CSS.getMediaQueries`/стили; ломается на CSS-in-JS. **Nice-to-have, отложить** (в базовой форме — дёшево).
12. **Portal-style live-шаринг** — High для команд, Medium для соло / High: relay-сервер. **Skip / переоценить позже.**
13. **Chrome-расширения внутри** — Low-Medium / High. **Skip.**

## D. Чек-лист «ощущения production-ready» (из онбординга конкурентов)

- Trial/старт без трения: сразу рабочий экран, без карт и регистраций.
- Защитный empty/guard-state: умные пустые состояния и предупреждения (Polypane Environments: не спутать localhost и production).
- Подсказки по ходу работы: контекстные тултипы вместо отдельного тура.
- Командная палитра как способ открыть хоткеи (Sizzy Butler) — обучает через поиск команд.
- Публичные именованные релизы с changelog — видимый cadence формирует доверие; нужно для auto-update.
- Инлайн-обработка ошибок (Blisk Error notifier): JS-ошибки/упавшие ресурсы видны в UI, а не тихо теряются.
- Явные security-сигналы: показывать пользователю, когда включён «небезопасный» режим (invalid certs), а не только хранить в настройках.

**Ключевой вывод:** три самых дешёвых и «базово ожидаемых» гэпа — media-emulation, network throttling, geo/timezone/locale — закрыть первыми (одиночные CDP-методы поверх существующего attach). Второй блок — vision-deficiency и MCP — реальная дифференциация. Unified inspector/console — самая дорогая инвестиция; без неё продукт выглядит как «N синхронизированных окон Chrome».
