# Design Overlay (`src/main/design-overlay.ts`)

**Назначение.** Макет дизайнера поверх страницы, чтобы свести пиксель к
пикселю (спека §5.7). Как и направляющие, картинка обязана лечь **в
странице**, а не в рендерере — `html::before`, CSS-слой на девайс,
`DesignOverlayManager`. Второй режим, Side by side, наоборот, целиком
рендерер: `<img>` рядом с рамкой, ничего не кладётся в страницу. Сами
картинки — единственное в Respo, что меряется мегабайтами, поэтому живут не
в документе настроек (пишется на каждый debounce), а под своим ключом
electron-store, по content-id, с общим лимитом и вытеснением LRU.

## Как работает

- `overlayCss` — одна декларация: `html::before` абсолютно от начала
  документа, центрирован (`left: 50%; translateX(-50%)`), ширина в px
  картинки, `max-width: 100%` и `aspect-ratio` (шире вьюпорта — сжимается, а
  не создаёт горизонтальный скролл), `background: url(data:...)`, `opacity`,
  `clip-path: inset(0 0 0 Y%)` — шторка слева. Opacity/curtain — два числа в
  том же правиле, слайдер не стоит нового `insertCSS` в кадр.
- Хранилище картинок — отдельный ключ `overlayImages` (`OVERLAY_IMAGES_KEY`),
  не слайс `PersistedState`. `storeImage`: декод через `nativeImage` **до**
  сохранения (битый файл — `unreadable`), content-id — первые 16 hex цифр
  SHA-256 байтов (`imageIdOf`); капы `MAX_OVERLAY_IMAGE_BYTES = 10 MB` на
  файл и `MAX_OVERLAY_STORE_BYTES = 100 MB` суммарно — `evict` вытесняет по
  `usedAt` от старых, не трогая только что сохранённую. `image(id)` обновляет
  `usedAt` при каждом обращении (тач и по чтению), `null` — если вытеснена.
- Картинка выбирается **не** через диалог main, а `<input type="file">` в
  рендерере (`DesignOverlayDialog.tsx: ChooseImage`): рендерер получает
  `File` без пути, читает его в data URL один раз (`FileReader`) и шлёт байты
  один раз (`overlay:store-image`); дальше — только id. Отклонение от буквы
  плана — так путь драйвится Playwright'ом (`setInputFiles`) и работает
  drag-and-drop в будущем.
- Cap проверяется рендерером **до** чтения байтов (`file.size >
  MAX_OVERLAY_IMAGE_BYTES`) — 40 MB PNG не читается в память ради отказа.
- `pending`-карта в `DesignOverlayManager` — тот же приём, что у
  `GuidesManager`: `overlay:set`, пришедший до регистрации вьюшки (гонка
  `about:blank`-праймера на рестарте), применяется при `registerDevice`.
  Вставка сериализована через `chain: Promise<void>` на девайс.
- Side by side — чистый рендерер (`OverlayPanel.tsx`): `<img>` шириной
  девайса × zoom, `translateY(-scrollY × zoom)` — сдвиг в такт скроллу через
  тот же канал, что и линейки (`stores/scroll.ts`, причина `'overlay'`,
  рефкаунт общий с `rulers`). В странице в этом режиме ничего не меняется.
- `overlay:set` шлёт `DeviceFrame.tsx` (`useEffect` на смену настроек этого
  размера) — `null`, если оверлей выключен или в режиме Side by side.

## IPC

| Канал | Args | Result | Валидатор (`main/validate.ts`) | Кто вызывает |
|---|---|---|---|---|
| `overlay:store-image` | `[string]` (data url) | `OverlayStoreResult` | `validateOverlayDataUrl` (raster-тип, ≤ капа по длине base64) | `stores/design-overlay.ts` `chooseImage` |
| `overlay:image` | `[string]` (image id) | `OverlayImage \| null` | `validateImageId` | `stores/design-overlay.ts` `loadImage`, `OverlayPanel.tsx` |
| `overlay:set` | `[string, OverlayApply \| null]` | `void` | `validateDeviceId` + `validateOptionalOverlayApply` | `DeviceFrame.tsx` (`useEffect` на смену настроек этого размера) |

