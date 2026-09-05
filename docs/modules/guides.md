# Линейки и направляющие (`src/main/guides.ts`)

**Назначение.** Две разные вещи с общим именем (спека §5.7): линейки — полосы
20px вокруг рамки девайса с делениями по зуму, чистый рендерер, DOM снаружи
нативной вьюшки; направляющие — сами линии, которые обязаны жить **в
странице**, потому что ничто, нарисованное рендерером, не может лечь поверх
`WebContentsView`. `GuidesManager` держит линии как CSS-слой на девайс,
`Rulers.tsx`/`lib/rulers.ts` — геометрию и интеракцию полос, а скролл для их
синхронизации едет тем же rAF-потоком preload'а, которым уже пользуется
зеркалирование — новый IPC-поток ради линейки не заводился.

## Как работает

- Полосы — `<canvas>` 20px (`RULER_SIZE`), перерисовывается на каждый
  скролл-кадр (`lib/rulers.ts: planTicks`): шаг делений — из круглых чисел
  `STEPS`, так чтобы подписанные деления стояли не чаще `MIN_LABEL_SPACING =
  56` px, минорные — раз в пятую часть шага при ≥ `MIN_MINOR_SPACING = 6` px;
  отсчёт от scroll offset страницы, не от нуля рамки. Интеракция целиком на
  полосе (пейджу событие не добраться): клик — направляющая тут же и сразу
  drag, drag маркера двигает её, уход на `DROP_DISTANCE = 24` px или
  double-click — удаление; маркер трекается **по значению**, не по индексу —
  стор пересортировывает ось (`sanitizeGuideAxis`), и индекс протухает, как
  только один маркер обгоняет другой.
- Линии — `html::after` (`guidesCss`): `linear-gradient`-слой на
  направляющую, `!important`, максимальный `z-index`, `pointer-events: none`.
  Размер слоя — **измеренные** `clientWidth × scrollHeight` (`Runtime.
  evaluate`, выражение `MEASURE`), а не `100%`: абсолютный бокс выше
  документа удлинил бы страницу. Переизмерение — на `did-finish-load`
  (`refresh`) и при каждом изменении набора.
- Показ линеек (`stores/guides.ts: rulers`) — session-режим; включение
  вызывает `useScroll.track(deviceId, 'rulers')` (рефкаунт причин
  `rulers`/`overlay` в `stores/scroll.ts`), которое шлёт `scroll:track` в
  main, только когда счётчик причин переходит через ноль. Main держит
  `Set<deviceId>` (`rulers` в `index.ts`) и включает `SyncEngine.
  setReporting(deviceId, true)` — девайс шлёт скролл, даже не будучи лидером.
  `SyncEngine.handleInput` вызывает `onScroll` для любого сэмпла скролла до
  gate по лидерству; `index.ts` фильтрует по `rulers`-сету и коалесирует в
  `scroll-state` (`createKeyedBatcher`). Ответ `scroll:track` — одноразовый
  `guides.scrollOf` (тот же `MEASURE`), чтобы линейка не стартовала с нуля.
- Направляющие пишутся по ключу `WxH` (`guidesKeyOf`) — размер общий для всех
  девайсов этого разрешения; `guides:set` шлёт `DeviceFrame.tsx` (`useEffect`
  на `rulers`/`guides` этого размера), не сам стор, пустым набором
  (`NO_GUIDES`) при выключенных линейках.
- `pending`-карта в `GuidesManager` (по образцу `DesignOverlayManager`):
  `guides:set`, пришедший до регистрации вьюшки (гонка `about:blank`-праймера
  на рестарте), применяется при регистрации; вставка сериализована через
  `chain: Promise<void>` — быстрый drag не оставляет два слоя.
- Хоткей `Alt+R` переключает линейки лидера, если лидер есть, иначе — все
  девайсы разом; не срабатывает вне канваса и с открытым диалогом.

## IPC

