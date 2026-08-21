const { app, Tray, Menu, BrowserWindow, Notification, ipcMain, shell, nativeImage } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const { loadConfig, saveConfig, loadRunState, saveRunState } = require("./store");
const { checkAll, rerunRun } = require("./watcher");

let tray = null;
let settingsWindow = null;
let pollTimer = null;
let resumeTimer = null;
let isRunning = false;
let rateLimitedUntil = null;
let lastSummaries = [];
let lastUpdateStatus = { state: "idle" };
let updateReady = false;

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

const ICONS = {
  idle: path.join(__dirname, "assets", "tray-idle.png"),
  running: path.join(__dirname, "assets", "tray-running.png"),
  error: path.join(__dirname, "assets", "tray-error.png"),
};

function trayIcon(name) {
  return nativeImage.createFromPath(ICONS[name]).resize({ width: 16, height: 16 });
}

function notifyRunResult(repoKey, run) {
  const ok = run.conclusion === "success";
  const n = new Notification({
    title: ok ? `✅ ${repoKey} passou` : `❌ ${repoKey} falhou`,
    body: `${run.name} — ${run.head_branch} (#${run.run_number})`,
    silent: false,
  });
  n.on("click", () => shell.openExternal(run.html_url));
  n.show();
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

    for (const { repoKey, run } of result.events) {
      const repoCfg = config.repos.find((r) => `${r.owner}/${r.repo}` === repoKey);
      if (!repoCfg || !repoCfg.muted) {
        notifyRunResult(repoKey, run);
      }
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

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (resumeTimer) clearTimeout(resumeTimer);

  tray.setImage(trayIcon("error"));
  tray.setToolTip(`gh-actions-watcher — limite da API do GitHub atingido, retomando às ${formatClock(resetAt)}`);

  const delay = Math.max(1000, resumeAt - Date.now());
  resumeTimer = setTimeout(() => {
    resumeTimer = null;
    rateLimitedUntil = null;
    if (!isRunning) return;
    const config = loadConfig();
    pollOnce();
    pollTimer = setInterval(pollOnce, config.pollIntervalMs || 30000);
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
  if (pollTimer) clearInterval(pollTimer);
  if (resumeTimer) clearTimeout(resumeTimer);
  resumeTimer = null;
  rateLimitedUntil = null;
  isRunning = true;
  pollOnce();
  pollTimer = setInterval(pollOnce, config.pollIntervalMs || 30000);
  updateTrayMenu();
  pushStatus();
}

function stopWatching() {
  if (pollTimer) clearInterval(pollTimer);
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
    settingsWindow.focus();
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

  ipcMain.handle("watcher:rerun-run", async (_event, { owner, repo, runId }) => {
    const config = loadConfig();
    return rerunRun({ owner, repo, runId }, config.token);
  });

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
});

app.on("window-all-closed", (e) => {
  // é um app de bandeja: não sai quando fecha a janela de configurações
  e.preventDefault();
});
