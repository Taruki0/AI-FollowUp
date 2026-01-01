import {
    eventSource,
    event_types,
    saveSettingsDebounced,
} from "../../../../script.js";
import { extension_settings, getContext } from "../../../extensions.js";

const extensionName = "ai-followup";
const defaultSettings = {
    enabled: true,
    showCountdown: true,
    debugMode: true,
    customMessage:
        "*{{wait_time}} have passed. Current time: {{time}}. Current date: {{date}}.*",
};

let followupTimer = null;
let countdownInterval = null;
let pendingWaitTime = null;
let remainingMs = 0;

let countdownRoot = null;
let countdownTimeEl = null;
let countdownBarEl = null;
let countdownStatusEl = null;

let customMsgEl = null;
let previewEl = null;

// ------------------------------------------
// Debug / Toasts
// ------------------------------------------

function debugLog(message, type = "info") {
    const settings = extension_settings[extensionName];
    console.log(`%c[AI-Followup] ${message}`, "color: cyan; font-weight: bold;");

    if (!settings?.debugMode) return;

    try {
        if (typeof toastr !== "undefined") {
            switch (type) {
                case "success": toastr.success(message, "AI-Followup"); break;
                case "error": toastr.error(message, "AI-Followup"); break;
                case "warn": toastr.warning(message, "AI-Followup"); break;
                default: toastr.info(message, "AI-Followup");
            }
            return;
        }
    } catch {}

    showCustomToast(message, type);
}

function ensureToastContainer() {
    let el = document.getElementById("ai-followup-toast-container");
    if (!el) {
        el = document.createElement("div");
        el.id = "ai-followup-toast-container";
        el.className = "aif-toast-container";
        document.body.appendChild(el);
    }
    return el;
}

function showCustomToast(message, type) {
    const container = ensureToastContainer();
    const toast = document.createElement("div");
    toast.className = `aif-toast aif-${type || "info"}`;
    toast.setAttribute("role", "status");
    toast.innerHTML = `
        <div class="aif-toast-title">AI-Followup</div>
        <div class="aif-toast-body"></div>
    `;
    toast.querySelector(".aif-toast-body").textContent = message;

    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));

    setTimeout(() => {
        toast.classList.remove("is-visible");
        setTimeout(() => toast.remove(), 220);
    }, 2800);
}

// ------------------------------------------
// Time / Template
// ------------------------------------------

function getCurrentClockTime() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function getCurrentDate() {
    return new Date().toLocaleDateString();
}

function parseWaitTime(message) {
    if (!message) return null;
    const match = message.match(/\[WAIT:(\d+)(s|m|h)\]/i);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    let milliseconds = value * 60 * 1000;
    if (unit === "s") milliseconds = value * 1000;
    if (unit === "m") milliseconds = value * 60 * 1000;
    if (unit === "h") milliseconds = value * 60 * 60 * 1000;

    return { milliseconds, original: match[0], displayTime: `${value}${unit}` };
}

