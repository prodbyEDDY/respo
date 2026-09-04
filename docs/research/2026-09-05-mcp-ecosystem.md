# MCP-экосистема для Respo — исследование (2026-09-05)

> Research-агент (Sonnet 5) по заданию координатора. Основа для волны W7 «MCP». Все пути/форматы
> конфигов сверены с официальными доками на момент сбора; помеченное «проверить» — уточнить при реализации.

## 1. Состояние протокола MCP (2026)

- **Актуальная спека — `2026-07-28`** ([spec](https://modelcontextprotocol.io/specification), [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)): мажорный редизайн — протокол stateless (убраны `initialize`-хендшейк, `Mcp-Session-Id`, GET-стрим, resumability), появился `server/discover`, паттерн MRTR (`InputRequiredResult`), Roots/Sampling/Logging — deprecated. Под неё — **новый TS SDK v2** (`@modelcontextprotocol/server` + `@modelcontextprotocol/client` + `@modelcontextprotocol/node`), Apache-2.0/MIT, **бета** ([blog](https://blog.modelcontextprotocol.io/posts/sdk-betas-2026-07-28/)).
- **Практика:** клиенты (Claude Code, Cursor, VS Code, Codex…) в массе говорят на «классическом» поколении (≤ `2025-06-18`) через **`@modelcontextprotocol/sdk` v1.x (latest 1.30.0, MIT)** ([npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)). **Рекомендация:** строить на стабильном v1-SDK, архитектурно изолировав транспорт/регистрацию для будущей миграции на v2.
- **Транспорты (2025-06-18):** stdio (сервер как подпроцесс; в stdout — только MCP-сообщения, логи — в stderr) и **Streamable HTTP** (один endpoint POST+GET, ответ JSON или SSE, сессии через `Mcp-Session-Id`).
- **Безопасность локального HTTP** ([transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)): сервер MUST валидировать `Origin` (DNS rebinding → 403); SHOULD биндиться только на `127.0.0.1`; SHOULD аутентифицировать соединения. В SDK v1 DNS-rebinding-защита **по умолчанию выключена** ([GHSA-w48q-cv73-mx4w](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-w48q-cv73-mx4w)) — включать явно: `StreamableHTTPServerTransport({ enableDnsRebindingProtection: true, allowedHosts, allowedOrigins, sessionIdGenerator })`.
- **Content результата тула** ([tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)): `text`, `image` (`{type:'image', data: base64, mimeType}`), `audio`, `resource_link`, embedded `resource`. **Структурированный вывод:** `outputSchema` + `structuredContent` (дублировать JSON текстом в `content`).
- **Аннотации:** `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`, `title` — клиенты считают их untrusted.
- **SDK API v1:** `new McpServer({name, version})`, `server.registerTool(name, {description, inputSchema: zodShape, annotations}, handler)`, `new StdioServerTransport()`, `new StreamableHTTPServerTransport({...})`.
- **Грабли в Electron main:** single-instance lock обязателен (два процесса — борьба за порт); Windows Firewall может спросить даже для `127.0.0.1` — предупредить в UI; ESM/CJS-интероп (как с electron-store); порт должен быть известен до генерации сниппетов в renderer.

## 2. Конфигурация по клиентам

Закономерность: root-ключ почти везде `mcpServers`, у **VS Code — `servers`**; HTTP-URL называется `url` / `httpUrl` (Gemini) / `serverUrl` (Windsurf, Antigravity); тип HTTP — `http` / `streamableHttp` (Cline) / `streamable-http` (Roo, Continue).

| Клиент | Файл (Win / macOS) | Форма | CLI / deeplink | HTTP нативно |
|---|---|---|---|---|
| **Claude Code** | project `.mcp.json`; user `%USERPROFILE%\.claude.json` / `~/.claude.json` | `{"mcpServers":{"respo":{"type":"http","url":"http://127.0.0.1:PORT/mcp","headers":{"Authorization":"Bearer TOKEN"}}}}` | `claude mcp add --transport http respo URL --header "Authorization: Bearer TOKEN"`; `--scope user\|project\|local` | ✅ ([docs](https://code.claude.com/docs/en/mcp)) |
| **Claude Desktop** | `%APPDATA%\Claude\claude_desktop_config.json` / `~/Library/Application Support/Claude/claude_desktop_config.json` | `mcpServers` + `command`/`args` | — | ❌ raw-JSON → stdio-мост (`mcp-remote`) или UI «Connectors» |
| **Codex CLI** | `~/.codex/config.toml` (глобально), `.codex/config.toml` (проект) | `[mcp_servers.respo]\nurl = "http://127.0.0.1:PORT/mcp"\nbearer_token_env_var = "RESPO_MCP_TOKEN"`; stdio: `command`/`args`/`env` | `codex mcp add respo --url URL` | ✅ ([docs](https://developers.openai.com/codex/mcp)) |
| **Cursor** | `.cursor/mcp.json` / `%USERPROFILE%\.cursor\mcp.json` | `mcpServers` + `url` или `command`/`args` | deeplink `cursor://anysphere.cursor-deeplink/mcp/install?name=NAME&config=BASE64(JSON)` ([docs](https://cursor.com/docs/context/mcp/install-links)) | ✅ |
| **Windsurf** | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` / `~/.codeium/windsurf/mcp_config.json` | HTTP — поле **`serverUrl`**; stdio — `command`/`args` | — | ✅ ([docs](https://docs.windsurf.com/plugins/cascade/mcp)) |
| **VS Code (Copilot)** | `.vscode/mcp.json` (workspace); user — команда `MCP: Open User Configuration` | root **`servers`**, `{"type":"http","url":...}` | `code --add-mcp "{\"name\":\"respo\",\"type\":\"http\",\"url\":\"...\"}"`; deeplink `vscode:mcp/install?ENCODED_JSON` (`vscode-insiders:` тоже) | ✅ ([docs](https://code.visualstudio.com/docs/agent-customization/mcp-servers)) |
| **Cline** | `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json` | HTTP: **`"type":"streamableHttp"`** | — | ✅ ([docs](https://docs.cline.bot/mcp/mcp-overview)) |
| **Roo Code** | глобально `mcp_settings.json`, проект `.roo/mcp.json` | HTTP: **`"type":"streamable-http"`** | — | ✅ |
| **Zed** | `~/.config/zed/settings.json` (Windows-путь — проверить) | ключ `context_servers`, `{"source":"custom","command":...,"args":[...]}` | — | 🟡 stdio-first |
| **Gemini CLI** | `%USERPROFILE%\.gemini\settings.json` / `~/.gemini/settings.json`; проект `.gemini/settings.json` | `mcpServers` + **`httpUrl`** | — | ✅ ([docs](https://geminicli.com/docs/tools/mcp-server/)) |
| **JetBrains AI / Junie** | UI-диалог (Settings → Tools → AI Assistant → MCP); Junie — `.junie/mcp/mcp.json` | вставка `{"mcpServers":{...}}` | — | ✅ |
| **Kiro** | `.kiro/settings/mcp.json`; `%USERPROFILE%\.kiro\settings\mcp.json` | `url`+`headers`; stdio `command`/`args`/`autoApprove` | — | ✅ ([docs](https://kiro.dev/docs/mcp/configuration/)) |
| **OpenCode** | `opencode.json` | `type:"remote"`+`url`+`enabled`; stdio `type:"local"`+`command:[...]` | — | ✅ |
| **Warp** | `.warp/.mcp.json` или MCP Panel | JSON | `--mcp` (cloud agents) | 🟡 Windows preview |
| **Antigravity** | `~/.gemini/config/mcp_config.json`; проект `.agents/mcp_config.json` | `mcpServers` + **`serverUrl`** | — | ✅ |
| **Trae** | `.trae/mcp.json` или UI | stdio/SSE; Streamable HTTP — проверить | — | 🟡 → мост |
| **Continue** | `~/.continue/config.yaml`; проект `.continue/config.yaml` | YAML-список: `mcpServers:\n- name: Respo\n  type: streamable-http\n  url: ...\n  apiKey: TOKEN` | — | ✅ |

**HTTP vs bridge:** большинство актуальных клиентов понимают Streamable HTTP нативно (разными именами полей). Универсальный stdio-мост для остальных — **`mcp-remote`** (npm, 0.8.3) ([npm](https://www.npmjs.com/package/mcp-remote)).

## 3. Логотипы клиентов

- **Simple Icons** (SVG — CC0; товарные знаки — отдельно, [DISCLAIMER](https://github.com/simple-icons/simple-icons/blob/master/DISCLAIMER.md)). Проверено по CDN: **есть** `claude`, `cursor`, `openai`, `visualstudiocode`, `googlegemini`, `jetbrains`, `warp`, `codeium`, `windsurf`; **нет** `zed`; вероятно нет Kiro, OpenCode, Antigravity, Trae, Cline, Roo, Continue.
- **LobeHub `@lobehub/icons`** (MIT, [repo](https://github.com/lobehub/lobe-icons)) — 1600+ иконок AI-инструментов; пакет **`@lobehub/icons-static-svg`** — сырые SVG без React. Подтверждено: Cursor, Windsurf, Trae, Antigravity.
- **Рекомендация:** основной источник — `@lobehub/icons-static-svg` (MIT) + Simple Icons (CC0) для классических брендов; копировать нужные SVG в репо как статические ассеты (не тащить весь пакет в бандл). Fallback — монограмма в цветном круге. В футере экрана: «Logos belong to their owners and are used for identification only».

## 4. Prior art: дизайн тулов

- **Playwright MCP** (`@playwright/mcp`, Apache-2.0) — главный референс: `browser_navigate`, `browser_click/type/hover/press_key/fill_form`, **`browser_snapshot`** (a11y-дерево текстом, read-only — основной способ «видеть»), `browser_take_screenshot` (`fullPage`, `filename`), `browser_resize`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_wait_for`, `browser_tabs`; opt-in группы. Принцип: **текстовый snapshot вместо пикселей**, тулы помечены read-only.
- **Chrome DevTools MCP** (Google, Apache-2.0) — input, navigation, performance-трейсы, debugging (console, screenshot, DOM snapshot, Lighthouse, `evaluate_script`), network.
- **Browser MCP**, **Browserbase MCP** (Apache-2.0) — облачные/NL-driven, не модель для Respo.
- **Скриншоты:** блок `{type:'image', data, mimeType:'image/png'}`; при батчах — путь к файлу/`resource_link` вместо inline base64 (экономия контекста).

## 5. Рекомендуемая архитектура MCP Respo

- **(a) Streamable HTTP на `127.0.0.1`**, фиксированный дефолтный порт с фолбэком на эфемерный; токен — 32 байта hex, генерируется при первом запуске, хранится в userData (`%APPDATA%\Respo\mcp\auth.json`); `Authorization: Bearer` + Origin-валидация + bind только loopback. Стандартного «well-known port file» в MCP нет — прикладное решение по аналогии с Ollama/LM Studio.
- **(b) stdio-мост** — опубликованный npm-шим `respo-mcp` (обёртка над `mcp-remote`, читает порт/токен из `auth.json`; понятная ошибка «Respo is not running») вместо `Respo.exe --mcp` (путь меняется при обновлениях). До публикации на npm — локальный скрипт в userData как промежуточный вариант.
- **(c) UI «Connect your agent»:** сетка логотипов → выбор → точный сниппет с живыми port+token, Copy; «Open config file» (по известному пути ОС); deeplink (Cursor, VS Code); CLI-однострочник (Claude Code, Codex, VS Code). HTTP vs мост Respo решает сама по таблице возможностей клиента.
- **(d) Закрытое приложение:** endpoint живёт только с процессом; никаких фоновых сервисов; понятная ошибка в шиме + статус «MCP: running/stopped» в Settings.

## 6. Каталог тулов (предложение)

| Тул | Аргументы | Возврат | read-only |
|---|---|---|---|
| `respo_open` | `url` | `{url, devices[]}` | нет |
| `respo_list_devices` | — | `[{id, name, width, height, dpr, type, active}]` | да |
| `respo_set_devices` | `deviceIds[]` | подтверждение | нет |
| `respo_viewport_sizes` | `deviceIds?` | CSS/physical px | да |
| `respo_screenshot` | `device: 'all'\|id, fullPage?, format?, scale?` | image-блоки / resource_link | да |
| `respo_measure` | `selector, device?` | bounding box + computed styles | да |
| `respo_overflow_check` | `device?` | overflow-элементы/селекторы | да |
| `respo_breakpoints` | — | брейкпоинты страницы | да |
| `respo_a11y_audit` | `device?` | нарушения | да |
| `respo_console` | `device?, since?` | консоль батчем | да |
| `respo_evaluate` | `script, device?` | результат | **нет**, opt-in в настройках |
