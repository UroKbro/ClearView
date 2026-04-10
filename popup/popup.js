// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    const panel = document.getElementById(btn.dataset.tab);
    panel.classList.add("active");

    // Trigger specific tab loads
    if (btn.dataset.tab === "tasks") loadTasks();
    if (btn.dataset.tab === "stats") loadStats();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

// ─── Stats tab ───────────────────────────────────────────────────────────────

async function loadStats() {
  const { 
    siteTimes = {}, 
    timerState = {},
    weeklyTotals = {},
    blockedSites = []
  } = await chrome.storage.local.get(["siteTimes", "timerState", "weeklyTotals", "blockedSites"]);
  
  const sessionsToday = timerState?.sessionsToday || 0;
  const totalSeconds = Object.values(siteTimes).reduce((a, b) => a + b, 0);
  
  document.getElementById("total-time").textContent = formatTime(totalSeconds);
  document.getElementById("pomodoros-done").textContent = sessionsToday;

  renderActivityChart(weeklyTotals, totalSeconds);

  const sortedPairs = Object.entries(siteTimes).sort((a, b) => b[1] - a[1]);
  const topSites = sortedPairs.slice(0, 5);
  const list = document.getElementById("site-list");
  list.innerHTML = "";

  if (topSites.length === 0) {
    list.innerHTML = `<p style="padding:16px;color:#aaa;font-size:13px;text-align:center;">No data for today yet.</p>`;
    return;
  }

  const maxTime = topSites[0][1];
  topSites.forEach(([host, seconds]) => {
    const isBlocked = blockedSites.includes(host);
    const barWidth = Math.round((seconds / maxTime) * 100);
    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `
      <img class="favicon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" />
      <div class="site-info">
        <div class="site-name">${host}</div>
        <div class="site-bar-wrap"><div class="site-bar-fill" style="width: ${barWidth}%"></div></div>
      </div>
      <div class="site-time">${formatTime(seconds)}</div>
      <button class="block-toggle ${isBlocked ? 'blocked' : ''}" title="${isBlocked ? 'Unblock site' : 'Block site during Focus'}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
      </button>
    `;
    
    row.querySelector(".block-toggle").onclick = () => toggleBlockSite(host);
    list.appendChild(row);
  });
}

async function toggleBlockSite(domain) {
  const { blockedSites = [] } = await chrome.storage.local.get("blockedSites");
  let updated;
  if (blockedSites.includes(domain)) {
    updated = blockedSites.filter(s => s !== domain);
  } else {
    updated = [...blockedSites, domain];
  }
  
  await chrome.storage.local.set({ blockedSites: updated });
  chrome.runtime.sendMessage({ action: "REFRESH_BLOCKING" });
  loadStats(); // Re-render to show updated status
}

async function renderActivityChart(weeklyTotals, todaySeconds) {
  const chart = document.getElementById("bar-chart");
  chart.innerHTML = "";
  
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let maxTime = 3600; 
  const days = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const seconds = i === 0 ? todaySeconds : (weeklyTotals[dateStr] || 0);
    
    if (seconds > maxTime) maxTime = seconds;
    days.push({ label: labels[d.getDay()], seconds });
  }

  days.forEach(day => {
    const heightPercent = (day.seconds / maxTime) * 100;
    const barWrap = document.createElement("div");
    barWrap.className = "bar-wrap";
    barWrap.title = formatTime(day.seconds);
    barWrap.innerHTML = `
      <div class="bar">
        <div class="bar-fill" style="height: ${heightPercent}%"></div>
      </div>
      <div class="bar-label">${day.label}</div>
    `;
    chart.appendChild(barWrap);
  });
}

// ─── Timer tab ──────────────────────────────────────────────────────────────

let timerInterval = null;

