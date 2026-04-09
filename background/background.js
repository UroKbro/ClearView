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
        burnoutAlertsEnabled: true,
    },
    burnoutState: {
        lastNotification: 0,
        sessionStartTime: Date.now(),
    },
    blockedSites: [
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "youtube.com",
        "reddit.com",
        "tiktok.com"
    ],
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
        await maybeDailyReset(); // Ensure we are tracking for the correct day
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
                // New domain started - if we were previously 'idle' or this is first tab of the day,
                // we might want to check session start, but let's keep it simple: 
                // trackingState tracks the CURRENT domain. 
                // sessionStartTime in burnoutState tracks the time since the user became active.
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

// --- Burnout Logic ---

async function checkBurnoutConditions() {
    const { settings, burnoutState, siteTimes, weeklyTotals } = await storageGet([
        "settings",
        "burnoutState",
        "siteTimes",
        "weeklyTotals"
    ]);

    if (!settings?.burnoutAlertsEnabled) return;

    const now = Date.now();
    const fourHours = 4 * 60 * 60 * 1000;

    // Check throttle
    if (now - (burnoutState?.lastNotification || 0) < fourHours) return;

    let alertTitle = null;
    let alertMsg = null;

    // 1. Continuous Work Threshold (2 hours)
    const sessionDurationMins = (now - (burnoutState?.sessionStartTime || now)) / 1000 / 60;
    if (sessionDurationMins > 120) {
        alertTitle = "Focus Fatigue Detected";
        alertMsg = "You've been active for 2 hours straight. A 5-minute breather would actually boost your performance.";
    }

    // 2. Late Night Threshold (11:30 PM - 5:00 AM)
    const hours = new Date().getHours();
    const minutes = new Date().getMinutes();
    if (!alertTitle && (hours >= 23 && minutes >= 30 || hours < 5)) {
        alertTitle = "Diminishing Returns";
        alertMsg = "It's getting late. Performance drops sharply after midnight—maybe it's time for your shut-down ritual?";
    }

    // 3. High Intensity Threshold (Today > 1.2 * 7-day Average)
    const totalToday = Object.values(siteTimes || {}).reduce((a, b) => a + b, 0);
    const weeklyValues = Object.values(weeklyTotals || {});
    if (!alertTitle && weeklyValues.length >= 3 && totalToday > 7200) { // Only if they've worked > 2h today
        const avg = weeklyValues.reduce((a, b) => a + b, 0) / weeklyValues.length;
        if (totalToday > avg * 1.2) {
            alertTitle = "High Intensity Day";
            alertMsg = "You're 20% above your daily average usage. Watch out for burnout; your future self will thank you for resting.";
        }
    }

    if (alertTitle) {
        notify(alertTitle, alertMsg);
        await storageUpdate("burnoutState", { lastNotification: now });
    }
}

// --- Blocking Logic ---

async function updateBlockingRules(enable) {
    if (!chrome.declarativeNetRequest) return;

    // Clear existing rules regardless
    const oldRules = await chrome.declarativeNetRequest.getDynamicRules();
    const oldRuleIds = oldRules.map(r => r.id);
    
    const removeRuleIds = oldRuleIds;
    const addRules = [];

    if (enable) {
        const { blockedSites } = await storageGet(["blockedSites"]);
        const sites = blockedSites || DEFAULTS.blockedSites;
        const redirectUrl = chrome.runtime.getURL("blocked/blocked.html");

        sites.forEach((domain, index) => {
            addRules.push({
                id: index + 1,
                priority: 1,
                action: {
                    type: "redirect",
                    redirect: { url: redirectUrl }
                },
                condition: {
                    urlFilter: `||${domain}^`,
                    resourceTypes: ["main_frame", "sub_frame"]
                }
            });
        });
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules
    });
    
    console.log(`[ClearView] Site blocking ${enable ? "ENABLED" : "DISABLED"}. Rules active:`, addRules.length);
}

async function syncBlockingState() {
    const { timerState } = await storageGet(["timerState"]);
    if (timerState && timerState.running && timerState.mode === "focus") {
        await updateBlockingRules(true);
    } else {
        await updateBlockingRules(false);
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

    // Disable blocking regardless of focus/break
    await updateBlockingRules(false);
}

async function startTimer() {
    const { timerState } = await storageGet(["timerState"]);
    if (timerState.running) return;

    const endTime = Date.now() + (timerState.duration * 1000);
    await storageUpdate("timerState", { running: true, endTime });
    
    chrome.alarms.create("pomodoroTimer", {
        when: endTime
    });

    if (timerState.mode === "focus") {
        await updateBlockingRules(true);
    }
}

async function pauseTimer() {
    const { timerState } = await storageGet(["timerState"]);
    if (!timerState.running) return;

    const remaining = Math.max(0, Math.round((timerState.endTime - Date.now()) / 1000));
    await storageUpdate("timerState", { running: false, endTime: null, duration: remaining });
    chrome.alarms.clear("pomodoroTimer");

    await updateBlockingRules(false);
}

async function resetTimer() {
    const { timerState } = await storageGet(["timerState"]);
    let duration;
    if (timerState.mode === "focus") duration = timerState.settings.focusMins * 60;
    else if (timerState.mode === "short") duration = timerState.settings.shortMins * 60;
    else duration = timerState.settings.longMins * 60;

    await storageUpdate("timerState", { running: false, endTime: null, duration });
    chrome.alarms.clear("pomodoroTimer");

    await updateBlockingRules(false);
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
    await updateBlockingRules(false); // Clean slate
});

chrome.runtime.onStartup.addListener(async () => {
    await maybeDailyReset();
    scheduleDailyReset();
    updateActiveTab();
    await syncBlockingState();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === "dailyReset") {
        await maybeDailyReset();
    } else if (alarm.name === "heartbeat") {
        await maybeDailyReset();
        await updateActiveTab();
        await checkBurnoutConditions();
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
chrome.idle.onStateChanged.addListener(async (state) => {
    if (state === "active") {
        const now = Date.now();
        await storageUpdate("burnoutState", { sessionStartTime: now });
        updateActiveTab();
    } else {
        logTime();
        // Clear session start when idle/locked
        await storageUpdate("burnoutState", { sessionStartTime: Date.now() });
    }
});