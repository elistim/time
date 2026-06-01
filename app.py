import json
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BASE_DIR = Path(__file__).parent
DATA_FILE = BASE_DIR / "data.json"
USERS_DIR = BASE_DIR / "data"
LOCAL_TZ = timezone(timedelta(hours=3), name="Europe/Moscow")
USER_RE = re.compile(r"[^A-Za-z0-9_.-]+")

app = FastAPI()


class StartRequest(BaseModel):
    note: Optional[str] = ""


class SessionUpdateRequest(BaseModel):
    start: str
    end: Optional[str] = None
    note: Optional[str] = ""


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def parse_dt(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def user_file(username: Optional[str]) -> Path:
    if not username:
        return DATA_FILE

    safe_name = USER_RE.sub("_", username.strip()).strip("._-")
    if not safe_name:
        raise HTTPException(status_code=400, detail="Invalid username")

    USERS_DIR.mkdir(exist_ok=True)
    return USERS_DIR / f"{safe_name}.json"


def load_data(username: Optional[str] = None) -> dict:
    data_file = user_file(username)
    if not data_file.exists():
        return {"sessions": []}

    data = json.loads(data_file.read_text(encoding="utf-8"))
    data.setdefault("sessions", [])
    return data


def save_data(data: dict, username: Optional[str] = None) -> None:
    user_file(username).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def active_session(data: dict) -> Optional[dict]:
    return next((session for session in data["sessions"] if not session.get("end")), None)


def seconds_between(start: str, end: Optional[str] = None) -> int:
    start_dt = parse_dt(start)
    end_dt = parse_dt(end) if end else now_utc()
    return max(0, int((end_dt - start_dt).total_seconds()))


def local_date(value: str) -> str:
    return parse_dt(value).astimezone(LOCAL_TZ).date().isoformat()


def summarize(data: dict) -> dict:
    now = now_utc()
    today = now.astimezone(LOCAL_TZ).date()
    week_start = today.fromordinal(today.toordinal() - today.weekday())
    month_start = today.replace(day=1)

    totals = {"today": 0, "week": 0, "month": 0, "all": 0}
    by_day = {}
    sessions = []

    for index, session in enumerate(data["sessions"]):
        duration = seconds_between(session["start"], session.get("end"))
        started = parse_dt(session["start"]).astimezone(LOCAL_TZ)
        date_key = started.date().isoformat()
        entry = {
            "id": index,
            "start": session["start"],
            "end": session.get("end"),
            "note": session.get("note", ""),
            "duration": duration,
            "date": date_key,
        }
        sessions.append(entry)

        session_date = started.date()
        by_day[date_key] = by_day.get(date_key, 0) + duration
        totals["all"] += duration
        if session_date == today:
            totals["today"] += duration
        if session_date >= week_start:
            totals["week"] += duration
        if session_date >= month_start:
            totals["month"] += duration

    active = active_session(data)
    return {
        "running": active is not None,
        "active": active,
        "totals": totals,
        "by_day": by_day,
        "sessions": list(reversed(sessions)),
        "timezone": str(LOCAL_TZ),
    }


@app.get("/api/data")
def get_data(x_remote_user: Optional[str] = Header(None)):
    return summarize(load_data(x_remote_user))


@app.get("/", response_class=HTMLResponse)
def index(x_remote_user: Optional[str] = Header(None)):
    html = (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")
    initial_state = json.dumps(summarize(load_data(x_remote_user)), ensure_ascii=False)
    return html.replace(
        '<script src="/assets/app.js?v=9"></script>',
        f'<script>window.__INITIAL_STATE__ = {initial_state};</script>\n    <script src="/assets/app.js?v=9"></script>',
    )


@app.post("/api/start")
def start_work(req: StartRequest, x_remote_user: Optional[str] = Header(None)):
    data = load_data(x_remote_user)
    if active_session(data):
        raise HTTPException(status_code=409, detail="Work timer is already running")

    data["sessions"].append({
        "start": iso(now_utc()),
        "end": None,
        "note": (req.note or "").strip(),
    })
    save_data(data, x_remote_user)
    return summarize(data)


@app.post("/api/stop")
def stop_work(x_remote_user: Optional[str] = Header(None)):
    data = load_data(x_remote_user)
    session = active_session(data)
    if not session:
        raise HTTPException(status_code=409, detail="Work timer is not running")

    session["end"] = iso(now_utc())
    save_data(data, x_remote_user)
    return summarize(data)


@app.put("/api/session/{session_id}")
def update_session(session_id: int, req: SessionUpdateRequest, x_remote_user: Optional[str] = Header(None)):
    data = load_data(x_remote_user)
    if session_id < 0 or session_id >= len(data["sessions"]):
        raise HTTPException(status_code=404, detail="Session not found")

    start_dt = parse_dt(req.start)
    end_dt = parse_dt(req.end) if req.end else None
    if end_dt and end_dt <= start_dt:
        raise HTTPException(status_code=400, detail="End time must be after start time")

    if end_dt is None:
        another_active = any(
            index != session_id and not session.get("end")
            for index, session in enumerate(data["sessions"])
        )
        if another_active:
            raise HTTPException(status_code=409, detail="Another session is already running")

    session = data["sessions"][session_id]
    session["start"] = iso(start_dt)
    session["end"] = iso(end_dt) if end_dt else None
    session["note"] = (req.note or "").strip()
    save_data(data, x_remote_user)
    return summarize(data)


@app.delete("/api/session/{session_id}")
def delete_session(session_id: int, x_remote_user: Optional[str] = Header(None)):
    return remove_session(session_id, x_remote_user)


@app.post("/api/session/{session_id}/delete")
def delete_session_post(session_id: int, x_remote_user: Optional[str] = Header(None)):
    return remove_session(session_id, x_remote_user)


def remove_session(session_id: int, x_remote_user: Optional[str] = None):
    data = load_data(x_remote_user)
    if session_id < 0 or session_id >= len(data["sessions"]):
        raise HTTPException(status_code=404, detail="Session not found")

    data["sessions"].pop(session_id)
    save_data(data, x_remote_user)
    return summarize(data)


app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")
