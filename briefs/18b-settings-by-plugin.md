# Brief 18b — Settings = личные креды по плагинам; серверная часть qaa-generator → Administration

Коррекция поверх briefs 18 + 18a. Переосмысление `Profile → Settings`: это **не
техническая инфраструктура**, а **личные креды/доступы пользователя к ресурсам
портала**, сгруппированные **по включённым плагинам**. Настройки выключенного
плагина не показываются. Серверная/привилегированная часть qaa-generator
переезжает в **Administration** (только админ).

Читать `CONVENTIONS.md` + brief 09: без инлайновых строковых/числовых литералов
(enum в модулях констант); UI только на английском; чисто по `ruff`+`mypy`
(backend/agent) и `eslint`+`tsc --noEmit` (frontend); все тесты зелёные.

## Модель (что где)

`Profile → Settings` — карточка на **каждый включённый плагин**, внутри только
личные креды/доступы:

- **Jenkins** (если плагин `jenkins` включён): `URL`, `username`, **personal
  token**. → пишется в `.env` локального агента (запросы к Jenkins идут с машины
  пользователя). Требует запущенного companion-агента.
- **Stagings** (если `stagings` включён): доступ к staging-кластеру — путь к
  `staging kubeconfig` + `URL` его обновления. → агент. Требует агента.
- **Kuber** (если `kuber` включён): `kubeconfig` (доступ к кластеру). → агент.
  Требует агента.
- **qaa-generator** (если `qaa-generator` включён): **личный токен пользователя**
  (ставить задачи, смотреть runs). → per-user в БД бэкенда (запросы к генератору
  делает бэкенд от имени пользователя). Агент не нужен.

`Administration` (только админ) — серверная/привилегированная часть
qaa-generator: `sysadmin (superuser) token`, служебный/затычка `service token`,
`base URL`, `actor`, `port-forward*`. Переиспользуем готовый admin-эндпоинт
`GET/PUT /api/v1/settings`.

**Скрываем/убираем:**
- Группа **Application** (API base URL, порты агента) — удалить из UI полностью.
- Технические поля агента (root path/folders, request timeout, tree depth,
  stuck idle hours, staging bin, stagings repo, kubeconfig active path, staging
  kubeconfig max age, kubectl bin, kubectl request timeout) — **не показывать**.
  Они остаются в `.env` агента на текущих значениях (агентовый `PUT /settings`
  уже частичный — не переданные ключи не трогаются, см. brief 18/D3).

**Хранение (split by nature, обосновать в докстроках):** личные Jenkins/kube
креды → `.env` агента (per-machine, т.к. ходит локальный агент); личный токен
qaa-generator → БД бэкенда (per-user, т.к. ходит бэкенд от имени пользователя).

## Область

- **В области:** переписать `SettingsPanel` в группы по плагинам; убрать группу
  Application; перенести серверные настройки qaa-generator в Administration
  (новая admin-вкладка, переиспользуя `backendClient.getServerSettings/updateServerSettings`);
  добавить per-user колонку `qaa_generator_token` + миграцию + `PATCH /me`
  поле + `UserRead.qaa_generator_token_set`; обновить типы/клиенты/константы/тесты.
- **Вне области (НЕ делать):** менять транспорт вызовов к qaa-generator (личный
  токен пока НЕ используется в запросах — «затычка» `service_token` остаётся;
  реальное использование — будущий шаг после ингресса, оставить код-комментарий);
  трогать backend/agent эндпоинты `/settings` (кроме `PATCH /me`); трогать
  бэкенд/агент бутстрап; менять поведение других плагинов; runtimeConfig
  `resolve*` (оставить как есть для fallback).

Читать СНАЧАЛА:
- `frontend/src/plugins/profile/SettingsPanel.tsx` — переписывается.
- `frontend/src/plugins/profile/AccountPanel.tsx` — образец формы + `updateMe`.
- `frontend/src/plugins/admin/manifest.tsx`, `frontend/src/plugins/admin/UsersPage.tsx`
  — куда добавить admin-вкладку.
- `frontend/src/plugins/registry.ts` / `catalog.ts` — `enabledOptionalPluginIdSet`,
  `visiblePlugins` (как проверять включённость плагина у пользователя).
- `frontend/src/constants.ts` — `ViewKey`/`TabId`/`TabTitle`/`PluginId`.
- `frontend/src/api/types.ts`, `frontend/src/api/backendClient.ts` — `User`,
  `MeUpdateRequest`, `updateMe`, `getServerSettings/updateServerSettings`.
- `backend/app/models/user.py`, `backend/app/schemas/user.py`,
  `backend/app/api/v1/users.py`, `backend/alembic/versions/` (последняя —
  `20260811_0005_*`).

---

## 1. Frontend — `SettingsPanel` (по плагинам)

Переписать `plugins/profile/SettingsPanel.tsx`:

- Определять включённые плагины через `enabledOptionalPluginIdSet(currentUser.enabled_plugins)`.
- Рендерить карточку (`CardShell`) **только** для включённого плагина, только с
  указанными выше личными полями. Порядок: Jenkins, Stagings, Kuber, qaa-generator.
