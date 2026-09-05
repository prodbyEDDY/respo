# Live-reload для `file://` (`src/main/file-watcher.ts`)

**Назначение.** Открыт локальный `*.html` — правки его самого и соседей
(html/css/js) подхватываются без ручного reload (спека §5.8). Ничего не
делается для `http(s)`-страниц: там за живую перезагрузку отвечает дев-сервер
разработчика, а вотчер на папке, из которой Respo случайно открыл файл, был
бы сюрпризом, а не функцией. `FileWatcher` решает, что смотреть и что значит
событие; сам обход файловой системы — `chokidar` (MIT), единственная
зависимость которого, `readdirp`, тоже MIT.

## Как работает

- `follow(url)` вызывается на каждом батче `load-state` с урлом лидера
  (`lead.url()` из `LeadTracker`, `main/index.ts`). Урл, который не
  изменился — сравнение строк и всё; `file://*.html` — старый вотчер
  закрывается, новый ставится на `dirname(file)` с `depth: WATCH_DEPTH (3)`,
  `ignoreInitial`, игнором `node_modules`/`.git` (`isIgnored`); не-file —
  вотчер просто закрывается, состояние `off`.
- Фильтр по типу файла — `isWatchedFile`: расширения `.html/.htm/.css/.js/
  .mjs`, не в игнор-папке. События `add`/`change`/`unlink` копятся в
  `changed`, флаш — через `CHANGE_DEBOUNCE_MS = 100` мс после последнего
  события (сохранение в редакторе — обычно несколько событий залпом).
- Если весь залп — только `.css`: одноразовый `Runtime.evaluate`
  (`swapExpression`) на **каждой** вьюшке отдельно — ищет `<link rel=
  stylesheet>`, чей `file:`-путь (сравнение через `new URL(link.href,
  document.baseURI)`) совпадает с изменившимся, и подставляет свежий
  `?respo-reload=<timestamp>` в `href`, не трогая остальное. Пути — из
  вотчера, вставляются как `JSON.stringify`, ничего page-controlled не
  становится частью выражения. Ответ — число подмен; вьюшка, где менять
  нечего (стиль подключён через `@import`, а не `<link>`), получает **общий
  reload всех** — «часть девайсов с новым CSS, часть со старым» хуже, чем
  вспышка на всех сразу.
- Любой не-css файл в заливе (html/js) — `reloadAll()` (колбэк из
  `main/index.ts`, `viewManager.reload()`), без попытки точечной подмены.
- `toggle()` — пауза: вотчер остаётся живым, но события отбрасываются
  (`onEvent` выходит рано при `this.paused`); возобновление не наверстывает
  пропущенное — следующее реальное изменение файла запускает обычный цикл.
- Состояние (`state()`: `'watching' | 'paused' | 'off'`, `file`,
  `lastReloadAt`) публикуется (`onState`) только при смене — на каждый flush
  и на каждый `follow`/`toggle`, никогда на сырое файловое событие.
- Регистрация вьюшек — `registerDevice({deviceId, target})`/
  `unregisterDevice` из `view-backend.ts`, тот же жизненный цикл вьюшки, что
  у `guides`/`overlays`/`debug`, но **без** `refresh` на `did-finish-load`:
  вотчеру нечего переприкладывать, `Runtime.evaluate` — одноразовый вызов по
  событию файла, а не постоянный слой.
- `chokidar` грузится лениво (`chokidarFactory`, `await import('chokidar')`)
  один раз при старте окна; пока промис не разрешился, `FileWatcher.follow`,
  вызванный раньше, кладёт `file`/`paused`, но фабрика вотчера кидает
  `'watcher not ready'` — `chokidarFactory().then(...)` перезапускает
  `follow(lead.url())` заново, как только модуль готов.

## IPC

| Канал | Args | Result | Валидатор | Кто вызывает |
|---|---|---|---|---|
| `watcher:toggle` | `[]` | `WatcherState` | — (без аргументов) | `stores/watcher.ts` `toggle` (клик по точке в адресной строке) |
| `watcher:get` | `[]` | `WatcherState` | — (без аргументов) | `stores/watcher.ts` при старте рендерера (`attachWatcherBridge`) |

`MainEvent`: `{ type: 'watcher', payload: WatcherState }` — только при смене
состояния (после `follow`, `toggle` или реального reload/swap), никогда на
файловое событие как таковое.

## CDP

Собственного постоянного слоя нет. `Runtime.evaluate` (`CDPController.
evaluate`, вызывается как `WatcherCdp.evaluate`) — одноразовая подмена
`href` у затронутых `<link rel=stylesheet>` при css-заливе; html/js-залив
идёт через `viewManager.reload()` (`webContents.reload()`), а не CDP.

## Персистентность

Session-only, ничего не пишется. Состояние вотчера имеет смысл только для
текущего открытого файла и текущего запуска: канвас, открывшийся завтра,
сам решает, следить ли за файлом, по тому, какая страница на нём в этот
момент открыта (`follow` вызывается заново на первом же `load-state`).

## Грабли

- Флаш css-only смотрит на **все** пути залпа: если хоть один файл в заливе
  не css — весь залп идёт как `reloadAll`, точечная подмена css не
  подмешивается к общему reload.
- `swapExpression` сравнивает `decodeURIComponent(url.pathname)` — путь с
  пробелами/юникодом в имени файла обязан совпасть после декодирования, а не
  посимвольно с сырым `pathname`.
- Уход с `file://` останавливает вотчер сразу (`follow(null-ish url)` →
  `stop()`), но не ждёт последнего flush — незавершённый debounce отменяется
  через `dropPending()`.
- `chokidar@4` — ESM; загрузка лениво через `await import`, чтобы модуль,
  которым большинство сессий не пользуется (страница почти всегда не
  `file://`), не тянулся в каждый старт.

## Тесты

Юниты: `main/__tests__/file-watcher.test.ts` (`watchableFile`/`isWatchedFile`/
`isIgnored`, debounce и коалесинг залпа против фейкового таймера и фейкового
`Watcher`, `swapExpression`, переключение `follow`/`toggle`/`dispose`). E2e:
`live-reload.spec.ts` — папка во временном каталоге, файлы пишет сам тест:
точка видна и `watcher:get().file` равен пути страницы; правка css меняет
цвет на всех 5 вьюшках без перезагрузки (маркер `window.__respoMarker`
остаётся на месте); правка html перезагружает все (новый title, маркер
пропал); пауза — правка игнорируется 1.2 с, возобновление — применяется;
переход на `http` убирает точку и переводит состояние в `off`.

## Связанные документы

Спека [§5.8](../superpowers/specs/2026-08-28-respo-design.md#58-live-reload-локальных-файлов).
Смежные модули: [guides.md](guides.md) и [design-overlay.md](design-overlay.md)
(тот же жизненный цикл регистрации по девайсу через `view-backend.ts`, но без
постоянного CSS-слоя), [debug-css.md](debug-css.md) (тоже session-режим, не
персистится), [reliability.md](reliability.md) (`load-state` как источник
урла лидера, тот же батчер).
