# Диагностика (`src/main/diagnostics.ts`)

**Назначение.** Два вопроса, которые задают при проверке адаптивной вёрстки —
«что-нибудь упало на телефоне?» и «почему появился горизонтальный скролл?» —
отвечены на всех девайсах сразу, без ручного открытия DevTools на каждом (спека
§5.11). `DiagnosticsManager` считает консольные ошибки и исключения с последней
навигации и раз в секунду после загрузки сканирует документ на переполнение
вьюпорта, а рендерер показывает это парой компактных чипов в шапке девайса.

## Как работает

На каждой вьюшке включён `Runtime` (`CDPController.enableRuntime`); события
`Runtime.exceptionThrown` и `Runtime.consoleAPICalled` (только `type === 'error' |
'assert'`) увеличивают счётчик и добавляют строку в кольцевой буфер последних
`MAX_MESSAGES = 20` сообщений (`MAX_MESSAGE_LENGTH = 200` символов на строку).
`Runtime.executionContextsCleared` — сигнал новой навигации, обнуляющий счётчик и
снимающий подсветку. Overflow-скан — одноразовый `Runtime.evaluate`
(`OVERFLOW_SCAN`) после `did-finish-load` и повтор через `RESCAN_DELAY_MS = 1000`
(ленивый контент подгружается позже `load`); ответ — недоверенный текст со
страницы, и `parseScan` валидирует его поле за полем, прежде чем он станет
`OverflowReport`.

- Виновники — до `MAX_OVERFLOW_ITEMS = 10`, outermost-first: элемент внутри уже
  найденного пропускается, так что широкий hero отчитывается один раз, а не его
  сорок детей.
- Селекторы (`tag#id`/`nth-of-type`-путь) остаются в main — рендерер подсвечивает
  по индексу (`HighlightTarget`), а не по строке, которую отдала бы недоверенная
  страница.
- Подсветка — CSS-слой (`webContents.insertCSS`, ключ на устройство), а не
  `Overlay.highlightNode`: не требует `DOM.enable`, скроллится вместе с элементом
  и допускает несколько подсвеченных одновременно.
- Изменения копятся в `dirty` и уходят одним батчем через `Deferrer`
  (`immediateDeferrer`, по образцу load-state-batcher) — страница, кидающая
  исключения в цикле, стоит один IPC на окно коалесинга, а не одно сообщение на throw.

## IPC

| Канал | Args | Result | Валидатор | Кто вызывает |
|---|---|---|---|---|
| `diagnostics:highlight` | `[string, HighlightTarget]` | `void` | `validateDeviceId` + `validateHighlightTarget` | попап overflow-чипа (hover по строке, «Highlight all») |
| `diagnostics:get` | `[]` | `DiagnosticsPayload[]` | — | рендерер при старте (main мог уже насчитать ошибок до его запуска) |

`MainEvent`: `{ type: 'diagnostics', payload: DiagnosticsPayload[] }` — батч
изменившихся девайсов за окно коалесинга, никогда per-событие (CLAUDE.md §4).

## CDP

`Runtime.enable` (через `CDPController.enableRuntime`, реплеится при реаттаче) ·
события `Runtime.exceptionThrown`/`consoleAPICalled`/`executionContextsCleared`
(подписка через `CDPController.onEvent`) · `Runtime.evaluate` (`CDPController.
evaluate`, `returnByValue: true`) для скана переполнения · `webContents.
insertCSS`/`removeInsertedCSS` (через общий `CssLayer`) для подсветки.

## Грабли

- Скан выполняется в main world, а не в изолированном (`Page.createIsolatedWorld`
  требует `frameId` и пересоздаётся на каждой навигации); ответ и так валидируется
  как недоверенные данные и не несёт ничего, кроме геометрии — ничего постоянного
  не инжектируется.
- Под mobile-эмуляцией страница шире вьюпорта сжимается (shrink-to-fit):
  `window.innerWidth` становится шириной контента, а `documentElement.clientWidth`
  остаётся девайсным — в e2e вьюшки идентифицируют по `clientWidth`, не по
  `innerWidth`.
- `Runtime.enable` на десяти вьюшках — стоимость проверяется бюджетом §8
  (p99 event loop), не самим модулем; замер — в отчёте волны.

## Тесты

Юниты: `main/__tests__/diagnostics.test.ts` (счётчик, `parseScan`, коалесинг,
подсветка против фейкового CDP); `validate.test.ts` → `validateHighlightTarget`;
`cdp-controller.test.ts` → `describe('CDPController — Runtime')`;
`stores/__tests__/diagnostics.test.ts`. E2e: `diagnostics.spec.ts` — фикстура с
`console.error`+`throw` даёт «2 errors» на всех пяти девайсах; фикстура с
`width: 120vw`-баннером даёт чип overflow ровно на трёх узких и не даёт на
десктопе; попап со списком, hover подсвечивает `div#wide.banner.promo`,
«Highlight all» — сплошной outline по всей странице, Escape снимает; reload
обнуляет счётчик.

## Связанные документы

Спека [§5.11 «Diagnostics (W5)», §8](../superpowers/specs/2026-08-28-respo-design.md).
Смежные модули: [reliability.md](reliability.md) (тот же батч `load-state`,
`did-finish-load` как триггер скана), [guides.md](guides.md) и
[debug-css.md](debug-css.md) (тот же `insertCSS`-слой на устройство).
