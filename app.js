// Pinned stable version: keeps the JavaScript bundle and its WASM files compatible.
const MP_VERSION = "0.10.3";
const VISION_MODULE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/vision_bundle.mjs`;
const WASM_PATH = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const MODEL_PATH = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const DEFAULT_STABLE_MS = 650;
const DEFAULT_COOLDOWN_MS = 900;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const dom = {
  video: $("#webcam"),
  canvas: $("#landmark-canvas"),
  scannerFrame: $("#scanner-frame"),
  placeholder: $("#camera-placeholder"),
  placeholderTitle: $("#placeholder-title"),
  placeholderSubtitle: $("#placeholder-subtitle"),
  loading: $("#loading-overlay"),
  loadingText: $("#loading-text"),
  start: $("#start-btn"),
  stop: $("#stop-btn"),
  reset: $("#reset-btn"),
  gesture: $("#gesture-output"),
  confidence: $("#confidence-output"),
  stability: $("#stability-bar"),
  fps: $("#fps"),
  engineStatus: $("#engine-status"),
  networkPill: $(".network-pill"),
  trackingStatus: $("#tracking-status"),
  visionStatus: $("#vision-status"),
  statusOrb: $(".status-orb"),
  statusOrbText: $("#status-orb-text"),
  commandGlyph: $("#command-glyph"),
  commandOutput: $("#command-output"),
  commandTime: $("#command-time"),
  history: $("#history-list"),
  clearHistory: $("#clear-history"),
  demoToggle: $("#demo-toggle"),
  demoPanel: $("#demo-panel"),
  closeDemo: $("#close-demo"),
  toastRegion: $("#toast-region"),
  clock: $("#clock"),
  settingsToggle: $("#settings-toggle"),
  settingsPanel: $("#settings-panel"),
  closeSettings: $("#close-settings"),
  stabilitySetting: $("#stability-setting"),
  stabilityValue: $("#stability-value"),
  cooldownSetting: $("#cooldown-setting"),
  cooldownValue: $("#cooldown-value"),
  settingsReset: $("#settings-reset"),
  fullscreen: $("#fullscreen-btn")
};

const state = {
  recognizer: null,
  initPromise: null,
  mediaStream: null,
  running: false,
  visualPaused: false,
  animationId: null,
  lastVideoTime: -1,
  frameCounter: 0,
  fpsStartedAt: performance.now(),
  candidate: "None",
  candidateSince: 0,
  lastTriggered: null,
  noGestureSince: 0,
  panelIndex: 0,
  history: [],
  demoOpen: false,
  settingsOpen: false,
  stabilityMs: DEFAULT_STABLE_MS,
  cooldownMs: DEFAULT_COOLDOWN_MS,
  lastActionAt: -Infinity,
  enabledGestures: {
    Open_Palm: true,
    Closed_Fist: true,
    Pointing_Up: true,
    Victory: true,
    Thumb_Up: true
  }
};

const gestureMeta = {
  Open_Palm: { label: "OPEN PALM", command: "SCAN ACTIVE", glyph: "◎" },
  Closed_Fist: { label: "CLOSED FIST", command: "MATRIX PAUSED", glyph: "■" },
  Pointing_Up: { label: "POINTING UP", command: "PANEL SELECTED", glyph: "⌃" },
  Victory: { label: "VICTORY", command: "PANEL ADVANCED", glyph: "Ⅱ" },
  Thumb_Up: { label: "THUMB UP", command: "COMMAND ACCEPTED", glyph: "▲" },
  None: { label: "NO GESTURE", command: "AWAITING INPUT", glyph: "◇" }
};

const handConnections = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],[0,17]
];

function setLoading(show, message = "LOADING VISION CORE") {
  dom.loadingText.textContent = message;
  dom.loading.classList.toggle("hidden", !show);
}

function setEngineStatus(status, tone = "") {
  dom.engineStatus.textContent = status;
  dom.networkPill.classList.remove("ready", "error");
  if (tone) dom.networkPill.classList.add(tone);
}

function setTracking(text, mode = "idle") {
  dom.trackingStatus.textContent = text;
  dom.trackingStatus.dataset.state = mode;
  dom.statusOrb.classList.toggle("active", mode === "active");
  dom.statusOrbText.textContent = mode === "active" ? "ONLINE" : mode === "error" ? "FAULT" : "IDLE";
}

function showToast(message, tone = "info", duration = 4600) {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  dom.toastRegion.append(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function clockString() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC"
  }).format(new Date());
}

function tickClock() {
  dom.clock.textContent = `${clockString()} UTC`;
}

async function initializeVision() {
  if (state.recognizer) return state.recognizer;
  if (state.initPromise) return state.initPromise;

  state.initPromise = (async () => {
    try {
      setLoading(true, "DOWNLOADING VISION MODEL");
      setEngineStatus("ENGINE LOADING");
      dom.visionStatus.textContent = "LOADING";
      const { FilesetResolver, GestureRecognizer } = await import(VISION_MODULE);
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      const options = {
        baseOptions: { modelAssetPath: MODEL_PATH, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5
      };

      try {
        state.recognizer = await GestureRecognizer.createFromOptions(vision, options);
      } catch (gpuError) {
        console.warn("GPU delegate unavailable; using CPU delegate.", gpuError);
        options.baseOptions.delegate = "CPU";
        state.recognizer = await GestureRecognizer.createFromOptions(vision, options);
      }

      dom.visionStatus.textContent = "READY";
      setEngineStatus("ENGINE READY", "ready");
      setLoading(false);
      return state.recognizer;
    } catch (error) {
      console.error("MediaPipe initialization failed", error);
      state.initPromise = null;
      dom.visionStatus.textContent = "ERROR";
      setEngineStatus("ENGINE ERROR", "error");
      setLoading(false);
      dom.placeholderTitle.textContent = "VISION ENGINE UNAVAILABLE";
      dom.placeholderSubtitle.textContent = "Check your connection, then press Start to retry";
      showToast("The MediaPipe vision model could not load. Check your connection and try again. Demo mode remains available.", "error", 7000);
      throw error;
    }
  })();
  return state.initPromise;
}

function waitForVideo(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) return resolve();
    const timeout = setTimeout(() => reject(new Error("Camera stream timed out.")), 10000);
    video.addEventListener("loadeddata", () => { clearTimeout(timeout); resolve(); }, { once: true });
    video.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Camera stream failed.")); }, { once: true });
  });
}

function cameraErrorMessage(error) {
  if (!window.isSecureContext) return "Camera access requires HTTPS. Open this app from a secure HTTPS address.";
  switch (error?.name) {
    case "NotAllowedError": return "Camera permission was denied. Allow camera access in your browser settings, then press Start again.";
    case "NotFoundError": return "No camera was found on this device.";
    case "NotReadableError": return "The camera is busy or unavailable. Close other camera apps and try again.";
    case "OverconstrainedError": return "This camera does not support the requested capture settings.";
    case "SecurityError": return "The browser blocked camera access for security reasons.";
    default: return error?.message ? `Camera could not start: ${error.message}` : "Camera could not start on this browser.";
  }
}

async function startScanner() {
  if (state.running) return;
  closeDemo();
  dom.start.disabled = true;
  setLoading(true, "PREPARING VISION CORE");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException("Camera APIs are not supported by this browser.", "NotSupportedError");
    }
    if (!window.isSecureContext) {
      throw new DOMException("A secure HTTPS context is required.", "SecurityError");
    }

    await initializeVision();
    setLoading(true, "AWAITING CAMERA ACCESS");

    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    dom.video.srcObject = state.mediaStream;
    await waitForVideo(dom.video);
    await dom.video.play();

    state.running = true;
    state.lastVideoTime = -1;
    state.frameCounter = 0;
    state.fpsStartedAt = performance.now();
    dom.video.classList.add("active");
    dom.placeholder.classList.add("hidden");
    dom.scannerFrame.classList.add("scanning");
    dom.start.disabled = true;
    dom.stop.disabled = false;
    setTracking("TRACKING", "active");
    setEngineStatus("SCANNER ACTIVE", "ready");
    setLoading(false);
    showToast("Camera active. Video remains on this device and is processed locally.");
    state.animationId = requestAnimationFrame(predictFrame);
  } catch (error) {
    console.error("Scanner start failed", error);
    stopScanner(false);
    const message = cameraErrorMessage(error);
    dom.placeholderTitle.textContent = "CAMERA OFFLINE";
    dom.placeholderSubtitle.textContent = message;
    setTracking("UNAVAILABLE", "error");
    setEngineStatus(state.recognizer ? "CAMERA ERROR" : "ENGINE ERROR", "error");
    setLoading(false);
    dom.start.disabled = false;
    showToast(message + " You can use Camera-Free Demo Mode instead.", "error", 7800);
  }
}

function stopScanner(notify = true) {
  state.running = false;
  if (state.animationId) cancelAnimationFrame(state.animationId);
  state.animationId = null;
  state.mediaStream?.getTracks().forEach(track => track.stop());
  state.mediaStream = null;
  dom.video.srcObject = null;
  dom.video.classList.remove("active");
  dom.placeholder.classList.remove("hidden");
  dom.scannerFrame.classList.remove("scanning", "visual-paused");
  dom.stop.disabled = true;
  dom.start.disabled = false;
  state.visualPaused = false;
  clearCanvas();
  resetDetectionReadout();
  setTracking("OFFLINE", "idle");
  dom.placeholderTitle.textContent = "SCANNER STANDBY";
  dom.placeholderSubtitle.textContent = "Press start to authorize camera access";
  setEngineStatus(state.recognizer ? "ENGINE READY" : "ENGINE LOADING", state.recognizer ? "ready" : "");
  if (notify) showToast("Scanner stopped. Camera access released.");
}

function resetDetectionReadout() {
  state.candidate = "None";
  state.candidateSince = 0;
  state.lastTriggered = null;
  state.noGestureSince = 0;
  dom.gesture.textContent = "NO SIGNAL";
  dom.confidence.textContent = "—";
  dom.stability.style.width = "0%";
  dom.fps.textContent = "--";
}

function resetInterface() {
  resetDetectionReadout();
  state.panelIndex = 0;
  state.visualPaused = false;
  dom.scannerFrame.classList.remove("visual-paused");
  updatePanels();
  dom.commandGlyph.textContent = "◇";
  dom.commandOutput.textContent = "AWAITING INPUT";
  dom.commandTime.textContent = "NO COMMANDS LOGGED";
  showToast("Control matrix reset.");
}

function clearCanvas() {
  const ctx = dom.canvas.getContext("2d");
  ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
}

function drawLandmarks(landmarks) {
  const width = dom.video.videoWidth || 640;
  const height = dom.video.videoHeight || 480;
  if (dom.canvas.width !== width || dom.canvas.height !== height) {
    dom.canvas.width = width;
    dom.canvas.height = height;
  }
  const ctx = dom.canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (!landmarks?.length) return;

  ctx.save();
  ctx.lineWidth = Math.max(2, width / 360);
  ctx.strokeStyle = "rgba(84, 236, 255, .85)";
  ctx.shadowColor = "#36dfff";
  ctx.shadowBlur = 7;
  ctx.beginPath();
  for (const [a, b] of handConnections) {
    ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
  }
  ctx.stroke();

  landmarks.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x * width, point.y * height, index === 0 ? 5 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = index === 0 ? "#ffffff" : "#6ff6ff";
    ctx.fill();
  });
  ctx.restore();
}

function normalizeGesture(name) {
  return gestureMeta[name] ? name : "None";
}

function updateFPS(now) {
  state.frameCounter += 1;
  const elapsed = now - state.fpsStartedAt;
  if (elapsed >= 1000) {
    dom.fps.textContent = Math.round(state.frameCounter * 1000 / elapsed);
    state.frameCounter = 0;
    state.fpsStartedAt = now;
  }
}

function predictFrame(now) {
  if (!state.running) return;
  try {
    if (dom.video.readyState >= 2 && dom.video.currentTime !== state.lastVideoTime) {
      state.lastVideoTime = dom.video.currentTime;
      const result = state.recognizer.recognizeForVideo(dom.video, now);
      const topGesture = result.gestures?.[0]?.[0];
      const gesture = normalizeGesture(topGesture?.categoryName || "None");
      const score = topGesture?.score ?? 0;
      drawLandmarks(result.landmarks?.[0]);
      processDetection(gesture, score, now);
      updateFPS(now);
    }
  } catch (error) {
    console.error("Frame processing failed", error);
    showToast("Vision processing encountered an error. The scanner has been stopped.", "error");
    stopScanner(false);
    return;
  }
  state.animationId = requestAnimationFrame(predictFrame);
}

function processDetection(gesture, score, now) {
  const meta = gestureMeta[gesture];
  dom.gesture.textContent = meta.label;
  dom.confidence.textContent = gesture === "None" ? "—" : `${Math.round(score * 100)}%`;

  if (gesture === "None") {
    dom.stability.style.width = "0%";
    state.candidate = "None";
    state.candidateSince = now;
    if (!state.noGestureSince) state.noGestureSince = now;
    if (now - state.noGestureSince > 350) state.lastTriggered = null;
    return;
  }

  state.noGestureSince = 0;
  if (gesture !== state.candidate) {
    state.candidate = gesture;
    state.candidateSince = now;
    dom.stability.style.width = "0%";
    animateText(dom.gesture);
    return;
  }

  if (!state.enabledGestures[gesture]) {
    dom.gesture.textContent = `${meta.label} // DISABLED`;
    dom.stability.style.width = "0%";
    state.candidate = "None";
    state.candidateSince = now;
    state.lastTriggered = null;
    return;
  }

  const progress = Math.min(1, (now - state.candidateSince) / state.stabilityMs);
  dom.stability.style.width = `${Math.round(progress * 100)}%`;

  if (progress >= 1 && state.lastTriggered !== gesture && now - state.lastActionAt >= state.cooldownMs) {
    state.lastTriggered = gesture;
    state.lastActionAt = now;
    triggerGesture(gesture, score, "CAMERA");
  }
}

