const { app, Tray, Menu, BrowserWindow, Notification, ipcMain, shell, nativeImage, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { loadConfig, saveConfig, loadRunState, saveRunState } = require("./store");
const {
  checkAll,
  rerunRun,
  cancelRun,
  fetchJobs,
  fetchJobLog,
  dispatchWorkflow,
  checkTokenValidity,
} = require("./watcher");

let tray = null;
let settingsWindow = null;
let audioWindow = null;
let pollTimer = null;
let resumeTimer = null;
let isRunning = false;
let rateLimitedUntil = null;
let lastSummaries = [];
let lastRateLimit = null;
let lastUpdateStatus = { state: "idle" };
let updateReady = false;
let dndUntil = null;
let lastEffectiveIntervalMs = null;

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

const ICONS = {
  idle: path.join(__dirname, "assets", "tray-idle.png"),
  running: path.join(__dirname, "assets", "tray-running.png"),
  error: path.join(__dirname, "assets", "tray-error.png"),
};

function trayIcon(name) {
  return nativeImage.createFromPath(ICONS[name]).resize({ width: 16, height: 16 });
}

function notifyRunResult(repoKey, run, isFixed) {
  const ok = run.conclusion === "success";
  const title = isFixed ? `✅ ${repoKey} voltou a passar` : ok ? `✅ ${repoKey} passou` : `❌ ${repoKey} falhou`;
  const n = new Notification({
    title,
    body: `${run.name} — ${run.head_branch} (#${run.run_number})`,
    silent: false,
  });
  n.on("click", () => shell.openExternal(run.html_url));
  n.show();
}

/**
 * Decide se um evento de run concluída deve virar notificação, combinando
 * mute total, branches silenciadas e a granularidade escolhida (all /
 * failure-only / failure-and-fixed).
 */
function shouldNotify(repoCfg, run, isFixed) {
  if (!repoCfg || repoCfg.muted) return false;
  if (repoCfg.mutedBranches && repoCfg.mutedBranches.includes(run.head_branch)) return false;

  const isFailure = run.conclusion === "failure";
  switch (repoCfg.notifyMode) {
    case "failure-only":
      return isFailure;
    case "failure-and-fixed":
      return isFailure || isFixed;
    default:
      return true;
  }
}

function isDndActive() {
  return dndUntil !== null && Date.now() < dndUntil;
}

/**
 * Toca um bipe curto sintetizado via Web Audio numa janela oculta dedicada
 * (não tem API de áudio no processo principal, e a janela de configurações
 * pode estar fechada quando o evento acontece).
 */
function playSound(kind) {
  const config = loadConfig();
  if (!config.soundEnabled) return;
  if (audioWindow) audioWindow.webContents.send("audio:play", kind);
}

async function pollOnce() {
  const config = loadConfig();

  if (!config.token || config.repos.length === 0) {
    return;
  }

  if (rateLimitedUntil && Date.now() < rateLimitedUntil) {
    return; // pausado esperando o reset do rate limit (ver pauseForRateLimit)
  }

  let state = loadRunState();
  try {
    const result = await checkAll(config.repos, config.token, state);
    state = result.state;
    saveRunState(state);
    lastSummaries = result.summaries;
    pushSummaries();
    if (result.rateLimit) {
      lastRateLimit = result.rateLimit;
      pushRateLimit();
    }

    for (const { repoKey, run, isFixed } of result.events) {
      const repoCfg = config.repos.find((r) => `${r.owner}/${r.repo}` === repoKey);
      if (!shouldNotify(repoCfg, run, isFixed) || isDndActive()) continue;
      notifyRunResult(repoKey, run, isFixed);
      playSound(run.conclusion === "success" ? "success" : "failure");
    }

    const rateLimitHit =
      result.errors.some((e) => e.rateLimited) || (result.rateLimit && result.rateLimit.remaining === 0);

    if (rateLimitHit && result.rateLimit && result.rateLimit.resetAt) {
      pauseForRateLimit(result.rateLimit.resetAt);
    } else if (result.errors.length > 0) {
      tray.setImage(trayIcon("error"));
      tray.setToolTip(
        "gh-actions-watcher — erro ao consultar:\n" +
          result.errors.map((e) => `${e.repoKey}: ${e.message}`).join("\n")
      );
    } else {
      tray.setImage(trayIcon("running"));
      tray.setToolTip(`gh-actions-watcher — monitorando ${config.repos.length} repositório(s)` + rateLimitWarning(result.rateLimit));
    }
  } catch (err) {
    tray.setImage(trayIcon("error"));
    tray.setToolTip(`gh-actions-watcher — erro: ${err.message}`);
  }
}

/**
 * Smart polling: enquanto algo estiver rodando/na fila, cheque mais rápido
 * (até 10s) pra pegar a conclusão logo; sem nada rodando e fora do horário
 * comercial (fim de semana ou madrugada, antes das 7h), relaxa pra pelo
 * menos 2 minutos — economiza cota da API quando ninguém tá olhando.
 */
function isOffHours() {
  const now = new Date();
  const day = now.getDay(); // 0 = domingo, 6 = sábado
  return day === 0 || day === 6 || now.getHours() < 7;
}

function computeNextIntervalMs() {
  const config = loadConfig();
  const base = config.pollIntervalMs || 30000;
  const hasRunning = lastSummaries.some(
    (s) => s && !s.error && !s.empty && s.status && s.status !== "completed"
  );
  if (hasRunning) return Math.min(base, 10000);
  if (isOffHours()) return Math.max(base, 120000);
  return base;
}

function pushNextInterval() {
  if (settingsWindow) {
    settingsWindow.webContents.send("watcher:next-interval", lastEffectiveIntervalMs);
  }
}

function scheduleNextPoll() {
  const intervalMs = computeNextIntervalMs();
  lastEffectiveIntervalMs = intervalMs;
  pushNextInterval();
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(runPollCycle, intervalMs);
}

async function runPollCycle() {
  await pollOnce();
  if (isRunning && !(rateLimitedUntil && Date.now() < rateLimitedUntil)) {
    scheduleNextPoll();
  }
}

function rateLimitWarning(rateLimit) {
  if (!rateLimit || !rateLimit.limit) return "";
  if (rateLimit.remaining > rateLimit.limit * 0.15) return "";
  return `\n⚠ perto do limite da API do GitHub (${rateLimit.remaining}/${rateLimit.limit} restantes)`;
}

/**
 * Em vez de continuar batendo na API do GitHub a cada intervalo (e piorar
 * uma penalidade de rate limit), pausa o polling e agenda uma retomada
 * automática exatamente no horário em que a cota é renovada.
 */
function pauseForRateLimit(resetAt) {
  const resumeAt = new Date(resetAt).getTime() + 5000; // pequena folga
  rateLimitedUntil = resumeAt;

  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (resumeTimer) clearTimeout(resumeTimer);

  tray.setImage(trayIcon("error"));
  tray.setToolTip(`gh-actions-watcher — limite da API do GitHub atingido, retomando às ${formatClock(resetAt)}`);

  const delay = Math.max(1000, resumeAt - Date.now());
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    rateLimitedUntil = null;
    if (!isRunning) return;
    runPollCycle();
  }, delay);
}

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function pushSummaries() {
  if (settingsWindow) {
    settingsWindow.webContents.send("watcher:summaries", lastSummaries);
  }
}