- **Агентовые группы (Jenkins/Stagings/Kuber):** оставить существующую логику
  discovery (`discoverAgent` + `agentClient.getSettings`). Показывать discovery/
  loading/unavailable/error состояния **один раз** (общий блок), если включён
  хотя бы один агентовый плагин. Формы берут значения из одного
  `agentSettingsQuery.data`. Сохранение — **раздельно по группам**: каждая
  кнопка Save шлёт `agentClient.updateSettings` с **частичным** payload только
  своих полей:
  - Jenkins Save → `{ jenkins_url, jenkins_username, jenkins_token? }` (token
    только если изменён; write-only masked как сейчас).
  - Stagings Save → `{ staging_kubeconfig, staging_kubeconfig_url }`.
  - Kuber Save → `{ kubeconfig }`.
  Если ни один агентовый плагин не включён — discovery не запускать.
- **qaa-generator группа:** личный токен пользователя, `PasswordInput`
  (write-only). Подпись «set / not set» из `currentUser.qaa_generator_token_set`.
  Save → `backendClient.updateMe(token, { qaa_generator_token })` (пустая строка
  очищает), затем `setCurrentUser(updatedUser)`. Кнопка «Clear stored value»
  шлёт пустую строку. Агент не нужен.
- **Удалить** всё, что относится к группе Application (стейт, форма, save/reset,
  копирайт, импорты `set*Override`/`clear*Override`, `DEFAULT_*` для неё).
  `runtimeConfig.resolve*` НЕ трогать (используются клиентами для fallback);
  просто убрать их вызовы из этого файла и неиспользуемые импорты.
- **Удалить** серверную (qaa-generator) карточку отсюда — она переезжает в
  Administration (раздел 2). Убрать `getServerSettings`/`ServerSettings*` из
  этого файла.
- Английские подписи, палитра через `usePalette`, enum-константы (никаких голых
  литералов в новых строках-подписях — вынести в `*Copy`).

## 2. Frontend — Administration: вкладка qaa-generator (серверная)

- `constants.ts`: добавить `ViewKey.ADMIN_INTEGRATIONS = "admin-integrations"`,
  `TabId.ADMIN_INTEGRATIONS = "tab-admin-integrations"`,
  `TabTitle[TabId.ADMIN_INTEGRATIONS] = "qaa-generator"`.
- Новый компонент `plugins/admin/ServerSettingsPage.tsx`: перенести сюда
  серверную форму из старого `SettingsPanel` (base URL, actor, service token,
  superuser token, port-forward enabled/namespace/resource/local/remote),
  на `backendClient.getServerSettings` / `updateServerSettings` (без изменений
  бэкенда). Секреты write-only masked.
- `plugins/admin/manifest.tsx`: добавить второй tab
  `{ adminOnly: true, id: TabId.ADMIN_INTEGRATIONS, title: TabTitle[...], viewKey: ViewKey.ADMIN_INTEGRATIONS, element: <ServerSettingsPage/> }`.
  Первый tab остаётся Users.

## 3. Backend — личный токен qaa-generator (per-user)

- `models/user.py`: колонка `qaa_generator_token: Mapped[str | None] =
  mapped_column(String(DEFAULT_STRING_LENGTH), nullable=True)`.
- Alembic `20260814_0006_user_qaa_generator_token.py`: `add_column` /
  `drop_column` для `users.qaa_generator_token` (следовать стилю существующих
  ревизий; `down_revision = "0005"`-ревизия).
- `schemas/user.py`:
  - `UserRead`: добавить `qaa_generator_token_set: bool`; в `to_user_read` →
    `bool(user.qaa_generator_token)`. **Не** отдавать сам токен.
  - `MeUpdateRequest`: добавить `qaa_generator_token: str | None = None`.
- `api/v1/users.py` `PATCH /me`: если `qaa_generator_token` в
  `payload.model_fields_set` → `current_user.qaa_generator_token =
  payload.qaa_generator_token or None`.
- Код-комментарий у поля/обработчика: токен пока не используется в вызовах к
  qaa-generator (затычка `service_token`); включить после ингресса.

## 4. Frontend — типы/клиенты

- `api/types.ts`: `User` + `qaa_generator_token_set: boolean`; `MeUpdateRequest`
  + `qaa_generator_token?: string`.
- `backendClient.updateMe` уже существует — убедиться, что тип payload включает
  новое поле. (Никаких новых эндпоинтов.)

## 5. Тесты

- **Backend:** `PATCH /me` устанавливает/очищает `qaa_generator_token`, ответ
  содержит `qaa_generator_token_set` (true/false) и **никогда** сам токен;
  миграция up/down. Обновить существующие `test_users` под новое поле.
- **Frontend:** обновить `SettingsPanel.test.tsx` — группы рендерятся по
  включённым плагинам (напр., только jenkins включён → есть Jenkins, нет
  Stagings/Kuber/qaa-generator; qaa-generator включён → есть его группа с полем
  токена; нет группы Application); qaa-generator Save зовёт `updateMe`.
  Добавить `plugins/admin/ServerSettingsPage.test.tsx` (грузит/сохраняет
  серверные настройки, маскирует секреты). Обновить любые тесты, ссылающиеся на
  старые серверные/Application части `SettingsPanel`.
- Проверить, что новые `ViewKey/TabId.ADMIN_INTEGRATIONS` не ломают
  `discovery.test`/`contract.test`.

## Acceptance

- `Profile → Settings` показывает группы **только** для включённых плагинов, в
  каждой — только личные креды/доступы; группы Application нет.
- Jenkins/kube креды сохраняются в `.env` агента; личный токен qaa-generator —
  в БД (per-user), маскируется в API.
- Серверная часть qaa-generator доступна и редактируется **только** в
  Administration.
- `npm run lint`, `npx tsc --noEmit`, `npm run test`, `npm run build`,
  backend/agent `ruff`+`mypy`+`pytest` — чисто.