| Канал | Args | Result | Валидатор (`main/validate.ts`) | Кто вызывает |
|---|---|---|---|---|
| `guides:set` | `[string, GuideSet]` | `void` | `validateDeviceId` + `validateGuideSet` | `DeviceFrame.tsx` (`useEffect` на смену `rulers`/`guides` этого размера) |
| `scroll:track` | `[string, boolean]` | `ScrollStatePayload \| null` | `validateDeviceId` + `validateBoolean` | `stores/scroll.ts` `track`/`untrack` (рефкаунт причин `rulers`/`overlay`) |

`MainEvent`: `{ type: 'scroll-state', payload: ScrollStatePayload[] }` — батч
за окно коалесинга, только для девайсов из `rulers`-сета, ничего при
отсутствии скролла (CLAUDE.md §4).

## CDP

`webContents.insertCSS`/`removeInsertedCSS` (через общий `CssLayer` из
`view-backend.ts`) — сам слой направляющих. `Runtime.evaluate`
(`CDPController.evaluate`, выражение `MEASURE`) — одноразовое измерение
`clientWidth`/`scrollHeight`/`scrollX`/`scrollY`, общее и для пересчёта
размера CSS-слоя, и для ответа `scroll:track`.

## Персистентность

Слайс `guides: GuidesDocument` (`Record<WxH, GuideSet>`) в `PersistedState`.
Лимиты и там, и в валидаторе `guides:set`: `MAX_GUIDE_SIZES = 100` размеров,
`MAX_GUIDES_PER_AXIS = 50` направляющих на ось, позиции — целые `0..
MAX_GUIDE_POSITION (100 000)`, `sanitizeGuideAxis` дедуплицирует и сортирует.
Запись — debounce 250 мс в рендерере (`GUIDES_SAVE_DEBOUNCE_MS`) поверх
общего debounce диска 300 мс (`SAVE_DEBOUNCE_MS`, `main/persistence.ts`) —
drag маркера это одна запись после того, как палец остановился. Показ
линеек (`rulers`) не персистится — session-режим. Слайс не бампнул
`SCHEMA_VERSION`: отсутствие поля — «нет направляющих», как у `emulation`/
`layout`/`devtools`.

## Грабли

- Абсолютный бокс `html::after` выше реального документа **удлиняет страницу
  сам собой** — размер слоя обязан быть измеренным `clientWidth ×
  scrollHeight`, а не заявленным в процентах.
- `guides:set`/`overlay:set` при рестарте могут прийти раньше, чем вьюшка
  зарегистрировалась в менеджере (асинхронный `about:blank`-праймер) —
  `pending`-карта держит присланное и применяет при регистрации.
- В e2e `documentElement.clientWidth` десктопа = 1425 (скроллбар 15px) —
  вьюшку идентифицировать по `innerWidth`/`clientWidth` без смешения;
  `[data-device-id]` теперь и у canvas-полос — локатор `div[data-device-id]`.

## Тесты

Юниты: `main/__tests__/guides.test.ts` (`GuidesManager` против фейкового CDP —
apply/pending/refresh/chain), `lib/__tests__/rulers.test.ts` (`planTicks`/
`pageCoordinate`/`stripPosition`/`guideAt`), `stores/__tests__/guides.test.ts`,
`stores/__tests__/scroll.test.ts` (рефкаунт причин, `scroll-state` батч);
плюс `validate.test.ts`/`persistence-types.test.ts`. E2e: `rulers.spec.ts` —
клик на 100 даёт `guides['393x852'].v=[100]` и синюю линию x=100 на iPhone
(десктоп 1440×900 без направляющих), зум 50% переносит клик на экранных 100
в страничные 200, рестарт восстанавливает документ и линии.

## Связанные документы

Спека [§5.7](../superpowers/specs/2026-08-28-respo-design.md#57-инструменты-дизайнера).
Смежные модули: [design-overlay.md](design-overlay.md) (тот же `pending`-
паттерн и общий канал `scroll:track`/`scroll-state`), [diagnostics.md](diagnostics.md)
и [debug-css.md](debug-css.md) (тот же `insertCSS`-слой на устройство),
[emulation.md](emulation.md) (тот же приём «отсутствие поля = дефолт» без
бампа `SCHEMA_VERSION`).