function pushRateLimit() {
  if (settingsWindow) {
    settingsWindow.webContents.send("watcher:rate-limit", lastRateLimit);
  }
}

function pushDndStatus() {
  if (settingsWindow) {
    settingsWindow.webContents.send("dnd:status", dndUntil);
  }
}

function tomorrowMorning() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

function createAudioWindow() {
  audioWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "audio-preload.js"),
      contextIsolation: true,
    },
  });
  audioWindow.loadFile(path.join(__dirname, "audio.html"));
}

function pushStatus() {
  if (settingsWindow) {
    settingsWindow.webContents.send("watcher:status-changed", { isRunning });
  }
}

/**
 * Auto-update via electron-updater. Só funciona no app empacotado (com um
 * provider de publish configurado no package.json) — em modo dev
 * (`npm start` rodando a partir do código-fonte) fica inerte de propósito,
 * já que não há instalador nem update.yml para checar.
 */
function pushUpdateStatus(status) {
  lastUpdateStatus = status;
  if (settingsWindow) {
    settingsWindow.webContents.send("update:status", status);
  }
}

/**
 * Instala a atualização baixada. Roda o instalador em modo silencioso
 * (sem a tela genérica do NSIS) e força o app a reabrir sozinho depois —
 * se a janela de configurações estiver aberta, mostra antes um overlay no
 * próprio tema do app por um instante, pra não trocar direto pro instalador.
 */