function formatTime(ms) {
    if (ms <= 0) return "0s";
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// --- getvar / setvar storage (REAL ST per-chat vars) ---
function getChatVar(name) {
    try {
        const ctx = getContext();
        const candidates = [
            ctx?.chat_metadata?.variables,
            ctx?.chatMetadata?.variables,
            ctx?.variables,
            ctx?.chatVars,
            ctx?.chat_variables,
        ];
        for (const obj of candidates) {
            if (obj && typeof obj === "object" && name in obj) return obj[name];
        }
    } catch {}
    return undefined;
}

function setChatVar(name, value) {
    try {
        const ctx = getContext();

        ctx.chat_metadata = ctx.chat_metadata || {};
        ctx.chat_metadata.variables = ctx.chat_metadata.variables || {};
        ctx.chat_metadata.variables[name] = value;

        if (ctx.chatMetadata && typeof ctx.chatMetadata === "object") {
            ctx.chatMetadata.variables = ctx.chatMetadata.variables || {};
            ctx.chatMetadata.variables[name] = value;
        }

        // mirrors (harmless)
        if (ctx.variables && typeof ctx.variables === "object") ctx.variables[name] = value;
        if (ctx.chatVars && typeof ctx.chatVars === "object") ctx.chatVars[name] = value;
        if (ctx.chat_variables && typeof ctx.chat_variables === "object") ctx.chat_variables[name] = value;

        if (typeof ctx.saveChat === "function") ctx.saveChat();
        return true;
    } catch (e) {
        console.warn("[AI-Followup] setChatVar failed:", e);
        return false;
    }
}

function applyTemplate(template, waitTimeDisplay) {
    let text = template ?? "";
    text = text.replace(/\{\{wait_time\}\}/g, waitTimeDisplay);
    text = text.replace(/\{\{time\}\}/g, getCurrentClockTime());
    text = text.replace(/\{\{date\}\}/g, getCurrentDate());

    text = text.replace(/\{\{getvar::([^}]+)\}\}/g, (_, varName) => {
        const v = getChatVar(String(varName).trim());
        return v === undefined || v === null ? "" : String(v);
    });

    return text;
}

// ------------------------------------------
// Countdown UI
// ------------------------------------------

function ensureCountdownDom() {
    if (countdownRoot) return countdownRoot;

    countdownRoot = document.getElementById("ai-followup-countdown");
    if (!countdownRoot) {
        countdownRoot = document.createElement("div");
        countdownRoot.id = "ai-followup-countdown";
        countdownRoot.innerHTML = `
            <div class="aif-countdown">
                <div class="aif-countdown-header">
                    <div class="aif-countdown-title">
                        <span class="aif-countdown-icon" aria-hidden="true">⏳</span>
                        <span>AI Waiting</span>
                    </div>
                    <button id="countdown-cancel"
                            class="aif-countdown-close aif-tip"
                            data-aif-tip="Cancel the active timer"
                            type="button"
                            title="Cancel">✕</button>
                </div>

                <div id="countdown-time" class="aif-countdown-time">--</div>

                <div class="aif-progress-track" aria-hidden="true">
                    <div id="countdown-progress-bar" class="aif-progress-bar" style="width:100%"></div>
                </div>

                <div id="countdown-status" class="aif-countdown-status">…</div>
            </div>
        `;
        document.body.appendChild(countdownRoot);
    }

    countdownTimeEl = countdownRoot.querySelector("#countdown-time");
    countdownBarEl = countdownRoot.querySelector("#countdown-progress-bar");
    countdownStatusEl = countdownRoot.querySelector("#countdown-status");

    const cancel = countdownRoot.querySelector("#countdown-cancel");
    if (cancel) cancel.onclick = () => { clearFollowupTimer(); debugLog("Timer cancelled", "warn"); };

    return countdownRoot;
}

function showCountdown() { ensureCountdownDom().classList.add("is-visible"); }
function hideCountdown() { if (countdownRoot) countdownRoot.classList.remove("is-visible"); }

function updateCountdownDisplay() {
    if (!pendingWaitTime || !countdownTimeEl || !countdownBarEl) return;

    countdownTimeEl.textContent = formatTime(remainingMs);

    const percent = Math.max(0, Math.min(100, (remainingMs / pendingWaitTime.milliseconds) * 100));
    countdownBarEl.style.width = `${percent}%`;

    if (countdownStatusEl) countdownStatusEl.textContent = `Auto-send in ${formatTime(remainingMs)}`;
}

function startCountdown(totalMs) {
    remainingMs = totalMs;

    if (countdownInterval) clearInterval(countdownInterval);

    if (extension_settings[extensionName].showCountdown) {
        showCountdown();
        updateCountdownDisplay();

        countdownInterval = setInterval(() => {
            remainingMs -= 1000;
            if (remainingMs <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                hideCountdown();
            } else {
                updateCountdownDisplay();
            }
        }, 1000);
    }
}