async function updateTimerUI() {
  const { timerState } = await chrome.storage.local.get("timerState");
  if (!timerState) return;

  const display = document.getElementById("time-display");
  const modeLabel = document.getElementById("mode-label");
  const ring = document.getElementById("progress-ring");
  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");
  const timerPanel = document.getElementById("timer");

  let remaining;
  if (timerState.running && timerState.endTime) {
    remaining = Math.max(0, Math.round((timerState.endTime - Date.now()) / 1000));
  } else {
    remaining = timerState.duration;
  }

  timerPanel.setAttribute("data-mode", timerState.mode);
  modeLabel.textContent = timerState.mode === "focus" ? "Focus" : (timerState.mode === "short" ? "Short Break" : "Long Break");

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  display.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  let totalDuration;
  if (timerState.mode === "focus") totalDuration = timerState.settings.focusMins * 60;
  else if (timerState.mode === "short") totalDuration = timerState.settings.shortMins * 60;
  else totalDuration = timerState.settings.longMins * 60;

  const progress = remaining / totalDuration;
  ring.style.strokeDashoffset = 283 - (283 * progress);

  document.querySelectorAll(".preset-btn").forEach(btn => {
    btn.classList.toggle("active", parseInt(btn.dataset.mins) === timerState.settings.focusMins);
  });

  if (timerState.running) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
  }

  if (timerState.running && remaining <= 0) {
    setTimeout(updateTimerUI, 500);
  }
}

function startUIUpdateLoop() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimerUI();
  timerInterval = setInterval(updateTimerUI, 1000);
}

document.getElementById("play-pause-btn").onclick = () => {
  chrome.storage.local.get("timerState", ({ timerState }) => {
    const action = timerState.running ? "PAUSE_TIMER" : "START_TIMER";
    chrome.runtime.sendMessage({ action }, updateTimerUI);
  });
};

document.getElementById("reset-btn").onclick = () => chrome.runtime.sendMessage({ action: "RESET_TIMER" }, updateTimerUI);
document.getElementById("skip-btn").onclick = () => chrome.runtime.sendMessage({ action: "SKIP_TIMER" }, updateTimerUI);

document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.onclick = () => {
    const focusMins = parseInt(btn.dataset.mins);
    chrome.runtime.sendMessage({ action: "UPDATE_TIMER_SETTINGS", focusMins }, updateTimerUI);
  };
});

// ─── Tasks tab ───────────────────────────────────────────────────────────────

async function loadTasks() {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const list = document.getElementById("tasks-list");
  list.innerHTML = "";

  if (tasks.length === 0) {
    list.innerHTML = `<p style="padding:16px;color:#aaa;font-size:13px;text-align:center;">No tasks yet. Add one!</p>`;
    return;
  }

  tasks.forEach(task => {
    const item = document.createElement("div");
    item.className = `task-item ${task.completed ? "completed" : ""}`;
    item.innerHTML = `
      <div class="task-checkbox ${task.completed ? "checked" : ""}" data-id="${task.id}"></div>
      <div class="task-text">${task.text}</div>
      <div class="delete-task" data-id="${task.id}">✕</div>
    `;

    item.querySelector(".task-checkbox").onclick = () => toggleTask(task.id);
    item.querySelector(".delete-task").onclick = () => deleteTask(task.id);
    list.appendChild(item);
  });
}

async function addTask() {
  const input = document.getElementById("task-input");
  const text = input.value.trim();
  if (!text) return;

  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const newTask = { id: Date.now().toString(), text, completed: false };
  await chrome.storage.local.set({ tasks: [newTask, ...tasks] });
  input.value = "";
  loadTasks();
}

async function toggleTask(id) {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const updated = tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t);
  await chrome.storage.local.set({ tasks: updated });
  loadTasks();
}

async function deleteTask(id) {
  const { tasks = [] } = await chrome.storage.local.get("tasks");
  const updated = tasks.filter(t => t.id !== id);
  await chrome.storage.local.set({ tasks: updated });
  loadTasks();
}

document.getElementById("add-task-btn").onclick = addTask;
document.getElementById("task-input").onkeypress = (e) => { if (e.key === "Enter") addTask(); };

// ─── Initialization ──────────────────────────────────────────────────────────

loadStats();
startUIUpdateLoop();