function triggerGesture(gesture, score = 1, source = "CAMERA") {
  const meta = gestureMeta[gesture];
  if (!meta || gesture === "None") return;
  if (!state.enabledGestures[gesture]) {
    showToast(`${meta.label} is disabled in Settings.`, "warning", 2600);
    return;
  }

  let command = meta.command;
  let details = "";

  switch (gesture) {
    case "Open_Palm":
      state.visualPaused = false;
      dom.scannerFrame.classList.remove("visual-paused");
      command = "SCAN ACTIVE";
      break;
    case "Closed_Fist":
      state.visualPaused = true;
      dom.scannerFrame.classList.add("visual-paused");
      command = "VISUAL MATRIX PAUSED";
      break;
    case "Pointing_Up": {
      const panel = $$(".matrix-panel")[state.panelIndex];
      panel.classList.add("selected");
      panel.querySelector(".panel-state").textContent = "SELECTED";
      setTimeout(() => panel.classList.remove("selected"), 850);
      command = `${panel.dataset.panel} SELECTED`;
      details = panel.dataset.panel;
      break;
    }
    case "Victory":
      state.panelIndex = (state.panelIndex + 1) % $$(".matrix-panel").length;
      updatePanels();
      command = `TARGET: ${$$(".matrix-panel")[state.panelIndex].dataset.panel}`;
      details = "NEXT PANEL";
      break;
    case "Thumb_Up":
      command = "COMMAND ACCEPTED";
      break;
  }

  dom.commandGlyph.textContent = meta.glyph;
  dom.commandOutput.textContent = command;
  dom.commandTime.textContent = `${clockString()} UTC // ${source}`;
  animateText(dom.commandGlyph, "command-flash");
  animateText(dom.commandOutput, "gesture-pop");
  addHistory(command, meta.label, score, source, details);
}