// ------------------------------------------
// Main logic
// ------------------------------------------

async function triggerFollowup(waitTimeDisplay) {
    debugLog("Triggering follow-up!", "success");

    const context = getContext();
    if (!context.characterId) {
        debugLog("No character!", "error");
        return;
    }

    clearFollowupTimer();

    try {
        const template = extension_settings[extensionName].customMessage || "*hasn't responded for {{wait_time}}*";
        const msgText = applyTemplate(template, waitTimeDisplay);

        const textarea = document.getElementById("send_textarea");
        const sendButton = document.getElementById("send_but");

        if (textarea && sendButton) {
            textarea.value = msgText;
            textarea.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 100));
            sendButton.click();
            debugLog("Message sent!", "success");
            return;
        }

        debugLog("Fallback send method...", "warn");
        const userName = context.name1 || "User";
        const newMessage = { name: userName, is_user: true, is_system: false, mes: msgText, send_date: Date.now() };
        context.chat.push(newMessage);

        if (typeof window.addOneMessage === "function") window.addOneMessage(newMessage);
        await context.saveChat();

        if (typeof window.reloadCurrentChat === "function") await window.reloadCurrentChat();
        if (typeof window.Generate === "function") await window.Generate("normal");
    } catch (error) {
        debugLog("Error: " + error.message, "error");
        console.error(error);
    }
}

function setFollowupTimer(waitTimeData) {
    clearFollowupTimer();
    pendingWaitTime = waitTimeData;

    debugLog("Timer: " + waitTimeData.displayTime, "success");
    startCountdown(waitTimeData.milliseconds);
    followupTimer = setTimeout(() => {
        triggerFollowup(waitTimeData.displayTime);
    }, waitTimeData.milliseconds);
}

function clearFollowupTimer() {
    if (followupTimer) {
        clearTimeout(followupTimer);
        followupTimer = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    pendingWaitTime = null;
    remainingMs = 0;
    hideCountdown();
}

function onAIMessage() {
    if (!extension_settings[extensionName].enabled) return;

    const context = getContext();
    const chat = context.chat;
    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];
    if (lastMessage && !lastMessage.is_user) {
        const waitTime = parseWaitTime(lastMessage.mes);
        if (waitTime) setFollowupTimer(waitTime);
    }
}

// ------------------------------------------
// Settings UI
// ------------------------------------------

function renderPreview() {
    if (!customMsgEl || !previewEl) return;
    const fakeWait = "10s";
    const text = applyTemplate(customMsgEl.value || defaultSettings.customMessage, fakeWait);
    previewEl.textContent = text;
}

