# Отчёт — W4 «Address Features + Layouts»

**Период:** 2026-08-28 … 2026-09-03 · **Статус:** ✅ завершено (merge 23dbcf4)

## Что сделано

- **Флейк sync.spec убит с корнем:** e2e без `--user-data-dir` делил дефолтный профиль Electron с dev-запусками владельца — выключенный когда-то SYNC-тумблер детерминированно ронял mirror-тесты. Теперь у каждого spec свой профиль (5×15/15 подряд).
- **Раскладки:** Column / Flex / Masonry / Individual (таб-полоса), `mod+shift+l`, чистая геометрия в planLayout, persist.
- **Адресный кластер:** закладки (звезда/редактор/список), история в main (кап 2000, favicon data-URL без внешних сервисов, саджесты), домашняя, «Open File…», очистки storage/cookies/cache (origin считает только main) + хоткеи.
- **Разрешения сайтов:** ask-UI вместо deny-all — PermissionsManager (persist по origin+type, коалесинг, id-корреляция, dismiss), инлайн-промпт, панель-щит (8 типов, цикл Allow/Block/Ask, Reset), fullscreen по умолчанию allow.
- **HTTP Basic Auth** (коалесинг по host+realm+proxy, пароли нигде не сохраняются) + **Allow invalid certificates** (только для вьюшек, никогда для UI-окна).

## Проверка

typecheck ✅ · vitest 1200 (+48 фокусно после фикса) ✅ · e2e 28/28 ✅ · lint ✅. Финальное ревью — Sonnet 5 (длительный 529-outage opus-5): APPROVE WITH FIXES; Important-фикс (NUL-байт делал permissions.ts бинарным для git-диффов) закрыт, файл снова диффабелен.

## Follow-ups (фикс-бэклог W5)

- **Панель разрешений:** привязать setDecision/resetOrigin к показанному origin (echo-токен от main), не к origin на момент хендлера — узкая гонка (Minor из ревью).
- Продуктовое решение владельца: Cancel в auth-диалоге — «не сейчас» (повторный запрос от отставшего вьюпорта покажет диалог снова) или «один Cancel на залп».
- Favicon-фетч без content-length буферизует ответ до проверки размера (низкий риск); rmSync темп-профилей e2e может no-op при залоченных файлах Windows (следить за накоплением respo-e2e-*).
- API-инцидент: 7 срывов opus-5 (500/529) за волну — работа не потерялась благодаря resume + коммитам по задачам.
