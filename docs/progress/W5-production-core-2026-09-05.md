# Отчёт — W5 «Production Core»

**Период:** 2026-09-05 · **Статус:** ✅ завершено (ветка `w5-core`, принята координатором) ·
**Исполнитель:** Fable 5.1 (задачи 1–11), координатор — приёмка, правки по ревью, отчёт ·
**Лог по задачам:** [W5-log.md](W5-log.md) · **План:** [2026-09-05-w5-production-core.md](../superpowers/plans/2026-09-05-w5-production-core.md)

## Что сделано

- **Emulation pack** (кнопка **Emulate** в топ-баре, popover): color scheme light/dark, media screen/print, reduced motion, forced colors (`Emulation.setEmulatedMedia`); vision — 6 CDP-типов (`setEmulatedVisionDeficiency`) глобально и **пер-девайс** (kebab → Vision ▸, чип-индикатор в шапке); network — Fast 4G / Slow 4G / 3G / Offline; location — 8 городов или lat,lng; locale + timezone + `Accept-Language` (одним `Network.setUserAgentOverride` вместе с UA). Persist, replay после реаттача, бейдж активности, Reset all.
- **Честная эмуляция:** UA Client Hints (`userAgentMetadata` выводится из UA-строки девайса; Safari-девайсы — без `userAgentData`, как настоящие).
- **Каталог 38 → 110 устройств** (Chromium DevTools BSD-3 + публичные спецификации; `NOTICE.md`; старые id и метрики неизменны).
- **Надёжность страницы:** оверлей «Page crashed» + Restart (`render-process-gone`), per-device Reload / Reload ignoring cache (`Mod+Shift+R`) / Scroll to top / Copy URL в kebab ⋯; popups — только у лидера, только http(s), sandbox + `persist:respo`, у последователей молча deny. Скрытие мобильных скроллбаров не нужно — mobile-эмуляция Chromium их не рисует (проверено пикселями).
- **Диагностика:** чипы **N errors** (клик → DevTools console девайса) и **overflow** (список виновников, hover-подсветка, Highlight all) — `Runtime.enable` + одноразовый скан, селекторы не покидают main, события батчем.
- **Линейки и направляющие:** canvas-полосы вокруг рамки, направляющие — CSS-слой в странице, интеракция целиком на полосе (клик/drag/double-click), persist по `W×H`, скролл — из существующего sync-потока (`setReporting`), `Alt+R`.
- **Design Overlay:** картинка через `<input type=file>` (renderer путей не знает), хранилище с капом 10 MB/файл и 100 MB LRU в отдельном файле `respo-overlays.json`, CSS-слой (opacity, шторка), side-by-side в renderer; CSP страницы (`img-src`) блокирует `data:`-фон — задокументировано в диалоге.
- **Live-reload `file://`:** chokidar 4 (лениво), css hot-swap через подмену `href`, прочее — reload всех, индикатор в адресной строке с паузой; для http(s) — ничего.
- **Debug ▸ Outline all elements** и **Rulers on all devices** в ⋯-меню.
- **Перф-гейт §8:** `e2e/perf-budget.spec.ts` — 10 девайсов, 20 с зеркального скролла, диагностика включена.

## Проверка

- typecheck ✅ · lint ✅ · vitest **1539** (W4: 1200) ✅ · e2e **36 spec** (W4: 28; +8: emulation-pack, vision, reliability, diagnostics, rulers, overlay, live-reload, debug, perf-budget) ✅.
- Перф: loop p99 max **10.2 мс** при бюджете 16 мс (5 окон под нагрузкой, max 123 мс — единичный applyLayout при старте).
- Два ревью Opus (по диффу `main..w5-core`): вердикт «mergeable after fixes». Закрыто координатором вручную: **C1** — `image()` писал весь стор картинок синхронно на каждое чтение (слайдер = десятки многомегабайтных записей в секунду; плюс картинки лежали в `respo-state.json` и переписывались каждым `store:save`) → LRU-штамп в памяти, дебаунс 1 с, отдельный файл; **I1** — гонка `highlight` оставляла осиротевший CSS-слой → chain; **I2** — drag направляющей/слайдера ставил по 3 CDP round-trip на каждое событие → gen-токен, устаревшие replace пропускаются; **I3** — `Runtime.evaluate` без таймаута вешал цепочки на зависшей странице → 5 с; плюс минорные: откат `FileWatcher.follow` при ошибке, `reporting` в SyncEngine чистится, гард `will-navigate`/`will-redirect` у попапов, `diagnostics.dispose` в `before-quit`, кап `pending` (64), длина id `deviceVision`, строгий `isStoredImage`, `url("…")` в кавычках, PNG/JPEG only (nativeImage не декодирует GIF/WebP), уборка профиля perf-спека.

## Решения и отклонения от плана

Скроллбары не трогаем (не нужно); выбор файла overlay — `<input type=file>` вместо main-диалога; CSP ломает `data:`-фон overlay (ограничение задокументировано, `setBypassCSP` отвергнут); css hot-swap через `href` вместо `CSS.setStyleSheetText`; overflow-скан в main world с валидацией ответа; Client Hints из UA-строки, а не полями каталога; `SCHEMA_VERSION` не бампался — новые слайсы аддитивны с пополевой репарацией. Спека приведена к факту (§3, §4.2, §5.1, §5.2, §5.4, §5.7–5.9, новые §5.10–5.11).

## Follow-ups

- Renderer-сторона: rAF-коалесинг `overlay:set`/`guides:set` (main уже схлопывает устаревшие; поток IPC пока пер-событийный).
- `Runtime.consoleAPICalled` формируется Chromium на каждый `console.log` — на страницах с логом в rAF-цикле ~60 сообщений/с/девайс отбрасываются в main (бюджет держится; альтернативы в CDP нет).
- FileWatcher следит за папкой страницы до глубины 3 — html с Рабочего стола даёт широкий watch (кап по файлам не стоит).
- Кастомная локаль/таймзона текстом (только пресеты); e2e на geolocation (нужен allow разрешения).
- Ревью-находки, оставленные как есть: перф-тест в CI — soft (шумные раннеры).