function createSettingsUI() {
    if (document.getElementById("ai-followup-settings")) return;

    const html = `
    <div id="ai-followup-settings" class="ai-followup-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header aif-header">
                <div class="aif-header-left">
                    <b class="aif-title">AI Follow-up</b>
                </div>
                <div class="aif-header-right">
                    <a class="aif-gh aif-tip" data-aif-tip="Open the project on GitHub" href="https://github.com/yourname/ai-followup" target="_blank" rel="noopener noreferrer">
                        <i class="fa-brands fa-github"></i> GitHub
                    </a>
                </div>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>

            <div class="inline-drawer-content aif-content">
                <div class="ai-followup-info">
                    <div class="aif-info-title">Template variables</div>

                    <div class="aif-chips">
                        <span class="aif-chip aif-tip" data-aif-tip="Detected wait time (e.g. 10s).">{{wait_time}}</span>
                        <span class="aif-chip aif-tip" data-aif-tip="Local time.">{{time}}</span>
                        <span class="aif-chip aif-tip" data-aif-tip="Local date.">{{date}}</span>
                        <span class="aif-chip aif-tip" data-aif-tip="Reads a chat variable.">{{getvar::stoptime}}</span>
                    </div>
                </div>
<div class="aif-toggle-grid">
</div>

                <div class="aif-field">
                    <label class="aif-label">Message template</label>
                    <textarea id="ai_followup_custom_msg"
                              class="text_pole"
                              placeholder="e.g. *{{wait_time}} passed…*"
                              rows="3"></textarea>

                    <div class="aif-preview-wrap">
                        <div class="aif-preview-title">Preview</div>
                        <pre id="ai_followup_preview" class="aif-preview"></pre>
                    </div>
<div class="aif-actions">
                        <button id="ai_followup_reset" class="menu_button">Reset</button>
                        <button id="ai_followup_test" class="menu_button">Test (10s)</button>
                    </div>
                </div>

            </div>
        </div>
    </div>`;

    const container = document.getElementById("extensions_settings");
    if (container) container.insertAdjacentHTML("beforeend", html);
    else if (typeof jQuery !== "undefined") jQuery("#extensions_settings").append(html);

    const s = extension_settings[extensionName];

    const enabledEl = document.getElementById("ai_followup_enabled");
    const countdownEl = document.getElementById("ai_followup_countdown");
    const debugEl = document.getElementById("ai_followup_debug");
customMsgEl = document.getElementById("ai_followup_custom_msg");
    previewEl = document.getElementById("ai_followup_preview");

    const resetBtn = document.getElementById("ai_followup_reset");
    const testBtn = document.getElementById("ai_followup_test");
if (enabledEl) {
        enabledEl.checked = s.enabled;
        enabledEl.onchange = function () {
            s.enabled = this.checked;
            saveSettingsDebounced();
            if (!this.checked) clearFollowupTimer();
        };
    }

    if (countdownEl) {
        countdownEl.checked = s.showCountdown;
        countdownEl.onchange = function () {
            s.showCountdown = this.checked;
            saveSettingsDebounced();
            if (!this.checked) hideCountdown();
        };
    }

    if (debugEl) {
        debugEl.checked = s.debugMode;
        debugEl.onchange = function () {
            s.debugMode = this.checked;
            saveSettingsDebounced();
        };
    }
    if (customMsgEl) {
        customMsgEl.value = s.customMessage || defaultSettings.customMessage;
        customMsgEl.oninput = function () {
            s.customMessage = this.value;
            saveSettingsDebounced();
            renderPreview();
        };
    }

    if (resetBtn) {
        resetBtn.onclick = function () {
            s.customMessage = defaultSettings.customMessage;
            if (customMsgEl) customMsgEl.value = s.customMessage;
            saveSettingsDebounced();
            renderPreview();
            debugLog("Template reset", "info");
        };
    }

    if (testBtn) {
        testBtn.onclick = function () {
            debugLog("Starting 10s test timer", "success");
            setFollowupTimer({ milliseconds: 10000, displayTime: "10s", original: "TEST" });
        };
    }

    renderPreview();
}

// ------------------------------------------
// Init
// ------------------------------------------

(function init() {
    if (window.__aif_followup_loaded) return;

    if (typeof jQuery === "undefined") {
        setTimeout(init, 100);
        return;
    }

    jQuery(async () => {
        try {
            extension_settings[extensionName] = extension_settings[extensionName] || {};
            Object.assign(extension_settings[extensionName], defaultSettings, extension_settings[extensionName]);

            createSettingsUI();

            eventSource.on(event_types.MESSAGE_RECEIVED, onAIMessage);
            eventSource.on(event_types.MESSAGE_SENT, clearFollowupTimer);
            eventSource.on(event_types.CHAT_CHANGED, clearFollowupTimer);

            window.__aif_followup_loaded = true;

            console.log("%c[AI-Followup] Loaded!", "color: lime; font-weight: bold; font-size: 14px;");
            if (extension_settings[extensionName].debugMode) setTimeout(() => debugLog("Extension ready!", "success"), 800);
        } catch (error) {
            console.error("[AI-Followup] Init error:", error);
        }
    });
})();
