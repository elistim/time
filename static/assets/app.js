const currentTimer = document.querySelector("#currentTimer");
const currentNote = document.querySelector("#currentNote");
const statusEl = document.querySelector("#status");
const noteInput = document.querySelector("#noteInput");
const startBtn = document.querySelector("#startBtn");
const stopBtn = document.querySelector("#stopBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const sessionsTitle = document.querySelector("#sessionsTitle");
const sessionsEl = document.querySelector("#sessions");
const calendarTitle = document.querySelector("#calendarTitle");
const calendarGrid = document.querySelector("#calendarGrid");
const prevMonthBtn = document.querySelector("#prevMonthBtn");
const todayMonthBtn = document.querySelector("#todayMonthBtn");
const nextMonthBtn = document.querySelector("#nextMonthBtn");

const totals = {
  today: document.querySelector("#todayTotal"),
  week: document.querySelector("#weekTotal"),
  month: document.querySelector("#monthTotal"),
  all: document.querySelector("#allTotal"),
};

const CACHE_KEY = "workTimeState";
let state = null;
let visibleMonth = new Date();
visibleMonth.setDate(1);
visibleMonth.setHours(0, 0, 0, 0);
let editingSessionId = null;

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDuration(seconds, withSeconds = false) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return withSeconds ? `${pad(hours)}:${pad(minutes)}:${pad(rest)}` : `${pad(hours)}:${pad(minutes)}`;
}

function parseDate(value) {
  return new Date(value);
}

