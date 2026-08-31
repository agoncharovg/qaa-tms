# План: скип E2E-тестов через Leonid (product-keyed, greenfield)

Источник требований: `discuss/20`.

Затрагивает три репозитория:
- `~/Projects/qaa-leonid` (Django/DRF) — хранилище + API + admin.
- `~/Projects/qaa-tms` (FastAPI + React) — менеджмент-UI (подменю Leonid → «Skipped Tests»).
- `~/Projects/qaa-e2e` (pytest framework) — потребитель: скипает тесты до старта в Jenkins.

## Решения (согласовано с заказчиком)

- **Greenfield.** На существующую реализацию НЕ закладываемся. Старое приложение
  `tests_disabling_manager` (`DisabledTest`, session-вьюхи, `test_search.html`) и
  мёртвый прототип в qaa-e2e (`origin/no_task/disable_tests_dynamically`) — легаси,
  чистится отдельной задачей позже (фаза 5). У старой фичи НЕТ живого потребителя в
  qaa-e2e (проверено grep'ом), ломать нечего.
- **Ключ — продукт, не environment.** Скип действует на продукт.
- **Единица = «сьют скипа»**: автор + причина + продукт + срок + список тестов.
- **Срок ≤ 7 дней** (`MAX_DAYS = 7`), чтобы скип не стал вечной заморозкой.
- **Не удаляем.** Сьют либо экспирируется, либо отменяется (cancel). Оба конечных
  состояния = «завершившийся». Нет DELETE, нет edit («скопом скипнули — скопом вернули»).
- **Аудит.** Храним автора создания и автора+время отмены.
- **author / cancelled_by = `username` пользователя qaa-tms** (в компании все логинятся
  по email, поэтому `username` уже является email; отдельное поле `email` в модель User
  НЕ добавляем). Значение подставляет backend qaa-tms из `current_user.username`,
  клиенту не доверяем.
- **Канон идентификатора теста — allure `fullName`** (`package.module#test_name`).
  Причина: его отдаёт allure-импорт, его видит человек в Allure UI, и его же
  вычисляет allure-pytest в рантайме qaa-e2e → импорт/ручной ввод/рантайм совпадают,
  и нет коллизий одноимённых тестов между модулями (в отличие от голого `item.name`).
- **Allure-импорт с превью.** Список тестов из репорта показывается ДО сохранения и
  редактируем (чек-лист), чтобы исключить неотносящийся к проблеме флак. Доступ в
  Jenkins уже есть (существующие плагины), отдельного блокера нет.

## Модель данных (Leonid, новое приложение `test_skips`)

```python
MAX_DAYS = 7

class SkippedSuite:
    author       = CharField(max_length=255)   # username(email), required
    reason       = TextField()
    product      = CharField(max_length=255)   # матчится строкой с Test.product
    created_at   = DateTimeField(auto_now_add=True)
    expires_at   = DateTimeField()             # required; clean(): now < expires_at <= created+7д
    cancelled_at = DateTimeField(null=True, blank=True)
    cancelled_by = CharField(max_length=255, null=True, blank=True)
    # status:  active = cancelled_at is None and expires_at > now
    #          cancelled = cancelled_at is not None
    #          expired = not cancelled and expires_at <= now

class SkippedTest:
    suite     = FK(SkippedSuite, related_name="tests", on_delete=CASCADE)
    full_name = CharField(max_length=512)      # allure fullName
    # unique_together = (suite, full_name)
```

## API (Leonid)

**Потребитель qaa-e2e** — read-only, `AllowAny` (как существующий `/api/shared_resource/`,
который фреймворк уже дёргает без токена):
```
GET /api/skipped_tests/?product=<name>
→ [{ "full_name", "reason", "author", "expires_at" }, ...]   # только active данного продукта, плоско
```
Без `product` → пустой список (или 400) — фреймворк в этом случае вообще не ходит.

**Менеджмент qaa-tms** — `HasLeonidToken` (паттерн `test_stats/views_manage.py`):
```
GET  /api/skipped_suites/
POST /api/skipped_suites/                 # body: {author, reason, product, expires_at, tests:[{full_name}]}
GET  /api/skipped_suites/{id}/
POST /api/skipped_suites/{id}/cancel/     # body: {cancelled_by}
```
Без DELETE / PUT / PATCH.

## qaa-tms

**Backend** — прокси через shared token (паттерн `services/leonid_client.py` +
`api/v1/leonid.py`), но `skipped_suites` НЕ стандартный writable-resource (нет
update/delete/toggle, есть кастомный `cancel`) — регистрируем эндпоинты явно.
`author`/`cancelled_by` подставляются из `current_user.username`.
Плюс отдельный эндпоинт превью allure (фаза 4).

**Frontend** — 4-я вкладка `plugins/leonid/SkippedTestsPanel.tsx`:
- список сьютов (product / author / reason / tests count / created / expires_at / статус),
  sort `created desc`, клиентская пагинация;
- фильтры: продукт / автор / статус (все / действующие / завершившиеся);
- визуал: завершившиеся (expired ИЛИ cancelled) — серым; у cancelled видно кто/когда;
  active с `expires_at` сегодня-завтра — яркая подсветка;
- кнопка Cancel на active;
- форма создания: reason, product, expires_at (max +7д), тесты — textarea ИЛИ
  allure-импорт (URL(ы) → превью-чек-лист → в create только отмеченные).

## qaa-e2e (новая ветка `feature/qaa-tms`)

- `LeonidClient.get_skipped_tests(product)` → `GET /api/skipped_tests/?product=`.
- `pytest_configure`: если `--build-product` пуст → запрос НЕ делаем; иначе один раз на
  xdist-мастере тянем, кэшируем в json, воркеры читают под `Locker`.
- `pytest_runtest_setup(item)`: вычисляем `fullName` айтема алгоритмом allure-pytest,
  сравниваем со списком → `pytest.skip("SKIPPED via Leonid — <reason> (by <author>, until <expires_at>)")`
  (ярко, явно что скип из Leonid).

## Фазы (codex-брифы)

1. `.codex-brief-39-phase1-leonid-backend.md` — модели, миграции, оба API, admin, тесты.
2. `.codex-brief-39-phase2-qaatms-panel.md` — прокси + вкладка (ручной ввод тестов).
3. `.codex-brief-39-phase3-qaae2e-hook.md` — клиент + хук + матчинг по fullName.
4. `.codex-brief-39-phase4-allure-import.md` — превью-эндпоинт + чек-лист в UI.
5. (позже, отдельно, без брифа) cleanup легаси: `tests_disabling_manager` +
   `test_search.html` в Leonid, мёртвая ветка в qaa-e2e.

Зависимости: фаза 1 разблокирует 2 и 3; фаза 4 идёт после 2. Фазы 2 и 3 независимы
после 1.
