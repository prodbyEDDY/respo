# Эмуляция окружения (`src/main/emulation.ts`)

**Назначение.** `DeviceSpec` описывает экран; `EmulationProfile` — то, что предпочитает
*человек*: тёмная тема, меньше анимаций, медленная сеть, город, язык, часовой пояс,
нарушение цветовосприятия (спека §5.2, §5.10). Профиль один и глобальный — по канвасу
гуляет одна страница во многих вьюпортах, и её проверяют против одного окружения
одновременно. Исключение — симуляция зрения: вопрос «как это видно при дейтеранопии»
лучше всего звучит как два одинаковых кадра рядом, один с фильтром и один без, поэтому
её можно переопределить на одном девайсе поверх глобального профиля.

## Как работает

`EmulationManager` хранит профиль и `Map<deviceId, VisionDeficiency>` — только
исключения, как у `rotated`/`sync.disabledDeviceIds`. И профиль, и оверрайд живут
независимо от того, есть ли сейчас у девайса вьюшка: `retain`/`unregisterDevice`
сохраняют оверрайд, чтобы девайс, ушедший из сьюта и вернувшийся, снова был
дейтеранопом. `resolveViewEmulation` сворачивает профиль + оверрайд в `ViewEmulation`
и отдаёт `CDPController.applyEmulation`, который диффит по группам (media/vision/
network/geolocation/timezone/locale) — меняется одна CDP-команда на изменённую
группу, а не весь набор на каждый чих.

- `shared/client-hints.ts` выводит `Sec-CH-UA-*` из UA-строки девайса, а не хранит
  их полем `DeviceSpec` — иначе каталог и кастомные девайсы были бы обязаны быть
  правыми дважды. Не-Chromium UA (Safari/Firefox) хинтов не получает вовсе.
- Locale и Accept-Language едут одним CDP-вызовом (`sendUserAgent`): второй вызов
  `Network.setUserAgentOverride` стёр бы первый, протокол не умеет частичный оверрайд.
- При реаттаче CDP-сессии (`CDPController.onDetach`) реплей идёт в порядке device →
  emulation (`force: true`) → runtime — эмуляция живёт в сессии, а не в документе.

## IPC

| Канал | Args | Result | Валидатор (`main/validate.ts`) | Кто вызывает |
|---|---|---|---|---|
| `emulation:set` | `[EmulationProfile]` | `void` | `validateEmulationProfile` | `EmulatePopover` → `stores/emulation.ts` `setProfile`/`resetAll` |
| `emulation:set-device-vision` | `[string, VisionDeficiency \| null]` | `void` | `validateDeviceId` + `validateOptionalVisionDeficiency` | kebab `Vision ▸` (`DeviceFrame.tsx`) → `setDeviceVision` |
| `emulation:get` | `[]` | `EmulationStatePayload` | — (без аргументов) | рендерер при старте |

Отдельного `MainEvent` у модуля нет: профиль применяется до первой вьюшки, а
`emulation:get` — ответ для только что стартовавшего рендерера.

## CDP

`Emulation.setEmulatedMedia` (media + `prefers-color-scheme`/`prefers-reduced-motion`/
`forced-colors` как features) · `Emulation.setEmulatedVisionDeficiency` ·
`Network.emulateNetworkConditions` · `Emulation.setGeolocationOverride`/
`clearGeolocationOverride` · `Emulation.setTimezoneOverride` ·
`Emulation.setLocaleOverride` · `Network.setUserAgentOverride` (с фолбэком на
`Emulation.setUserAgentOverride` для другой версии протокола) — несёт `userAgent`,
`acceptLanguage` и `userAgentMetadata` одним вызовом.

## Персистентность

Слайс `emulation: EmulationSettings` (`{ profile, deviceVision }`) в
`PersistedState`. Ремонт по полю — `sanitizeEmulationProfile`/`sanitizeEmulation`
(`shared/persistence-types.ts`): битый timezone не должен стоить пользователю тёмной
темы. `deviceVision` ограничен `MAX_DEVICE_VISION = 256` записей и там, и в
`validateEmulationSettings`. Добавление слайса не бампнуло `SCHEMA_VERSION` —
отсутствие поля читается как «дефолты», как у `layout`/`devtools`.

## Грабли

- Мусорный `timezoneId` Chromium отвергает («Invalid timezone id» в логе, остальные
  overrides применяются); мусорную `locale` — молча принимает, поэтому валидация
  BCP 47/IANA на нашей стороне (`isLocaleTag`/`isTimezoneId`) обязательна.
- `Network.emulateNetworkConditions` не действует на `file://` — загрузчик локальных
  файлов минует network service; e2e поднимает http-сервер для offline-проверки.
- Full version list в Client Hints берётся из `process.versions.chrome` только когда
  его major совпадает с `Chrome/NNN` в UA-строке — иначе страница, сверяющая
  `Sec-CH-UA-Full-Version-List` с `navigator.userAgent`, увидела бы два браузера.
- Все overrides живут в CDP-сессии и переживают навигацию/reload без реаппликации —
  реплей нужен только после реального отвала сессии.

## Тесты

Юниты: `shared/__tests__/emulation.test.ts`, `client-hints.test.ts`;
`main/__tests__/emulation.test.ts` (`EmulationManager` против фейкового CDP);
`cdp-controller.test.ts` → `applyEmulation`/`Client Hints`; `validate.test.ts` →
`emulation payloads`; `persistence-types.test.ts` → `the emulation slice`;
`stores/__tests__/emulation.test.ts`. E2e: `emulation-pack.spec.ts`
(media/network/location/locale/timezone на реальном Chromium), `emulation.spec.ts`
(UA + Client Hints по каталогу), `vision.spec.ts` (пер-девайс оверрайд, пиксели).

## Связанные документы

Спека [§5.2 «Эмуляция устройств», §5.10 «Emulation pack (W5)»](../superpowers/specs/2026-08-28-respo-design.md).
Смежные модули: [device-catalog.md](device-catalog.md) (источник UA),
[reliability.md](reliability.md) (реплей эмуляции при реаттаче/рестарте) и
[diagnostics.md](diagnostics.md)/[guides.md](guides.md)/[design-overlay.md](design-overlay.md)/
[debug-css.md](debug-css.md) — та же регистрация по девайсу поверх CDP.
