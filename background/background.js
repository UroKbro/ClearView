const DEFAULTS = {
    siteTimes: {},
    dailyLimits: {},
    weeklyTotals: {},
    timerState: {
        mode: "focus",
        running: false,
        startedAt: null,
        duration: 25 * 60,
        sessionsToday: 0,
        activeTaskId: null,
        settings: {
            focusMins: 25,
            shortMins: 5,
            longMins: 15,
        }
    },
    tasks: [],
    settings: {
        soundEnabled: true,
        notificationsEnabled: true,
    },
    lastResetDate: null,
};

// --- Helper Functions ---

function getDomain(url) {
    if (!url) return null;
    try {
        const u = new URL(url);
        if (u.protocol.startsWith('http')) {
            return u.hostname;
        }
    } catch (e) { }
    return null;
}

async function storageGet(keys) {
    return chrome.storage.local.get(keys);
}

async function storageSet(data) {
    return chrome.storage.local.set(data);
}

async function storageUpdate(key, changes) {
    const current = await storageGet([key]);
    const updated = { ...current[key], ...changes };
    return storageSet({ [key]: updated });
}

// --- Core Logic ---

async function logTime(isCheckpoint = false) {
    try {
        const data = await chrome.storage.local.get("trackingState");
        const state = data.trackingState;

        if (state && state.domain && state.startTime) {
            const now = Date.now();
            const duration = (now - state.startTime) / 1000;

            if (duration > 1) {
                const { siteTimes } = await storageGet(["siteTimes"]);
                const updated = { ...(siteTimes || {}) };
                updated[state.domain] = (updated[state.domain] || 0) + duration;
                await storageSet({ siteTimes: updated });

                if (isCheckpoint) {
                    await chrome.storage.local.set({
                        trackingState: { domain: state.domain, startTime: now }
                    });
                    return;
                }
            }
        }
        if (!isCheckpoint) {
            await chrome.storage.local.remove("trackingState");
        }
    } catch (e) {
        console.error("LogTime error:", e);
    }
}

async function updateActiveTab() {
    try {
        const data = await chrome.storage.local.get("trackingState");
        const oldState = data.trackingState;

        let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });

        if (!tab) {
            const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            tab = currentTabs[0];
        }

        if (!tab) {
            const normalTabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
            tab = normalTabs[0];
        }

        const newDomain = tab ? getDomain(tab.url) : null;

        if (oldState && oldState.domain !== newDomain) {
            await logTime(false);
        }

        if (newDomain) {
            if (!oldState || oldState.domain !== newDomain) {
                await chrome.storage.local.set({
                    trackingState: { domain: newDomain, startTime: Date.now() }
                });
            } else {
                await logTime(true);
            }
        }
    } catch (e) {
        console.error("UpdateActiveTab error:", e);
    }
}

async function storageInit() {
    const existing = await storageGet(Object.keys(DEFAULTS));
    const toWrite = {};
    for (const key of Object.keys(DEFAULTS)) {
        if (existing[key] === undefined) {
            toWrite[key] = DEFAULTS[key];
        }
    }
    if (Object.keys(toWrite).length > 0) {
        await storageSet(toWrite);
    }
}

async function maybeDailyReset() {
    const today = new Date().toISOString().slice(0, 10);
    const { lastResetDate, siteTimes, weeklyTotals } = await storageGet([
        "lastResetDate",
        "siteTimes",
        "weeklyTotals",
    ]);

    if (lastResetDate === today) return;

    const totalSeconds = Object.values(siteTimes || {}).reduce((a, b) => a + b, 0);
    const updatedWeekly = { ...(weeklyTotals || {}) };
    if (lastResetDate) updatedWeekly[lastResetDate] = totalSeconds;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    for (const date of Object.keys(updatedWeekly)) {
        if (new Date(date) < cutoff) delete updatedWeekly[date];
    }

    await storageSet({
        siteTimes: {},
        weeklyTotals: updatedWeekly,
        lastResetDate: today,
    });

    await storageUpdate("timerState", { sessionsToday: 0 });
}

function scheduleDailyReset() {
    const now = new Date();
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 0);
    const delayMins = (midnight - now) / 1000 / 60;

    chrome.alarms.create("dailyReset", {
        delayInMinutes: delayMins > 0 ? delayMins : 1,
        periodInMinutes: 24 * 60,
    });

    chrome.alarms.create("heartbeat", {
        periodInMinutes: 1,
    });
}