function toDateTimeLocalValue(date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-") + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocalValue(value) {
  return value ? new Date(value).toISOString() : null;
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${year}-${month}-${day}`;
}

function activeDuration() {
  if (!state?.active?.start) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - parseDate(state.active.start).getTime()) / 1000));
}

function activeDelta() {
  if (!state?.running || !state.receivedAt) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - state.receivedAt) / 1000));
}

function render(options = {}) {
  const { preserveEditor = false } = options;
  const running = Boolean(state?.running);
  statusEl.textContent = running ? "идет" : "остановлено";
  statusEl.classList.toggle("running", running);
  startBtn.disabled = running;
  stopBtn.disabled = !running;

  currentTimer.textContent = formatDuration(activeDuration(), true);
  currentNote.textContent = running
    ? (state.active.note || "Работа без заметки")
    : "Нет активной работы";

  if (state?.totals) {
    totals.today.textContent = formatDuration(state.totals.today + activeDelta());
    totals.week.textContent = formatDuration(state.totals.week + activeDelta());
    totals.month.textContent = formatDuration(state.totals.month + activeDelta());
    totals.all.textContent = formatDuration(state.totals.all + activeDelta());
  }

  if (!(preserveEditor && editingSessionId !== null)) {
    renderSessions();
  }
  renderCalendar();
}

function renderSessions() {
  const monthSessions = (state?.sessions || []).filter((session) => {
    const start = parseDate(session.start);
    return start.getFullYear() === visibleMonth.getFullYear()
      && start.getMonth() === visibleMonth.getMonth();
  });

  sessionsTitle.textContent = `Сессии за ${visibleMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}`;

  if (!monthSessions.length) {
    sessionsEl.innerHTML = '<p class="empty">За этот месяц сессий нет</p>';
    return;
  }

  sessionsEl.replaceChildren(...monthSessions.map((session) => {
    if (editingSessionId === session.id) {
      return renderSessionEditor(session);
    }

    const row = document.createElement("article");
    row.className = "session";

    const left = document.createElement("div");
    const date = document.createElement("span");
    const start = parseDate(session.start);
    const end = session.end ? parseDate(session.end) : null;
    date.textContent = start.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });

    const note = document.createElement("small");
    note.textContent = session.note || "Без заметки";
    left.append(date, note);

    const right = document.createElement("div");
    const duration = document.createElement("strong");
    duration.textContent = formatDuration(session.duration);
    const range = document.createElement("small");
    range.textContent = `${start.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })} - ${end ? end.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "сейчас"}`;
    const editButton = document.createElement("button");
    editButton.className = "session-edit";
    editButton.type = "button";
    editButton.textContent = "Изменить";
    editButton.addEventListener("click", () => {
      editingSessionId = session.id;
      render();
    });

    const deleteButton = document.createElement("button");
    deleteButton.className = "session-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "Удалить сессию";
    deleteButton.addEventListener("click", async () => {
      if (!confirm("Удалить эту сессию?")) {
        return;
      }

      if (editingSessionId === session.id) {
        editingSessionId = null;
      }

      try {
        await request(`/api/session/${session.id}/delete`, { method: "POST" });
      } catch (error) {
        alert(`Не удалось удалить сессию: ${error.message}`);
      }
    });
    const actions = document.createElement("div");
    actions.className = "session-actions";
    actions.append(editButton, deleteButton);
    right.append(duration, range, actions);

    row.append(left, right);
    return row;
  }));
}

function renderSessionEditor(session) {
  const row = document.createElement("article");
  row.className = "session editing";

  const form = document.createElement("form");
  form.className = "session-form";

  const start = parseDate(session.start);
  const end = session.end ? parseDate(session.end) : null;

  const startLabel = document.createElement("label");
  startLabel.textContent = "Начало";
  const startInput = document.createElement("input");
  startInput.type = "datetime-local";
  startInput.required = true;
  startInput.value = toDateTimeLocalValue(start);
  startLabel.append(startInput);

  const endLabel = document.createElement("label");
  endLabel.textContent = "Конец";
  const endInput = document.createElement("input");
  endInput.type = "datetime-local";
  endInput.value = end ? toDateTimeLocalValue(end) : "";
  endLabel.append(endInput);

  const noteLabel = document.createElement("label");
  noteLabel.textContent = "Заметка";
  const noteInputEl = document.createElement("input");
  noteInputEl.type = "text";
  noteInputEl.maxLength = 300;
  noteInputEl.value = session.note || "";
  noteLabel.append(noteInputEl);

  const actions = document.createElement("div");
  actions.className = "session-form-actions";

  const saveButton = document.createElement("button");
  saveButton.type = "submit";
  saveButton.textContent = "Сохранить";

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary";
  cancelButton.textContent = "Отмена";
  cancelButton.addEventListener("click", () => {
    editingSessionId = null;
    render();
  });

  actions.append(saveButton, cancelButton);
  form.append(startLabel, endLabel, noteLabel, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    editingSessionId = null;
    await request(`/api/session/${session.id}`, {
      method: "PUT",
      body: JSON.stringify({
        start: fromDateTimeLocalValue(startInput.value),
        end: fromDateTimeLocalValue(endInput.value),
        note: noteInputEl.value,
      }),
    });
  });

  row.append(form);
  return row;
}

function buildCalendar() {
  const base = new Date();
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const startOffset = (monthStart.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - startOffset);
  const totalsByDate = new Map(Object.entries(state?.by_day || {}));

  if (state?.running && state.active?.start) {
    const key = localDateKey(parseDate(state.active.start));
    totalsByDate.set(key, (totalsByDate.get(key) || 0) + activeDelta());
  }

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = localDateKey(date);

    return {
      key,
      day: date.getDate(),
      seconds: Number(totalsByDate.get(key) || 0),
      currentMonth: date >= monthStart && date <= monthEnd,
      today: key === localDateKey(base),
    };
  });
}

function renderCalendar() {
  if (!calendarGrid || !calendarTitle) {
    return;
  }

  calendarTitle.textContent = visibleMonth.toLocaleDateString("ru-RU", { month: "long", year: "numeric" });
  calendarGrid.replaceChildren(...buildCalendar().map((day) => {
    const cell = document.createElement("article");
    cell.className = "calendar-day";
    cell.classList.toggle("muted", !day.currentMonth);
    cell.classList.toggle("today", day.today);
    cell.classList.toggle("worked", day.seconds > 0);

    const number = document.createElement("span");
    number.textContent = day.day;

    const total = document.createElement("strong");
    total.textContent = day.seconds > 0 ? formatDuration(day.seconds) : "";

    cell.append(number, total);
    return cell;
  }));
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  state = await response.json();
  state.receivedAt = Date.now();
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  render();
}

async function refresh() {
  await request("/api/data");
}

startBtn.addEventListener("click", async () => {
  await request("/api/start", {
    method: "POST",
    body: JSON.stringify({ note: noteInput.value }),
  });
  noteInput.value = "";
});

stopBtn.addEventListener("click", async () => {
  await request("/api/stop", { method: "POST" });
});

refreshBtn.addEventListener("click", refresh);

prevMonthBtn.addEventListener("click", () => {
  visibleMonth.setMonth(visibleMonth.getMonth() - 1);
  render();
});

todayMonthBtn.addEventListener("click", () => {
  visibleMonth = new Date();
  visibleMonth.setDate(1);
  visibleMonth.setHours(0, 0, 0, 0);
  render();
});

nextMonthBtn.addEventListener("click", () => {
  visibleMonth.setMonth(visibleMonth.getMonth() + 1);
  render();
});

if (window.__INITIAL_STATE__) {
  state = { ...window.__INITIAL_STATE__, receivedAt: Date.now() };
  localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  render();
} else {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (cached) {
      state = { ...cached, receivedAt: Date.now() };
      render();
    }
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
}

refresh().catch(() => {
  statusEl.textContent = "ошибка";
  currentNote.textContent = "API недоступен";
});

setInterval(() => render({ preserveEditor: true }), 1000);
setInterval(refresh, 60000);