function installUpdate() {
  if (!updateReady) return;
  if (settingsWindow) {
    settingsWindow.webContents.send("update:installing");
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 600);
  } else {
    autoUpdater.quitAndInstall(true, true);
  }
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => pushUpdateStatus({ state: "checking" }));

  autoUpdater.on("update-available", (info) => pushUpdateStatus({ state: "available", version: info.version }));

  autoUpdater.on("update-not-available", () => pushUpdateStatus({ state: "not-available" }));

  autoUpdater.on("update-downloaded", (info) => {
    updateReady = true;
    pushUpdateStatus({ state: "downloaded", version: info.version });
    updateTrayMenu();
    const n = new Notification({
      title: "Atualização pronta",
      body: `Versão ${info.version} baixada. Reinicie para aplicar.`,
      silent: false,
    });
    n.on("click", () => installUpdate());
    n.show();
  });

  autoUpdater.on("error", (err) => pushUpdateStatus({ state: "error", message: err.message }));

  const checkNow = () => autoUpdater.checkForUpdates().catch((err) => pushUpdateStatus({ state: "error", message: err.message }));

  checkNow();
  setInterval(checkNow, UPDATE_CHECK_INTERVAL_MS);
}

function startWatching() {
  const config = loadConfig();
  if (!config.token || config.repos.length === 0) {
    openSettingsWindow();
    return;
  }
  if (pollTimer) clearTimeout(pollTimer);
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
  rateLimitedUntil = null;
  isRunning = true;
  runPollCycle();
  updateTrayMenu();
  pushStatus();
}

function stopWatching() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
  rateLimitedUntil = null;
  isRunning = false;
  tray.setImage(trayIcon("idle"));
  tray.setToolTip("gh-actions-watcher — parado");
  updateTrayMenu();
  pushStatus();
}

function openSettingsWindow() {
  if (settingsWindow) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    // Bug conhecido do Chromium no Windows: depois de minimizar/restaurar
    // (ou trocar de app e voltar), o teclado às vezes não é roteado pro
    // conteúdo web até um clique do mouse. Focar o webContents explicitamente
    // evita isso.
    settingsWindow.webContents.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 820,
    height: 620,
    minWidth: 640,
    minHeight: 440,
    resizable: true,
    title: "GH Actions Watcher",
    backgroundColor: "#16171b",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  settingsWindow.on("restore", () => settingsWindow.webContents.focus());
  settingsWindow.on("focus", () => settingsWindow.webContents.focus());
}