// --- Pomodoro Logic ---

async function notify(title, message) {
    const { settings } = await storageGet(["settings"]);
    if (settings?.notificationsEnabled) {
        chrome.notifications.create({
            type: "basic",
            iconUrl: "popup/icon128.png", // Assuming icon will be added to popup/ or root later
            title,
            message,
            priority: 2
        });
    }
}

async function handleTimerComplete() {
    const { timerState } = await storageGet(["timerState"]);
    const nextState = { ...timerState };
    
    if (timerState.mode === "focus") {
        nextState.sessionsToday = (timerState.sessionsToday || 0) + 1;
        // Logic for long break every 4 sessions
        if (nextState.sessionsToday % 4 === 0) {
            nextState.mode = "long";
            nextState.duration = timerState.settings.longMins * 60;
            notify("Deep Focus Complete", "Time for a long break! You've done 4 sessions.");
        } else {
            nextState.mode = "short";
            nextState.duration = timerState.settings.shortMins * 60;
            notify("Focus Complete", "Great job! Time for a short break.");
        }
    } else {
        nextState.mode = "focus";
        nextState.duration = timerState.settings.focusMins * 60;
        notify("Break Over", "Ready to get back to work?");
    }

    nextState.running = false;
    nextState.endTime = null;
    await storageSet({ timerState: nextState });
    chrome.alarms.clear("pomodoroTimer");
}

async function startTimer() {
    const { timerState } = await storageGet(["timerState"]);
    if (timerState.running) return;

    const endTime = Date.now() + (timerState.duration * 1000);
    await storageUpdate("timerState", { running: true, endTime });
    
    chrome.alarms.create("pomodoroTimer", {
        when: endTime
    });
}

async function pauseTimer() {
    const { timerState } = await storageGet(["timerState"]);
    if (!timerState.running) return;

    const remaining = Math.max(0, Math.round((timerState.endTime - Date.now()) / 1000));
    await storageUpdate("timerState", { running: false, endTime: null, duration: remaining });
    chrome.alarms.clear("pomodoroTimer");
}

async function resetTimer() {
    const { timerState } = await storageGet(["timerState"]);
    let duration;
    if (timerState.mode === "focus") duration = timerState.settings.focusMins * 60;
    else if (timerState.mode === "short") duration = timerState.settings.shortMins * 60;
    else duration = timerState.settings.longMins * 60;

    await storageUpdate("timerState", { running: false, endTime: null, duration });
    chrome.alarms.clear("pomodoroTimer");
}

async function skipTimer() {
    await handleTimerComplete();
}

// --- Listeners ---

chrome.runtime.onInstalled.addListener(async () => {
    await storageInit();
    await maybeDailyReset();
    scheduleDailyReset();
    updateActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
    await maybeDailyReset();
    scheduleDailyReset();
    updateActiveTab();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "dailyReset") {
        await maybeDailyReset();
    } else if (alarm.name === "heartbeat") {
        await updateActiveTab();
    } else if (alarm.name === "pomodoroTimer") {
        await handleTimerComplete();
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "START_TIMER") startTimer().then(sendResponse);
    else if (request.action === "PAUSE_TIMER") pauseTimer().then(sendResponse);
    else if (request.action === "RESET_TIMER") resetTimer().then(sendResponse);
    else if (request.action === "SKIP_TIMER") skipTimer().then(sendResponse);
    else if (request.action === "UPDATE_TIMER_SETTINGS") {
        const { focusMins } = request;
        storageUpdate("timerState", { 
            settings: { 
                focusMins, 
                shortMins: focusMins === 25 ? 5 : Math.round(focusMins/5), 
                longMins: focusMins === 25 ? 15 : Math.round(focusMins/1.6) 
            },
            duration: focusMins * 60,
            running: false,
            endTime: null 
        }).then(() => {
            chrome.alarms.clear("pomodoroTimer");
            sendResponse();
        });
    }
    return true; // Keep channel open for async
});

chrome.tabs.onActivated.addListener(updateActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) updateActiveTab();
});
chrome.windows.onFocusChanged.addListener(updateActiveTab);
chrome.idle.onStateChanged.addListener((state) => {
    if (state === "active") {
        updateActiveTab();
    } else {
        logTime();
    }
});