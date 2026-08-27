# Промпты для генерации концептов дизайна Respo (DESIGN-01)

> Четыре направления. Каждый промпт самодостаточен (анатомия окна вшита в каждый),
> на английском — так лучше работают генераторы (v0, Figma Make, Midjourney, Claude и т.п.).
> Цель этапа — выбрать визуальное направление, из которого соберём кастомную тему shadcn.
> Выбор фиксируется записью в ROADMAP §11.

Общая анатомия окна (одинакова во всех промптах, чтобы концепты были сравнимы):
верхний бар (навигация + адресная строка + инструменты), канвас с 5 девайс-вьюпортами
одного сайта, панель DevTools внизу, статус синхронизации.

---

## Концепт 1 — «Dark Pro» (Linear/Vercel-вайб)

```
Design a desktop app UI concept (single 1920x1200 screenshot, no device mockup around it) for "Respo" — a responsive web development browser that shows one website in many device viewports simultaneously.

Layout anatomy (must follow):
- Slim top bar: back/forward/reload icons, centered URL address bar (with favicon, a site-permissions shield icon and a bookmark star inside), right cluster: rotate-all, inspect, screenshot, page dark/light toggle, device-suite dropdown labeled "iPhone + iPad + Desktop", "+" button, kebab overflow menu.
- Main canvas: 5 floating device viewports rendering the SAME modern landing page — iPhone 15 Pro (393×852), Pixel 8 (412×915), iPad Mini (744×1133, slightly smaller scale), MacBook viewport (1280×800, scaled down). Each viewport has a compact header: device name, dimensions like "393 × 852", and 5 tiny toolbar icons (reload, rotate, camera, code, ruler).
- One viewport is "active" with a subtle accent outline; a small "SYNC" indicator chip shows interactions are mirrored.
- Docked Chrome-DevTools-style panel at the bottom (~220px tall), slightly abstracted.

Style direction — professional dark developer tool, Linear/Vercel aesthetic: near-black background (#0A0A0B), very subtle 1px hairline borders (#26262B), one electric accent color (violet #7C6CFF) used sparingly for active states, Inter/Geist typography, 8px corner radius, tabular numerals for dimensions, faint glow on the active viewport, generous negative space, no gradients, no noise. Crisp, quiet, fast-looking. Flat 2D UI screenshot, sharp text, high fidelity.
```

## Концепт 2 — «Light Studio» (Arc/Figma-вайб)

```
Design a desktop app UI concept (single 1920x1200 screenshot, no device mockup around it) for "Respo" — a responsive web development browser that shows one website in many device viewports simultaneously.

Layout anatomy (must follow):
- Slim top bar: back/forward/reload icons, centered URL address bar (with favicon, a site-permissions shield icon and a bookmark star inside), right cluster: rotate-all, inspect, screenshot, page dark/light toggle, device-suite dropdown labeled "iPhone + iPad + Desktop", "+" button, kebab overflow menu.
- Main canvas: 5 floating device viewports rendering the SAME modern landing page — iPhone 15 Pro (393×852), Pixel 8 (412×915), iPad Mini (744×1133, slightly smaller scale), MacBook viewport (1280×800, scaled down). Each viewport has a compact header: device name, dimensions like "393 × 852", and 5 tiny toolbar icons (reload, rotate, camera, code, ruler).
- One viewport is "active" with a subtle accent outline; a small "SYNC" indicator chip shows interactions are mirrored.
- Docked Chrome-DevTools-style panel at the bottom (~220px tall), slightly abstracted.

Style direction — light, calm design-studio tool, Arc Browser / Figma aesthetic: warm off-white canvas (#F6F5F2), device viewports as white cards with large soft diffused shadows, 12–14px rounded corners, one confident accent (coral #FF6B4A or cobalt #2D5BFF), colorful small device-type chips (phone/tablet/desktop in different muted pastel tints), friendly medium-weight sans (Inter/SF), airy spacing, slightly playful but clearly professional. Flat 2D UI screenshot, sharp text, high fidelity.
```