function animateText(element, className = "gesture-pop") {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function updatePanels() {
  const panels = $$(".matrix-panel");
  panels.forEach((panel, index) => {
    const active = index === state.panelIndex;
    panel.classList.toggle("highlighted", active);
    panel.querySelector(".panel-state").textContent = active ? "HIGHLIGHTED" : "STANDBY";
    if (active && window.innerWidth <= 760) {
      panel.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  });
}

function addHistory(command, gesture, score, source) {
  state.history.unshift({ command, gesture, score, source, time: clockString() });
  state.history = state.history.slice(0, 10);
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    dom.history.innerHTML = '<li class="empty"><span>00:00:00</span><b>NO COMMANDS DETECTED</b></li>';
    return;
  }
  dom.history.replaceChildren(...state.history.map(entry => {
    const item = document.createElement("li");
    const confidence = entry.source === "CAMERA" ? `${Math.round(entry.score * 100)}%` : "DEMO";
    item.innerHTML = `<span>${entry.time}</span><b>${escapeHTML(entry.command)}</b><em>${confidence}</em>`;
    item.title = `${entry.gesture} • ${entry.source}`;
    return item;
  }));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function openDemo() {
  if (state.running) stopScanner(false);
  closeSettings();
  state.demoOpen = true;
  dom.demoPanel.classList.add("open");
  dom.demoPanel.setAttribute("aria-hidden", "false");
  dom.demoToggle.querySelector("b").textContent = "DEMO MODE ACTIVE";
  dom.demoPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  setTracking("DEMO MODE", "idle");
  setEngineStatus("SIMULATION MODE");
}

function closeDemo() {
  state.demoOpen = false;
  dom.demoPanel.classList.remove("open");
  dom.demoPanel.setAttribute("aria-hidden", "true");
  dom.demoToggle.querySelector("b").textContent = "CAMERA-FREE DEMO MODE";
  if (!state.running) {
    setTracking("OFFLINE", "idle");
    setEngineStatus(state.recognizer ? "ENGINE READY" : "ENGINE LOADING", state.recognizer ? "ready" : "");
  }
}

function simulateGesture(gesture, button) {
  $$("[data-demo-gesture]").forEach(item => item.disabled = true);
  dom.gesture.textContent = gestureMeta[gesture].label;
  dom.confidence.textContent = "DEMO";
  dom.stability.style.width = "0%";
  button.style.borderColor = "var(--cyan)";
  const started = performance.now();

  function progress(now) {
    const value = Math.min(1, (now - started) / 420);
    dom.stability.style.width = `${value * 100}%`;
    if (value < 1) return requestAnimationFrame(progress);
    triggerGesture(gesture, 1, "DEMO");
    $$("[data-demo-gesture]").forEach(item => item.disabled = false);
    button.style.borderColor = "";
  }
  requestAnimationFrame(progress);
}

function selectPanelByTap(panel) {
  state.panelIndex = $$(".matrix-panel").indexOf(panel);
  updatePanels();
  panel.classList.add("selected");
  setTimeout(() => panel.classList.remove("selected"), 700);
  dom.commandGlyph.textContent = "⌃";
  dom.commandOutput.textContent = `${panel.dataset.panel} SELECTED`;
  dom.commandTime.textContent = `${clockString()} UTC // TOUCH`;
  addHistory(`${panel.dataset.panel} SELECTED`, "TOUCH INPUT", 1, "TOUCH");
}

function openSettings() {
  state.settingsOpen = true;
  dom.settingsPanel.classList.add("open");
  dom.settingsPanel.setAttribute("aria-hidden", "false");
  dom.settingsToggle.setAttribute("aria-expanded", "true");
  dom.settingsPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeSettings() {
  if (!dom.settingsPanel) return;
  state.settingsOpen = false;
  dom.settingsPanel.classList.remove("open");
  dom.settingsPanel.setAttribute("aria-hidden", "true");
  dom.settingsToggle.setAttribute("aria-expanded", "false");
}

function syncSettingsUI() {
  dom.stabilitySetting.value = String(state.stabilityMs);
  dom.stabilityValue.value = `${state.stabilityMs} ms`;
  dom.stabilityValue.textContent = `${state.stabilityMs} ms`;
  dom.cooldownSetting.value = String(state.cooldownMs);
  dom.cooldownValue.value = `${state.cooldownMs} ms`;
  dom.cooldownValue.textContent = `${state.cooldownMs} ms`;
  $$('[data-gesture-toggle]').forEach(input => {
    input.checked = Boolean(state.enabledGestures[input.dataset.gestureToggle]);
  });
  $$('[data-demo-gesture]').forEach(button => {
    button.disabled = !state.enabledGestures[button.dataset.demoGesture];
    button.title = button.disabled ? "This gesture is disabled in Settings" : "Simulate this gesture";
  });
}

function resetSettings() {
  state.stabilityMs = DEFAULT_STABLE_MS;
  state.cooldownMs = DEFAULT_COOLDOWN_MS;
  Object.keys(state.enabledGestures).forEach(name => { state.enabledGestures[name] = true; });
  syncSettingsUI();
  showToast("Default scanner settings restored.");
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await document.querySelector(".app-shell").requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    showToast("Full screen is not available in this browser. Try your browser menu instead.", "warning");
  }
}

function updateFullscreenButton() {
  if (dom.fullscreen) dom.fullscreen.textContent = document.fullscreenElement ? "⛶ EXIT FULL SCREEN" : "⛶ FULL SCREEN";
}

function initParticleField() {
  const canvas = $("#particle-field");
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let particles = [];

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.min(80, Math.floor(innerWidth * innerHeight / 18000));
    particles = Array.from({ length: count }, () => ({
      x: Math.random() * innerWidth,
      y: Math.random() * innerHeight,
      r: Math.random() * 1.2 + .2,
      vx: (Math.random() - .5) * .12,
      vy: Math.random() * -.18 - .03,
      alpha: Math.random() * .48 + .1
    }));
  }

  function render() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < -5) p.y = innerHeight + 5;
      if (p.x < -5) p.x = innerWidth + 5;
      if (p.x > innerWidth + 5) p.x = -5;
      ctx.fillStyle = `rgba(86, 230, 255, ${p.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!reduceMotion) requestAnimationFrame(render);
  }

  resize();
  render();
  addEventListener("resize", resize, { passive: true });
}

dom.start.addEventListener("click", startScanner);
dom.stop.addEventListener("click", () => stopScanner());
dom.reset.addEventListener("click", resetInterface);
dom.settingsToggle.addEventListener("click", () => state.settingsOpen ? closeSettings() : openSettings());
dom.closeSettings.addEventListener("click", closeSettings);
dom.stabilitySetting.addEventListener("input", event => {
  state.stabilityMs = Number(event.target.value);
  dom.stabilityValue.value = `${state.stabilityMs} ms`;
  dom.stabilityValue.textContent = `${state.stabilityMs} ms`;
});
dom.cooldownSetting.addEventListener("input", event => {
  state.cooldownMs = Number(event.target.value);
  dom.cooldownValue.value = `${state.cooldownMs} ms`;
  dom.cooldownValue.textContent = `${state.cooldownMs} ms`;
});
$$('[data-gesture-toggle]').forEach(input => {
  input.addEventListener("change", event => {
    const gesture = event.target.dataset.gestureToggle;
    state.enabledGestures[gesture] = event.target.checked;
    if (!event.target.checked && state.candidate === gesture) {
      state.candidate = "None";
      state.lastTriggered = null;
      dom.stability.style.width = "0%";
    }
    syncSettingsUI();
    showToast(`${gestureMeta[gesture].label} ${event.target.checked ? "enabled" : "disabled"}.`, "info", 2200);
  });
});
dom.settingsReset.addEventListener("click", resetSettings);
dom.fullscreen.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", updateFullscreenButton);
dom.demoToggle.addEventListener("click", () => state.demoOpen ? closeDemo() : openDemo());
dom.closeDemo.addEventListener("click", closeDemo);
dom.clearHistory.addEventListener("click", () => {
  state.history = [];
  renderHistory();
});
$$(`[data-demo-gesture]`).forEach(button => {
  button.addEventListener("click", () => simulateGesture(button.dataset.demoGesture, button));
});
$$(`.matrix-panel`).forEach(panel => {
  panel.addEventListener("click", () => selectPanelByTap(panel));
  panel.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPanelByTap(panel);
    }
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && state.running) {
    state.mediaStream?.getVideoTracks().forEach(track => { track.enabled = false; });
  } else if (state.running) {
    state.mediaStream?.getVideoTracks().forEach(track => { track.enabled = true; });
  }
});
window.addEventListener("pagehide", () => {
  stopScanner(false);
});

tickClock();
setInterval(tickClock, 1000);
syncSettingsUI();
updateFullscreenButton();
initParticleField();
initializeVision().catch(() => {});
