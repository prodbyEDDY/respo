# W4 «Address Features + Layouts» Implementation Plan

> Режим: 3 диспатча (A=T1+T2, B=T3+T4, C=T5+T6), без пер-таск ревью, финальное ревью + фикс-волна. Тесты фокусно; полный набор — раз на задачу перед коммитом.

**Goal:** Раскладки превью, весь адресный кластер (закладки/история/домашняя/открыть файл/очистки), разрешения сайтов с ask-UI, HTTP-auth, SSL-тумблер + стабилизация e2e-флейка синка.

**Spec:** §5.1 (раскладки), §5.4 (адресные фичи), §7a. Constraints — как прежние волны + UX-приоритет.

### Task 1: Стабилизация e2e sync.spec
Флейк scroll-mirror/link-mirror (падает и на чистом дереве). Диагностировать честно (systematic-debugging: воспроизвести, найти корень — тайминги готовности CDP? гонка lead-election? загрузка фикстур?), починить корень (в проде или в тесте — по правде), 5 подряд зелёных прогонов sync.spec как доказательство.

### Task 2: Раскладки Column / Flex / Masonry / Individual
`useLayout` расширить `mode: 'column'|'flex'|'masonry'|'individual'` (persist). Column — текущая. Flex — wrap-ряды по ширине канваса. Masonry — колоночная укладка по высоте (своя простая раскладка, без библиотек — вся геометрия уже в planLayout). Individual — один девайс на весь канвас + таб-полоса остальных (табы: имя+WxH, клик переключает; вход — кнопка expand в шапке девайса, выход — Esc/кнопка). Переключатель в kebab + `mod+shift+l` цикл. Виртуализация/культинг работают во всех режимах; зум-инварианты не ломаются (e2e-смоук individual).

### Task 3: Закладки, история, домашняя, «Открыть файл»
Стор `bookmarks` (persist): звезда в адресной строке (toggle, mod+d), popover редактирования (имя/URL/удалить), список в kebab→Bookmarks (переход по клику). История (main, persist, кап 2000 FIFO): записи {url,title,ts,favicon?} по факту навигации лида; favicon из `page-favicon-updated` → data-URL кэш (без внешних сервисов). Саджесты под адресной строкой (фильтр по title+url, стрелки+Enter, мышь), Clear history в kebab. Домашняя: иконка set/unset у адресной строки, загрузка при старте (persist). «Open File…» в kebab (`mod+o`): диалог в main → file:// навигация.

### Task 4: Очистки storage/cookies/cache
Кнопки-меню у адресной строки (DropdownMenu «Clear…»: Storage / Cookies / Cache / All) + хоткеи mod+alt+q/a/z/del. Main: session `persist:respo` — `clearStorageData` по origin текущего URL (storages по типу), `clearCache`. После очистки — reload всех вьюшек. Тост-подтверждение. Валидация origin в main.

### Task 5: Разрешения сайтов — ask-UI
Апгрейд deny-by-default: `PermissionsManager` (main, persist по origin+type, коалесинг одновременных запросов) → MainEvent `permission-request` → инлайн-промпт у адресной строки (Allow/Block, origin+тип с иконкой). Панель разрешений: щит-иконка в адресной строке → popover: 8 типов (camera, microphone, geolocation, notifications, clipboard-read, fullscreen, midi, pointerLock) со статусом Allow/Block/Ask (клик циклит), Reset all, баннер «Reload to apply». Persist аддитивно. Fullscreen — allow по умолчанию (UX: видео).

### Task 6: HTTP Basic Auth + Allow insecure SSL
`app.on('login')`: коалесинг по host, модалка (host, username/password, Cancel) — ответ строго тому запросу (correlation id, не `once` без фильтра). SSL: тумблер в Settings (persist) → `certificate-error` handler: если включён — allow для вьюшек (не для UI-окна), иначе deny; предупреждающая пометка в Settings. Пароли нигде не логируются и не персистятся.

## DoD W4
Все suites зелёные (sync.spec стабилен), финальное ревью + фикс-волна, отчёт, ROADMAP, грабли.
