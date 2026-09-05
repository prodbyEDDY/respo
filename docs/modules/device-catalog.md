# Каталог устройств (`src/shared/deviceCatalog.ts`)

**Назначение.** Список устройств, которые Respo умеет эмулировать: 110 записей
(W5, было 38 в W1) — iPhone, Android-телефоны, складные, планшеты, ноутбуки,
мониторы. Каждая запись — плоский `DeviceSpec` (`id`, `name`, `width`, `height`,
`dpr`, `userAgent`, `touch`, опционально `type`/`rotatable`); всё остальное
выводится: тип — `deviceTypeOf` (`shared/custom-devices.ts`), Client Hints —
`clientHintsOf` (`shared/client-hints.ts`), mobile-режим эмуляции — `isMobileDevice`
(`main/cdp-controller.ts`, по токенам UA).

## Источники и лицензия

- **Chromium DevTools** `front_end/models/emulation/EmulatedDevices.ts` (BSD-3-Clause,
  атрибуция в [`NOTICE.md`](../../NOTICE.md)) — метрики перепечатаны вручную, код не
  используется.
- **Публичные спецификации вендоров** — линейки 2025–2026 (iPhone 17/Air, Pixel 9/10,
  Galaxy S25, iPad M3/M4, Mac M4, мониторы), CSS-viewport в points.
- **Запрещено** (CLAUDE.md §1): данные `responsively-app` — не открывать и не сверять.

## Правила

- `id` — slug, **стабильный навсегда**: персистентные сьюты, `rotated`,
  `sync.disabledDeviceIds`, `emulation.deviceVision` ссылаются на него. Переименовать
  устройство можно, поменять id — нет (нужна миграция документа).
- Пять устройств дефолтного сьюта (`DEFAULT_ACTIVE_DEVICE_IDS`) и их метрики —
  контракт e2e (`emulation.spec.ts`, `sync.spec.ts`): `iphone-15-pro` 393×852@3,
  `pixel-8` 412×915@2.625, `ipad-mini` 768×1024@2, `macbook-1280` 1280×800@2,
  `desktop-1440` 1440×900@1.
- Версии в константах (`CHROME`, `IOS`, `ANDROID`) — одна правка на весь каталог.
  `CHROME` должен совпадать по major с движком приложения (`process.versions.chrome`):
  Client Hints выводятся из UA-строки, и full-version-list берётся из движка только
  при совпадении major (`userAgentMetadataFor`).
- Инварианты проверяет `src/shared/__tests__/deviceCatalog.test.ts`: ≥ 90 записей,
  уникальные id/имена, `dpr ∈ [1, 4]`, размеры 100..4096, UA непустой, phones/tablets
  `touch: true`, десктопы без touch кроме Surface, W1-устройства на месте.

## Известные приближения

Часть современных устройств взята из спецификаций по плотностным бакетам, а не из
Chromium: Galaxy S8–S25 (кроме S20 Ultra), Pixel 6/6 Pro/7 Pro, OnePlus, Nothing,
Galaxy Tab S9 Ultra/S10+, Pixel Tablet, Fire-планшеты, iPhone 17/Air. Уточнять по мере
появления в Chromium — метрики, не id.