function updateTrayMenu() {
  const config = loadConfig();
  const template = [
    {
      label: isRunning ? "⏸ Parar monitoramento" : "▶ Iniciar monitoramento",
      click: () => (isRunning ? stopWatching() : startWatching()),
    },
    { type: "separator" },
    { label: `${config.repos.length} repositório(s) configurado(s)`, enabled: false },
    { label: "⚙ Configurações...", click: openSettingsWindow },
  ];

  if (updateReady) {
    template.push({ type: "separator" }, { label: "🔄 Reiniciar para atualizar", click: () => installUpdate() });
  }

  template.push({ type: "separator" }, { label: "Sair", click: () => app.quit() });

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.dock && app.dock.hide && app.dock.hide(); // no macOS, esconde do dock (é um app de bandeja)

  tray = new Tray(trayIcon("idle"));
  tray.setToolTip("gh-actions-watcher — parado");
  updateTrayMenu();

  const config = loadConfig();
  openSettingsWindow();
  createAudioWindow();
  if (config.token && config.repos.length > 0) {
    startWatching();
  }

  setupAutoUpdater();

  // IPC vindo da janela de configurações
  ipcMain.handle("config:get", () => loadConfig());

  ipcMain.handle("config:save", (_event, newConfig) => {
    saveConfig(newConfig);
    app.setLoginItemSettings({ openAtLogin: !!newConfig.startOnLogin });
    if (isRunning) {
      startWatching(); // reinicia com o novo intervalo/lista
    }
    updateTrayMenu();
    return true;
  });

  ipcMain.handle("watcher:status", () => ({ isRunning }));

  ipcMain.handle("watcher:toggle", () => {
    isRunning ? stopWatching() : startWatching();
    return { isRunning };
  });

  ipcMain.handle("watcher:get-summaries", () => lastSummaries);

  ipcMain.handle("app:open-external", (_event, url) => shell.openExternal(url));

  ipcMain.handle("update:get-status", () => lastUpdateStatus);

  ipcMain.handle("update:install", () => installUpdate());

  ipcMain.handle("app:get-version", () => app.getVersion());

  ipcMain.handle("dnd:get", () => dndUntil);

  ipcMain.handle("dnd:set", (_event, duration) => {
    dndUntil = duration === "tomorrow" ? tomorrowMorning() : Date.now() + duration;
    pushDndStatus();
    return dndUntil;
  });

  ipcMain.handle("dnd:clear", () => {
    dndUntil = null;
    pushDndStatus();
  });

  ipcMain.handle("watcher:rerun-run", async (_event, { owner, repo, runId }) => {
    const config = loadConfig();
    return rerunRun({ owner, repo, runId }, config.token);
  });

  ipcMain.handle("watcher:cancel-run", async (_event, { owner, repo, runId }) => {
    const config = loadConfig();
    return cancelRun({ owner, repo, runId }, config.token);
  });

  ipcMain.handle("watcher:get-jobs", async (_event, { owner, repo, runId }) => {
    const config = loadConfig();
    return fetchJobs({ owner, repo, runId }, config.token);
  });

  ipcMain.handle("watcher:get-job-log", async (_event, { owner, repo, jobId, stepName }) => {
    const config = loadConfig();
    return fetchJobLog({ owner, repo, jobId, stepName }, config.token);
  });

  ipcMain.handle("watcher:dispatch-workflow", async (_event, { owner, repo, workflowFile, ref, inputs }) => {
    const config = loadConfig();
    return dispatchWorkflow({ owner, repo, workflowFile, ref, inputs }, config.token);
  });

  ipcMain.handle("watcher:get-rate-limit", () => lastRateLimit);

  ipcMain.handle("watcher:test-token", async (_event, { token, owner, repo }) => {
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  });

  ipcMain.handle("watcher:test-token-validity", async (_event, { token }) => {
    try {
      return await checkTokenValidity(token);
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  });

  ipcMain.handle("watcher:get-next-interval", () => lastEffectiveIntervalMs);

  ipcMain.handle("config:export", async () => {
    const config = loadConfig();
    const { canceled, filePath } = await dialog.showSaveDialog(settingsWindow, {
      title: "Exportar configuração",
      defaultPath: "gh-actions-watcher-config.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };

    const exportData = {
      pollIntervalMs: config.pollIntervalMs,
      repos: config.repos.map(({ owner, repo, workflowFiles, muted, notifyMode, mutedBranches, group }) => ({
        owner,
        repo,
        workflowFiles,
        muted,
        notifyMode,
        mutedBranches,
        group,
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    return { ok: true, filePath };
  });

  ipcMain.handle("config:import", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(settingsWindow, {
      title: "Importar configuração",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return { ok: false, canceled: true };

    let data;
    try {
      data = JSON.parse(fs.readFileSync(filePaths[0], "utf8"));
    } catch (err) {
      return { ok: false, error: `Arquivo inválido: ${err.message}` };
    }
    if (!Array.isArray(data.repos)) {
      return { ok: false, error: 'O JSON precisa ter uma lista "repos".' };
    }

    const config = loadConfig();
    const existingKeys = new Set(config.repos.map((r) => `${r.owner}/${r.repo}`));
    let added = 0;
    for (const r of data.repos) {
      if (!r.owner || !r.repo) continue;
      const key = `${r.owner}/${r.repo}`;
      if (existingKeys.has(key)) continue;
      config.repos.push({
        owner: r.owner,
        repo: r.repo,
        workflowFiles: Array.isArray(r.workflowFiles) ? r.workflowFiles : [],
        muted: !!r.muted,
        notifyMode: ["all", "failure-only", "failure-and-fixed"].includes(r.notifyMode) ? r.notifyMode : "all",
        mutedBranches: Array.isArray(r.mutedBranches) ? r.mutedBranches : [],
        group: typeof r.group === "string" ? r.group : "",
      });
      existingKeys.add(key);
      added++;
    }
    saveConfig(config);
    return { ok: true, added, skipped: data.repos.length - added, config };
  });
});

app.on("window-all-closed", (e) => {
  // é um app de bandeja: não sai quando fecha a janela de configurações
  e.preventDefault();
});