Отдельного `MainEvent` у модуля нет: оверлей узнаётся из ответа `overlay:
image`/через собственный стор рендерера, батчить нечего — скролл для Side by
side едет по `scroll-state` (см. [guides.md](guides.md)).

## CDP

`webContents.insertCSS`/`removeInsertedCSS` (общий `CssLayer`) — слой
`html::before` в режиме Overlay. Собственного `Runtime.evaluate` у модуля
нет: размер слоя — ширина/высота картинки, известные заранее, а не измерение
документа.

## Персистентность

Слайс `designOverlays: OverlaysDocument` (`Record<WxH, OverlaySettings>` —
`{ imageId, mode, opacity, curtain, enabled }`) в `PersistedState`, по тому
же ключу `WxH`, что и `guides`. `MAX_OVERLAY_SIZES = 100` размеров;
`sanitizeOverlay` чинит поле за полем и роняет запись целиком только если
`imageId` не проходит `IMAGE_ID_RE` (без картинки показывать нечего);
`opacity`/`curtain` — `clampUnit` в `[0, 1]`. Запись — debounce 250 мс
(`OVERLAY_SAVE_DEBOUNCE_MS`, `stores/design-overlay.ts`) поверх общего
debounce диска 300 мс. Сами картинки (`overlayImages`) — отдельный ключ,
без debounce и без `SCHEMA_VERSION`-версионирования: это склад байтов с
собственным LRU, а не документ настроек. Слайс `designOverlays` тоже не
бампнул `SCHEMA_VERSION` — отсутствие поля читается как «нет оверлеев».

## Грабли

- CSP страницы **влияет** на инжектированный фон: `img-src 'self'` без
  `data:` блокирует загрузку картинки из `insertCSS`-слоя (страница остаётся
  белой) — гипотеза плана «CSP не влияет» опровергнута фактической проверкой
  (`e2e/fixtures/overlay-csp.html`). `Page.setBypassCSP` отвергнут — он
  замаскировал бы настоящий CSP-баг разработчика страницы, а не решил
  проблему; для таких страниц — режим Side by side, зафиксировано и в тексте
  диалога, и e2e-ассертом.
- Radix `Slider`: `aria-label` должен быть на `Thumb` (там `role="slider"`),
  не на `Root` — иначе ассистивные технологии не видят подписи Opacity/
  Curtain.
- Картинка шире вьюпорта сжимается через `max-width: 100%` — без этого
  широкий мокап растягивал бы страницу горизонтальным скроллом.

## Тесты

Юниты: `main/__tests__/design-overlay.test.ts` (`DesignOverlayManager`:
store/evict/LRU, `overlayCss`, pending/chain против фейкового CDP),
`stores/__tests__/design-overlay.test.ts`; overlay также затронул
`stores/__tests__/scroll.test.ts` и `main/__tests__/guides.test.ts` (общий
`pending`-паттерн), плюс `validate.test.ts`/`persistence-types.test.ts`.
E2e: `overlay.spec.ts` — 50% opacity даёт полумагенту, 100% — сплошную
магенту, curtain 50 — слева белое/справа магента, Side by side — страница
чистая и рядом панель с `<img>`, reload сохраняет настройки, файл 11 MB
получает отказ «up to 10 MB», страница с CSP остаётся белой, рестарт
восстанавливает оверлей; фикстура `e2e/fixtures/overlay-csp.html`.

## Связанные документы

Спека [§5.7](../superpowers/specs/2026-08-28-respo-design.md#57-инструменты-дизайнера).
Смежные модули: [guides.md](guides.md) (тот же `pending`-паттерн, общий канал
скролла для Side by side), [diagnostics.md](diagnostics.md) и
[debug-css.md](debug-css.md) (тот же `insertCSS`-слой на устройство),
[emulation.md](emulation.md) (слайс без бампа `SCHEMA_VERSION`).