## Концепт 3 — «Blueprint» (инженерный верстак)

```
Design a desktop app UI concept (single 1920x1200 screenshot, no device mockup around it) for "Respo" — a responsive web development browser that shows one website in many device viewports simultaneously.

Layout anatomy (must follow):
- Slim top bar: back/forward/reload icons, centered URL address bar (with favicon, a site-permissions shield icon and a bookmark star inside), right cluster: rotate-all, inspect, screenshot, page dark/light toggle, device-suite dropdown labeled "iPhone + iPad + Desktop", "+" button, kebab overflow menu.
- Main canvas: 5 floating device viewports rendering the SAME modern landing page — iPhone 15 Pro (393×852), Pixel 8 (412×915), iPad Mini (744×1133, slightly smaller scale), MacBook viewport (1280×800, scaled down). Each viewport has a compact header: device name, dimensions like "393 × 852", and 5 tiny toolbar icons (reload, rotate, camera, code, ruler).
- One viewport is "active" with a subtle accent outline; a small "SYNC" indicator chip shows interactions are mirrored.
- Docked Chrome-DevTools-style panel at the bottom (~220px tall), slightly abstracted.

Style direction — precision engineering workbench, CAD/blueprint aesthetic: deep graphite background (#14171A) with a faint dotted grid pattern on the canvas, sharp 2–4px corners, dense compact toolbars, amber accent (#FFB224) for active states and measurements, dimensions and coordinates in a monospace font (JetBrains Mono), thin crosshair/measurement guide lines between viewports, small technical labels in uppercase micro-type, high contrast, utilitarian and instrument-like. Flat 2D UI screenshot, sharp text, high fidelity.
```

## Концепт 4 — «Soft Glass» (современный тёплый дарк)

```
Design a desktop app UI concept (single 1920x1200 screenshot, no device mockup around it) for "Respo" — a responsive web development browser that shows one website in many device viewports simultaneously.

Layout anatomy (must follow):
- Slim top bar: back/forward/reload icons, centered URL address bar (with favicon, a site-permissions shield icon and a bookmark star inside), right cluster: rotate-all, inspect, screenshot, page dark/light toggle, device-suite dropdown labeled "iPhone + iPad + Desktop", "+" button, kebab overflow menu.
- Main canvas: 5 floating device viewports rendering the SAME modern landing page — iPhone 15 Pro (393×852), Pixel 8 (412×915), iPad Mini (744×1133, slightly smaller scale), MacBook viewport (1280×800, scaled down). Each viewport has a compact header: device name, dimensions like "393 × 852", and 5 tiny toolbar icons (reload, rotate, camera, code, ruler).
- One viewport is "active" with a subtle accent outline; a small "SYNC" indicator chip shows interactions are mirrored.
- Docked Chrome-DevTools-style panel at the bottom (~220px tall), slightly abstracted.

Style direction — modern soft-glass dark UI: deep warm charcoal background with a very subtle radial gradient (aubergine-to-charcoal), toolbars and DevTools panel as frosted-glass surfaces (blur, 1px inner light border, slight translucency), device viewports as elevated cards floating with layered depth shadows, one gradient accent (teal→blue) for the active viewport outline and primary buttons, 16px rounded corners, soft glows kept tasteful and minimal, refined sans typography (Inter), premium "AI-era product" feel without kitsch. Flat 2D UI screenshot, sharp text, high fidelity.
```

---

**Как пользоваться:** прогони все четыре в своём генераторе, отбери направление (можно
гибрид «база X + акценты Y»), скинь выбранное координатору — из него соберём токены
кастомной темы shadcn (палитра, радиусы, типографика) и зафиксируем дизайн-систему
записью в ROADMAP §11, после чего стартует PLAN-01.
