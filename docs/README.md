# Документация Respo — карта библиотеки

Единый источник правды об устройстве **Respo**. Правило **doc-as-code**:
меняется код — в том же изменении правится профильный документ.

Полировка UI 0.1.1: [слои нативных превью, typography, scrollbar и screenshot workflow](modules/ui-surfaces.md).

> Новичку (человеку или агенту) рекомендуемый маршрут:
> [`../CLAUDE.md`](../CLAUDE.md) → [ROADMAP.md](ROADMAP.md) §10/§11 →
> профильный документ области ниже.

---

## Спецификации и дизайн

| Документ | О чём |
|---|---|
| [superpowers/specs/2026-08-28-respo-design.md](superpowers/specs/2026-08-28-respo-design.md) | **Спецификация проекта** — источник правды: цели, стек, архитектура (§4), полный каталог функционала (§5), безопасность (§7a), перф-бюджеты (§8), риски (§9a), структура (§12) |
| [design/DESIGN-CONCEPT-PROMPTS.md](design/DESIGN-CONCEPT-PROMPTS.md) | Промпты для генерации визуальных концептов UI (этап DESIGN-01) |
| [design/DESIGN-SYSTEM.md](design/DESIGN-SYSTEM.md) | Дизайн-система (токены Family, тёмная тема, плотность, анимации) — обязательный контекст UI-задач |
| [superpowers/plans/](superpowers/plans/) | Планы волн реализации (W1–W7); актуальные — `2026-09-05-w5|w6|w7-*.md` |
| [research/](research/) | Исследования: конкуренты, MCP-экосистема, матрица спека↔код (2026-09-05) |
| [modules/updater.md](modules/updater.md) | Автообновление (electron-updater + чип Update), About, файловый лог (electron-log), тестовый loopback-фид для e2e |
| Реверс-доки модулей (`modules/`) | остальные — по мере волн W5–W7 (по одному файлу на модуль main) |
| [modules/device-catalog.md](modules/device-catalog.md) | Каталог устройств: источники, лицензия, стабильность id, приближения |
| [modules/emulation.md](modules/emulation.md) | Emulation pack + Client Hints: EmulationManager, CDP-методы, vision пер-девайс |
| [modules/reliability.md](modules/reliability.md) | Краш-оверлей и restart, reload/scroll-to-top пер-девайс, политика popups |
| [modules/diagnostics.md](modules/diagnostics.md) | Счётчики ошибок консоли и overflow-скан, чипы и подсветка |
| [modules/guides.md](modules/guides.md) | Линейки и направляющие: canvas-полосы, CSS-слой, скролл-трекинг без нового IPC-потока |
| [modules/design-overlay.md](modules/design-overlay.md) | Design Overlay: хранилище картинок, CSS-слой, side-by-side, ограничение CSP |
| [modules/file-watcher.md](modules/file-watcher.md) | Live-reload для `file://`: chokidar, css hot-swap, индикатор |
| [modules/debug-css.md](modules/debug-css.md) | Debug ▸ Outline all elements: глобальный CSS-слой |

## Управление проектом

| Документ | О чём |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Дорожная карта: §10 живой трек работ + §11 журнал решений |
| [prompts/](prompts/) | Шаблоны и активные промпты для агентов-исполнителей и dispatch-волн |
| [progress/](progress/) | Отчёты о завершённых волнах/фазах |
| [`../CLAUDE.md`](../CLAUDE.md) | Правила для любого Claude Code инстанса |
| [`../.claude/commands/lead.md`](../.claude/commands/lead.md) | Слэш-команда `/lead` — роль координатора-оркестратора |

---

## Соглашения

- **Язык** — русский (UI приложения — английский). **Ссылки на код** — кликабельные пути с номером строки.
- **Статус-маркеры:** ✅ готово · 🟡 в работе · ⚠️ требует внимания · ❌ проблема · ⬜ запланировано.
- Профильные документы описывают *как оно работает*; справочники — *где что лежит*;
  ROADMAP — *что и когда делаем*.
- Документы перекрёстно ссылаются через секцию «Связанные документы».
