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
    if (btn.dataset.tab === "insights") loadInsights();
    if (btn.dataset.tab === "today") loadToday();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Converts a raw seconds number into a readable string like "1h 23m" or "45m"
function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.round(seconds)}s`;
}

// ─── Today tab ───────────────────────────────────────────────────────────────

async function loadToday() {
  const { 
    siteTimes = {}, 
    siteWeeklyTotals = {}, 
    timerState = {},
    weeklyTotals = {},
    pomodoroHistory = {}
  } = await chrome.storage.local.get(["siteTimes", "siteWeeklyTotals", "timerState", "weeklyTotals", "pomodoroHistory"]);
  
  const sessionsToday = timerState?.sessionsToday || 0;
  const totalSeconds = Object.values(siteTimes).reduce((a, b) => a + b, 0);
  
  document.getElementById("total-time").textContent = formatTime(totalSeconds);
  document.getElementById("pomodoros-done").textContent = sessionsToday;

  // -- Add Click Listeners for Stats --
  const totalStat = document.getElementById("stat-total-time");
  totalStat.onclick = () => toggleStatPanel("panel-total-time", renderTotalWeeklyChart(weeklyTotals, totalSeconds));

  const pomoStat = document.getElementById("stat-pomodoros");
  pomoStat.onclick = () => toggleStatPanel("panel-pomodoros", renderPomodoroDistribution(pomodoroHistory));

  // -- Render Website List --
  const sortedPairs = Object.entries(siteTimes).sort((a, b) => b[1] - a[1]);
  const topSites = sortedPairs.slice(0, 5);
  const others = sortedPairs.slice(5);

  const list = document.getElementById("site-list");
  list.innerHTML = "";

  if (topSites.length === 0) {
    list.innerHTML = `<p style="padding:16px;color:#aaa;font-size:13px;">No data yet — browse a little and reopen the popup.</p>`;
    return;
  }

  const maxTime = topSites[0][1];

  topSites.forEach(([host, seconds]) => {
    const barWidth = Math.round((seconds / maxTime) * 100);
    const container = document.createElement("div");
    container.className = "site-item-container";
    
    // Create elements explicitly for better click handling
    const row = document.createElement("div");
    row.className = "site-row";
    row.innerHTML = `
      <img class="favicon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" />
      <div class="site-info">
        <div class="site-name">${host}</div>
        <div class="site-bar-wrap"><div class="site-bar-fill" style="width: ${barWidth}%"></div></div>
      </div>
      <div class="site-time">${formatTime(seconds)}</div>
    `;
    row.addEventListener("click", () => toggleSiteDetail(host));

    const detail = document.createElement("div");
    detail.className = "site-details";
    detail.id = `detail-${host.replace(/\./g, '-')}`;
    detail.innerHTML = `
      <div style="font-size: 10px; font-weight: 600; color: #7F77DD; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em">7-Day Trend</div>
      ${renderMiniChart(host, siteWeeklyTotals[host], seconds)}
    `;

    container.appendChild(row);
    container.appendChild(detail);
    list.appendChild(container);
  });

  if (others.length > 0) {
    const otherSeconds = others.reduce((a, b) => a + b[1], 0);
    const otherRow = document.createElement("div");
    otherRow.className = "site-row other-sites";
    otherRow.innerHTML = `
      <div class="favicon" style="display:flex;align-items:center;justify-content:center;background:#eee;color:#888;font-size:10px;font-weight:700">?</div>
      <div class="site-info">
        <div class="site-name">Other sites</div>
        <div class="site-bar-wrap">
          <div class="site-bar-fill" style="width: ${Math.round((otherSeconds / maxTime) * 100)}%; background: #ccc"></div>
        </div>
      </div>
      <div class="site-time">${formatTime(otherSeconds)}</div>
    `;
    otherRow.addEventListener("click", toggleOtherExpansion);
    list.appendChild(otherRow);

    const expansion = document.createElement("div");
    expansion.className = "other-expansion";
    expansion.id = "other-expansion-list";
    others.slice(0, 10).forEach(([host, seconds]) => {
       const subRow = document.createElement("div");
       subRow.className = "sub-site-row";
       subRow.innerHTML = `
         <img class="sub-favicon" src="https://www.google.com/s2/favicons?domain=${host}&sz=32" />
         <div class="site-name" style="flex:1">${host}</div>
         <div class="site-time">${formatTime(seconds)}</div>
       `;
       expansion.appendChild(subRow);
    });
    list.appendChild(expansion);
  }
}

// -- Charts & Detailed Views --

function renderTotalWeeklyChart(weeklyTotals = {}, todaySeconds) {
  const days = [];
  const now = new Date();
  let max = todaySeconds;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const secs = i === 0 ? todaySeconds : (weeklyTotals[dateStr] || 0);
    if (secs > max) max = secs;
    days.push(secs);
  }

  const bars = days.map(s => {
    const h = max > 0 ? (s / max) * 100 : 0;
    return `<div class="mini-bar" title="${formatTime(s)}"><div class="mini-bar-fill" style="height:${h}%"></div></div>`;
  }).join("");

  return `
    <div style="font-size: 10px; font-weight: 600; color: #7F77DD; margin-bottom: 12px; text-transform: uppercase;">Weekly Screen Time</div>
    <div class="mini-chart" style="height: 100px;">${bars}</div>
    <div class="mini-chart-labels"><span>6d ago</span><span>Today</span></div>
  `;
}

function renderPomodoroDistribution(history = {}) {
  const now = new Date();
  let rowsHtml = "";

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const data = history[dateStr] || { focus: 0, short: 0, long: 0 };
    const total = data.focus + data.short + data.long;
    
    // Scale widths
    const fW = total > 0 ? (data.focus / 10) * 100 : 0; // Assume 10 max for scale or use total
    const sW = total > 0 ? (data.short / 10) * 100 : 0;
    const lW = total > 0 ? (data.long / 10) * 100 : 0;

    const label = i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: 'short' });

    rowsHtml += `
      <div class="pomo-chart-row">
        <div class="pomo-label">${label}</div>
        <div class="pomo-stack">
          <div class="stack-segment stack-focus" style="flex: ${data.focus}"></div>
          <div class="stack-segment stack-short" style="flex: ${data.short}"></div>
          <div class="stack-segment stack-long" style="flex: ${data.long}"></div>
        </div>
        <div style="font-size: 9px; width: 15px; text-align: right; color: #666">${total}</div>
      </div>
    `;
  }

  return `
    <div style="font-size: 10px; font-weight: 600; color: #7F77DD; margin-bottom: 12px; text-transform: uppercase;">Pomo Distribution</div>
    ${rowsHtml}
    <div class="pomo-legend">
      <div class="legend-item"><div class="dot stack-focus"></div>Focus</div>
      <div class="legend-item"><div class="dot stack-short"></div>Short</div>
      <div class="legend-item"><div class="dot stack-long"></div>Long</div>
    </div>
  `;
}

function toggleStatPanel(panelId, contentHtml) {
  const panel = document.getElementById(panelId);
  const isExpanded = panel.classList.contains("expanded");
  
  // Collapse all
  document.querySelectorAll(".stat-detail-panel").forEach(p => p.classList.remove("expanded"));
  
  if (!isExpanded) {
    panel.innerHTML = contentHtml;
    panel.classList.add("expanded");
  }
}

function renderMiniChart(host, history = {}, todaySeconds) {
  const days = [];
  const now = new Date();
  let max = todaySeconds;

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const secs = i === 0 ? todaySeconds : (history[dateStr] || 0);
    if (secs > max) max = secs;
    days.push(secs);
  }

  const bars = days.map(s => {
    const h = max > 0 ? (s / max) * 100 : 0;
    return `
      <div class="mini-bar" title="${formatTime(s)}">
        <div class="mini-bar-fill" style="height:${h}%"></div>
      </div>`;
  }).join("");

  return `<div class="mini-chart">${bars}</div>`;
}

function toggleSiteDetail(host) {
  const detailId = `detail-${host.replace(/\./g, '-')}`;
  const detail = document.getElementById(detailId);
  const isExpanded = detail.classList.contains("expanded");
  
  document.querySelectorAll(".site-details").forEach(d => {
    if (d.id !== detailId) d.classList.remove("expanded");
  });
  
  detail.classList.toggle("expanded");
}

function toggleOtherExpansion() {
  const exp = document.getElementById("other-expansion-list");
  exp.classList.toggle("expanded");
}

// ─── Timer tab ──────────────────────────────────────────────────────────────

let timerInterval = null;

async function updateTimerUI() {
  const { timerState } = await chrome.storage.local.get("timerState");
  if (!timerState) return;

  const display = document.getElementById("time-display");
  const modeLabel = document.getElementById("mode-label");
  const ring = document.getElementById("progress-ring");
  const playPauseBtn = document.getElementById("play-pause-btn");
  const playIcon = document.getElementById("play-icon");
  const pauseIcon = document.getElementById("pause-icon");
  const timerPanel = document.getElementById("timer");

  // Determine remaining seconds
  let remaining;
  if (timerState.running && timerState.endTime) {
    remaining = Math.max(0, Math.round((timerState.endTime - Date.now()) / 1000));
  } else {
    remaining = timerState.duration;
  }

  // Update modes and colors
  timerPanel.setAttribute("data-mode", timerState.mode);
  modeLabel.textContent = timerState.mode === "focus" ? "Focus" : (timerState.mode === "short" ? "Short Break" : "Long Break");

  // Update timer text
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  display.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;

  // Update progress ring
  let totalDuration;
  if (timerState.mode === "focus") totalDuration = timerState.settings.focusMins * 60;
  else if (timerState.mode === "short") totalDuration = timerState.settings.shortMins * 60;
  else totalDuration = timerState.settings.longMins * 60;

  const progress = remaining / totalDuration;
  const offset = 283 * progress;
  ring.style.strokeDashoffset = 283 - offset;

  // Update preset buttons active state
  document.querySelectorAll(".preset-btn").forEach(btn => {
    if (parseInt(btn.dataset.mins) === timerState.settings.focusMins) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Toggle play/pause icons
  if (timerState.running) {
    playIcon.style.display = "none";
    pauseIcon.style.display = "block";
  } else {
    playIcon.style.display = "block";
    pauseIcon.style.display = "none";
  }

  // Auto-switch if timer finishes while popup is open
  if (timerState.running && remaining <= 0) {
    // Background alarm should handle this, but let's refresh immediately
    setTimeout(updateTimerUI, 500);
  }
}

function startUIUpdateLoop() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimerUI();
  timerInterval = setInterval(updateTimerUI, 1000);
}

document.getElementById("play-pause-btn").addEventListener("click", async () => {
  const { timerState } = await chrome.storage.local.get("timerState");
  const action = timerState.running ? "PAUSE_TIMER" : "START_TIMER";
  chrome.runtime.sendMessage({ action }, () => {
    updateTimerUI();
  });
});

document.getElementById("reset-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "RESET_TIMER" }, () => {
    updateTimerUI();
  });
});

document.getElementById("skip-btn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ action: "SKIP_TIMER" }, () => {
    updateTimerUI();
  });
});

document.querySelectorAll(".preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const focusMins = parseInt(btn.dataset.mins);
    chrome.runtime.sendMessage({ action: "UPDATE_TIMER_SETTINGS", focusMins }, () => {
      updateTimerUI();
    });
  });
});

// ─── Tasks tab ───────────────────────────────────────────────────────────────

async function loadTasks() {
  const { tasks } = await chrome.storage.local.get("tasks");
  const list = document.getElementById("tasks-list");
  list.innerHTML = "";

  if (!tasks || tasks.length === 0) {
    list.innerHTML = `<p style="padding:16px;color:#aaa;font-size:13px;text-align:center;">No tasks yet. Add one above!</p>`;
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
  const newTask = {
    id: Date.now().toString(),
    text,
    completed: false
  };

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
document.getElementById("task-input").onkeypress = (e) => {
  if (e.key === "Enter") addTask();
};

// ─── Insights tab ────────────────────────────────────────────────────────────

async function loadInsights() {
  const { weeklyTotals = {} } = await chrome.storage.local.get("weeklyTotals");

  // Get last 7 days including today
  const days = [];
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let maxTime = 3600; // Min 1h for scale
  let totalWeek = 0;

  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const seconds = weeklyTotals[dateStr] || 0;
    
    // Add today's live data if we're looking at today's bar
    let displaySeconds = seconds;
    if (i === 0) {
      const { siteTimes = {} } = await chrome.storage.local.get("siteTimes");
      displaySeconds = Object.values(siteTimes).reduce((a, b) => a + b, 0);
    }

    if (displaySeconds > maxTime) maxTime = displaySeconds;
    totalWeek += displaySeconds;

    days.push({
      label: labels[d.getDay()],
      seconds: displaySeconds
    });
  }

  // Update Stats
  document.getElementById("weekly-total").textContent = formatTime(totalWeek);
  document.getElementById("avg-daily").textContent = formatTime(totalWeek / 7);

  // Render Bar Chart
  const chart = document.getElementById("bar-chart");
  chart.innerHTML = "";

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

// ─── Initialization ──────────────────────────────────────────────────────────

loadToday();
startUIUpdateLoop();