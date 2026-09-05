# Надёжность страницы (`src/main/view-manager.ts`, `view-backend.ts`, `security.ts`)

**Назначение.** Что происходит, когда одна из N живых страниц падает или ведёт себя
странно: упавший рендерер получает свою карточку и кнопку Restart, а не тянет вниз
остальные девайсы; reload и «reload ignoring cache» бьют по одному девайсу или по
всем сразу, но никогда по упавшему; попапы (`window.open`) открываются только у
ведущего вьюпорта и на общей партиции, чтобы один клик не превратился в пять окон
(спека §5.1, §5.4, §7, §7a).

## Как работает

`watchLoadState` (`view-backend.ts`) переводит события `webContents` в
`LoadStatePayload`: `render-process-gone` — это **не** `failed`, а отдельное
состояние `crashed`, потому что у него другие слова («страница упала», а не «не
загрузилась»), другая кнопка (Restart, а не Retry) и другое правило — общий reload
его обходит, а `restart` работает только с ним. `ViewManager.reportLoadState`
защёлкивает `entry.crashed`/`entry.failed` и прячет вьюшку (`applyVisibility`) —
рендерер рисует карточку поверх пустого места, потому что `WebContentsView`
композитится над всем окном и ничто нарисованное в DOM не может лечь сверху живой
страницы.

- `reload({deviceId?})` без `deviceId` — все вьюшки, кроме `entry.crashed`; с
  `deviceId` — конкретная, включая упавшую (это не её путь назад).
- `restart(deviceId)` — работает только для `entry.crashed`; вызывает тот же
  `wc.reload()`, что и обычный reload, но CDP-сессия остаётся приаттаченной к
  `webContents`, и Chromium восстанавливает эмуляцию в новый процесс сам
  (`e2e/reliability.spec.ts` проверяет вьюпорт после рестарта).
- Попапы: `view.webContents.setWindowOpenHandler(({url}) => popupDecision(url,
  isLead?.(device.id)))` — решение только по признаку «ведущий или нет», url и
  партиция не участвуют в этом выборе. `did-create-window` вешает на дочернее окно
  `setWindowOpenHandler(() => ({action:'deny'}))` (попап из попапа запрещён) и
  закрывает его вместе с канвасом.

## IPC

| Канал | Args | Result | Валидатор | Кто вызывает |
|---|---|---|---|---|
| `nav:reload` | `[ReloadRequest?]` | `void` | `validateReloadRequest` | тулбар (все), kebab «Reload»/«Reload ignoring cache», `Mod+R`/`Mod+Shift+R` (`useNavHotkeys`) |
| `view:restart` | `[string]` | `void` | `validateDeviceId` | кнопка Restart на карточке `PageCrashed` |
| `view:scroll-to-top` | `[string]` | `void` | `validateDeviceId` | kebab «Scroll to top» |

`MainEvent` — `{ type: 'load-state', payload: LoadStatePayload[] }`, тот же батч,
что и у обычной загрузки; `crashed` — просто ещё одно значение `LoadState`.

## CDP

Ничего специфичного для краша — `restart` это обычный `wc.reload()`, а живучесть
эмуляции обеспечивает не этот модуль, а то, что CDP-сессия (`cdp-controller.ts`)
привязана к `webContents`, а не к документу. Попапы получают свой собственный
`WebContentsView`-эквивалент (`BrowserWindow` с теми же `webPreferences`), а не CDP.

## Грабли

- `webContents.executeJavaScript` на только что упавшем рендерере может зависнуть
  навсегда (замечено в e2e — тест висел 2 минуты) — перед любым обращением к
  упавшей вьюшке проверять `wc.isCrashed()`.
- Раньше попап у не-ведущего вьюпорта уходил во внешний браузер (один клик = пять
  вкладок, реплей клика во все зеркала); теперь `popupDecision` тихо отказывает
  всем, кроме лидера — без диалога, потому что «зеркало открыло окно» не решение
  пользователя.
- Popup-окно наследует `sandbox`/`contextIsolation`/`nodeIntegration:false` и
  партицию `persist:respo` (общие куки с device-сессией — иначе OAuth-редирект не
  узнаёт залогиненную сессию), но не preload и не собственные попапы.
- `rmSync` временного профиля на Windows ловит `EBUSY` на файле сессионной БД —
  `ownProfile` теперь с `maxRetries` и предупреждением вместо падения.
- Mobile-эмуляция Chromium вообще не рисует скроллбары (пиксельная проба
  `Page.captureScreenshot`) — отдельный `insertCSS`/тумблер «Hide mobile
  scrollbars» не нужен и не сделан, спека §5.1 приведена к этому факту.

## Тесты

Юниты: `main/__tests__/view-manager.test.ts` → `ViewManager — crashes, per-device
reload, scroll to top`; `view-backend.test.ts` → `watchLoadState — renderer
crashes`; `security.test.ts` → `popupDecision` (лидер/не-лидер/http-only/попап из
попапа); `validate.test.ts` → `validateReloadRequest`; `hooks/__tests__/
useNavHotkeys.test.ts`. E2e: `reliability.spec.ts` — `forcefullyCrashRenderer()` на
одном девайсе → карточка только у него, остальные 4 живы; Restart → готовность +
эмуляция восстановлена; клик в лидере → ровно одно попап-окно с device-партицией
без Node; зеркальные клики в 4 последователя и прямой клик в не-лидере — 0 окон.

## Связанные документы

Спека [§5.1, §5.4, §7, §7a](../superpowers/specs/2026-08-28-respo-design.md)
(превью и раскладки, навигация и попапы, обработка ошибок, безопасность).
Смежные модули: [emulation.md](emulation.md) (что реплеится при рестарте),
[device-catalog.md](device-catalog.md) (метрики, восстанавливаемые после краша).
