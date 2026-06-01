# Work Time

Минималистичный трекер рабочего времени на FastAPI с веб-интерфейсом.

## Возможности

- старт и остановка рабочей сессии;
- заметка к сессии;
- итоги за день, неделю, месяц и все время;
- календарь с отработанным временем по дням;
- список сессий за выбранный месяц;
- редактирование начала, конца и заметки;
- удаление сессий;
- раздельные файлы данных по пользователям через HTTP-заголовок `X-Remote-User`.

## Структура

```text
.
├── app.py
├── static/
│   ├── index.html
│   └── assets/
│       ├── app.js
│       └── styles.css
└── data/
```

`data/` хранится только локально и исключена из Git. Пользовательские файлы создаются как `data/<username>.json`. Если `X-Remote-User` не передан, приложение использует локальный файл `data.json`.

## Запуск

Установить зависимости:

```bash
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn
```

Запустить приложение:

```bash
uvicorn app:app --host 0.0.0.0 --port 8000
```

После запуска интерфейс доступен на:

```text
http://localhost:8000
```

## API

```text
GET    /api/data
POST   /api/start
POST   /api/stop
PUT    /api/session/{session_id}
DELETE /api/session/{session_id}
POST   /api/session/{session_id}/delete
```

Пример старта сессии:

```bash
curl -X POST http://localhost:8000/api/start \
  -H 'Content-Type: application/json' \
  -d '{"note":"Работа над задачей"}'
```

Пример использования отдельного пользовательского файла:

```bash
curl http://localhost:8000/api/data \
  -H 'X-Remote-User: elisey'
```

## Деплой

Приложение можно запускать за nginx или другим reverse proxy. Для разделения данных по пользователям proxy должен передавать заголовок `X-Remote-User`.

Минимальная systemd-команда для сервиса:

```text
/opt/time/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
```

Рабочая директория сервиса должна быть `/opt/time`.
