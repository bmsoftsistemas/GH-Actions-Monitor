const tokenInput = document.getElementById("token");
const intervalInput = document.getElementById("interval");
const pollSubtitle = document.getElementById("poll-subtitle");
const startOnLoginInput = document.getElementById("start-on-login");
const reposList = document.getElementById("repos-list");
const repoRowTemplate = document.getElementById("repo-row-template");
const workflowChipTemplate = document.getElementById("workflow-chip-template");
const repoCardTemplate = document.getElementById("repo-card-template");
const historyRowTemplate = document.getElementById("history-row-template");
const addRepoBtn = document.getElementById("add-repo-btn");
const saveBtn = document.getElementById("save-btn");
const saveFeedback = document.getElementById("save-feedback");
const toggleBtn = document.getElementById("toggle-btn");
const statusDot = document.getElementById("status-dot");
const statusLabel = document.getElementById("status-label");
const brandDot = document.getElementById("brand-dot");
const toggleTokenVisibility = document.getElementById("toggle-token-visibility");
const repoCards = document.getElementById("repo-cards");
const emptyState = document.getElementById("empty-state");
const themeToggleBtn = document.getElementById("theme-toggle-btn");
const updateBanner = document.getElementById("update-banner");
const updateBannerText = document.getElementById("update-banner-text");
const updateBannerBtn = document.getElementById("update-banner-btn");
const updateStatusEl = document.getElementById("update-status");
const appVersionEl = document.getElementById("app-version");
const updateOverlay = document.getElementById("update-overlay");

const ICON_ATTRS = 'class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  sun: `<svg ${ICON_ATTRS}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg ${ICON_ATTRS}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>`,
  bell: `<svg ${ICON_ATTRS}><path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>`,
  bellOff: `<svg ${ICON_ATTRS}><path d="M13.73 21a2 2 0 01-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0118 8"/><path d="M6.26 6.26A5.86 5.86 0 006 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 00-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
};

// Ícones de status no estilo GitHub Actions (check-circle / x-circle / spinner).
const STATUS_ICONS = {
  success: `<svg class="icon status-icon" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L6.75 9.19 5.28 7.72a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l4.5-4.5Z"/></svg>`,
  failure: `<svg class="icon status-icon" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M2.343 13.657A8 8 0 1 1 13.657 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.751.751 0 0 0-1.042.018.751.751 0 0 0-.018 1.042L6.94 8l-1.97 1.97a.749.749 0 0 0 .326 1.275.749.749 0 0 0 .734-.215L8 9.06l1.97 1.97a.749.749 0 0 0 1.275-.326.749.749 0 0 0-.215-.734L9.06 8l1.97-1.97a.749.749 0 0 0-.326-1.275.749.749 0 0 0-.734.215L8 6.94Z"/></svg>`,
  progress: `<svg class="icon status-icon status-icon-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="8" cy="8" r="6" stroke-dasharray="22 100"/></svg>`,
  unknown: `<svg class="icon status-icon" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5"/></svg>`,
};

let currentRepos = [];
let currentSummaries = [];
let currentFilter = "all";
const expandedRepos = new Set();

// Falhas primeiro, depois o que está rodando, depois desconhecido/aguardando,
// sucesso por último (é o que menos precisa de atenção).
const STATUS_PRIORITY = { failure: 0, progress: 1, unknown: 2, success: 3 };

/* ---------- Navegação entre views ---------- */

function switchView(viewName) {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("active", el.id === `view-${viewName}`);
  });
  document.querySelectorAll(".nav-item[data-view]").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === viewName);
  });
}

document.querySelectorAll("[data-view]").forEach((el) => {
  el.addEventListener("click", () => switchView(el.dataset.view));
});

/* ---------- Filtro do dashboard ---------- */

document.querySelectorAll(".filter-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentFilter = btn.dataset.filter;
    document.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderDashboard();
  });
});

/* ---------- Tema claro/escuro ---------- */

function applyThemeButton(theme) {
  themeToggleBtn.innerHTML = theme === "light" ? ICONS.moon : ICONS.sun;
  themeToggleBtn.title = theme === "light" ? "Mudar para tema escuro" : "Mudar para tema claro";
}

// O tema em si já foi aplicado por um script inline no <head> (evita flash);
// aqui só sincronizamos o ícone do botão com o que já está ativo.
applyThemeButton(document.documentElement.getAttribute("data-theme") || "dark");

themeToggleBtn.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("theme", next);
  } catch (e) {
    // localStorage indisponível (raro) — o tema so nao persiste entre sessões.
  }
  applyThemeButton(next);
});

/* ---------- Atualizações automáticas ---------- */

function renderUpdateStatus(status) {
  if (!status) return;

  switch (status.state) {
    case "checking":
      updateStatusEl.hidden = false;
      updateStatusEl.textContent = "Verificando atualizações…";
      updateBanner.classList.remove("visible");
      break;
    case "available":
      updateStatusEl.hidden = false;
      updateStatusEl.textContent = `Baixando atualização ${status.version || ""}…`;
      updateBanner.classList.remove("visible");
      break;
    case "not-available":
      updateStatusEl.hidden = true;
      updateBanner.classList.remove("visible");
      break;
    case "downloaded":
      updateStatusEl.hidden = true;
      updateBannerText.textContent = `Nova versão ${status.version || ""} pronta — reinicie para atualizar.`;
      updateBanner.classList.add("visible");
      break;
    case "error":
      updateStatusEl.hidden = false;
      updateStatusEl.textContent = "Falha ao verificar atualização.";
      updateBanner.classList.remove("visible");
      break;
    default:
      updateStatusEl.hidden = true;
      updateBanner.classList.remove("visible");
  }
}

updateBannerBtn.addEventListener("click", () => window.api.installUpdate());

/* ---------- Formulário de configurações ---------- */

function addRepoRow(repo = { owner: "", repo: "", workflowFiles: [], muted: false }) {
  const node = repoRowTemplate.content.cloneNode(true);
  const row = node.querySelector(".repo-row");
  row.querySelector(".repo-owner").value = repo.owner || "";
  row.querySelector(".repo-name").value = repo.repo || "";

  let workflowFiles = Array.isArray(repo.workflowFiles) ? [...repo.workflowFiles] : [];
  let muted = !!repo.muted;

  const chipsEl = row.querySelector(".workflow-chips");
  const workflowInput = row.querySelector(".workflow-input");
  const muteBtn = row.querySelector(".mute-repo-btn");

  function renderChips() {
    chipsEl.innerHTML = "";
    for (const wf of workflowFiles) {
      const chipNode = workflowChipTemplate.content.cloneNode(true);
      chipNode.querySelector(".workflow-chip-label").textContent = wf;
      chipNode.querySelector(".workflow-chip-remove").addEventListener("click", () => {
        workflowFiles = workflowFiles.filter((existing) => existing !== wf);
        renderChips();
      });
      chipsEl.appendChild(chipNode);
    }
  }
  renderChips();

  workflowInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const value = workflowInput.value.trim();
    if (value && !workflowFiles.includes(value)) {
      workflowFiles.push(value);
      renderChips();
    }
    workflowInput.value = "";
  });

  function applyMuteVisual() {
    muteBtn.innerHTML = muted ? ICONS.bellOff : ICONS.bell;
    muteBtn.classList.toggle("muted", muted);
    muteBtn.title = muted ? "Notificações silenciadas — clique para reativar" : "Silenciar notificações";
  }
  applyMuteVisual();

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    applyMuteVisual();
  });

  row.querySelector(".remove-repo-btn").addEventListener("click", () => row.remove());

  row.querySelector(".test-repo-btn").addEventListener("click", async () => {
    const owner = row.querySelector(".repo-owner").value.trim();
    const repoName = row.querySelector(".repo-name").value.trim();
    const token = tokenInput.value.trim();
    if (!owner || !repoName || !token) {
      alert("Preencha token, owner e repositório antes de testar.");
      return;
    }
    const result = await window.api.testToken({ token, owner, repo: repoName });
    alert(result.ok ? "✅ Acesso OK!" : `❌ Falhou (status ${result.status})`);
  });

  // Lidos por collectRepos() na hora de salvar.
  row._getWorkflowFiles = () => workflowFiles;
  row._getMuted = () => muted;

  reposList.appendChild(node);
}

function collectRepos() {
  return Array.from(reposList.querySelectorAll(".repo-row"))
    .map((row) => ({
      owner: row.querySelector(".repo-owner").value.trim(),
      repo: row.querySelector(".repo-name").value.trim(),
      workflowFiles: row._getWorkflowFiles ? row._getWorkflowFiles() : [],
      muted: row._getMuted ? row._getMuted() : false,
    }))
    .filter((r) => r.owner && r.repo);
}

async function refreshStatus() {
  const { isRunning } = await window.api.getStatus();
  applyStatus(isRunning);
}

let isWatcherRunning = false;
let currentPollIntervalMs = 30000;
let secondsUntilNextCheck = null;

function renderPollSubtitle() {
  if (!isWatcherRunning || secondsUntilNextCheck === null) {
    pollSubtitle.textContent = "Monitoramento parado";
  } else if (secondsUntilNextCheck <= 0) {
    pollSubtitle.textContent = "Verificando…";
  } else {
    pollSubtitle.textContent = `Próxima verificação em ${secondsUntilNextCheck}s`;
  }
}

function resetPollCountdown() {
  secondsUntilNextCheck = Math.round(currentPollIntervalMs / 1000);
  renderPollSubtitle();
}

setInterval(() => {
  if (!isWatcherRunning || secondsUntilNextCheck === null || secondsUntilNextCheck <= 0) return;
  secondsUntilNextCheck -= 1;
  renderPollSubtitle();
}, 1000);

function applyStatus(isRunning) {
  statusDot.className = "dot " + (isRunning ? "running" : "idle");
  statusLabel.textContent = isRunning ? "Rodando" : "Parado";
  toggleBtn.textContent = isRunning ? "Parar" : "Iniciar";
  brandDot.className = "brand-dot " + (isRunning ? "running" : "");
  isWatcherRunning = isRunning;
  if (isRunning) {
    resetPollCountdown();
  } else {
    secondsUntilNextCheck = null;
    renderPollSubtitle();
  }
}

addRepoBtn.addEventListener("click", () => addRepoRow());

toggleTokenVisibility.addEventListener("click", () => {
  tokenInput.type = tokenInput.type === "password" ? "text" : "password";
});

toggleBtn.addEventListener("click", async () => {
  const { isRunning } = await window.api.toggle();
  applyStatus(isRunning);
});

saveBtn.addEventListener("click", async () => {
  const config = {
    token: tokenInput.value.trim(),
    pollIntervalMs: Math.max(10, Number(intervalInput.value) || 30) * 1000,
    startOnLogin: startOnLoginInput.checked,
    repos: collectRepos(),
  };

  if (!config.token) {
    alert("Informe o GitHub Token.");
    return;
  }
  if (config.repos.length === 0) {
    alert("Adicione ao menos um repositório.");
    return;
  }

  await window.api.saveConfig(config);
  currentRepos = config.repos;
  currentPollIntervalMs = config.pollIntervalMs;
  saveFeedback.textContent = "Salvo ✓";
  setTimeout(() => (saveFeedback.textContent = ""), 2000);
  renderDashboard();
  await refreshStatus();
});

/* ---------- Dashboard de monitoramento ---------- */

function statusInfo(summary) {
  if (!summary) return { cls: "unknown", label: "Aguardando checagem" };
  if (summary.error) return { cls: "failure", label: "Erro ao consultar" };
  if (summary.empty) return { cls: "unknown", label: "Sem execuções" };
  if (summary.status !== "completed") {
    return { cls: "progress", label: summary.status === "queued" ? "Na fila" : "Em execução" };
  }
  if (summary.conclusion === "success") return { cls: "success", label: "Sucesso" };
  if (summary.conclusion === "failure") return { cls: "failure", label: "Falhou" };
  return { cls: "unknown", label: summary.conclusion || "Desconhecido" };
}

function formatRelativeTime(iso) {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "agora mesmo";
  if (mins < 60) return `há ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.round(hours / 24);
  return `há ${days}d`;
}

function historyRunLabel(run) {
  return `${run.name || "workflow"} · ${run.headBranch || ""} #${run.runNumber ?? ""}`;
}

async function handleRerunClick(button, { owner, repo, runId }) {
  button.disabled = true;
  try {
    const result = await window.api.rerunRun({ owner, repo, runId });
    if (!result.ok) {
      alert(`Falha ao re-executar (status ${result.status})${result.error ? `: ${result.error}` : ""}`);
    }
  } finally {
    button.disabled = false;
  }
}

async function handleCancelClick(button, { owner, repo, runId }) {
  button.disabled = true;
  try {
    const result = await window.api.cancelRun({ owner, repo, runId });
    if (!result.ok) {
      alert(`Falha ao cancelar (status ${result.status})${result.error ? `: ${result.error}` : ""}`);
    }
  } finally {
    button.disabled = false;
  }
}

function renderHistory(card, repo, recentRuns) {
  const historyEl = card.querySelector(".repo-card-history");
  historyEl.innerHTML = "";

  if (!recentRuns || recentRuns.length === 0) {
    const empty = document.createElement("div");
    empty.className = "history-row";
    empty.textContent = "Sem execuções recentes.";
    historyEl.appendChild(empty);
    return;
  }

  for (const run of recentRuns) {
    const node = historyRowTemplate.content.cloneNode(true);
    const row = node.querySelector(".history-row");
    const info = statusInfo({ status: run.status, conclusion: run.conclusion });
    const badge = row.querySelector(".history-badge");
    badge.classList.add(info.cls);
    badge.innerHTML = STATUS_ICONS[info.cls] || STATUS_ICONS.unknown;
    row.querySelector(".history-info").textContent = historyRunLabel(run);
    row.querySelector(".history-time").textContent = formatRelativeTime(run.updatedAt);

    const openBtn = row.querySelector(".history-open-btn");
    if (run.htmlUrl) {
      openBtn.hidden = false;
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.api.openExternal(run.htmlUrl);
      });
    }

    const cancelBtn = row.querySelector(".history-cancel-btn");
    if (info.cls === "progress" && run.id) {
      cancelBtn.hidden = false;
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCancelClick(cancelBtn, { owner: repo.owner, repo: repo.repo, runId: run.id });
      });
    }

    const rerunBtn = row.querySelector(".history-rerun-btn");
    if (info.cls === "failure" && run.id) {
      rerunBtn.hidden = false;
      rerunBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleRerunClick(rerunBtn, { owner: repo.owner, repo: repo.repo, runId: run.id });
      });
    }

    if (run.htmlUrl) {
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        window.api.openExternal(run.htmlUrl);
      });
    }
    historyEl.appendChild(node);
  }
}

function renderDashboard() {
  const summaryByRepo = new Map(currentSummaries.map((s) => [s.repoKey, s]));

  const rows = currentRepos.map((repo) => {
    const repoKey = `${repo.owner}/${repo.repo}`;
    const summary = summaryByRepo.get(repoKey);
    return { repo, repoKey, summary, info: statusInfo(summary) };
  });

  rows.sort((a, b) => STATUS_PRIORITY[a.info.cls] - STATUS_PRIORITY[b.info.cls] || a.repoKey.localeCompare(b.repoKey));

  const visibleRows = currentFilter === "all" ? rows : rows.filter((r) => r.info.cls === currentFilter);

  repoCards.innerHTML = "";
  emptyState.hidden = visibleRows.length > 0;
  const emptyText = emptyState.querySelector("p");
  const emptyLinkBtn = emptyState.querySelector(".link-btn");
  if (currentRepos.length === 0) {
    emptyText.textContent = "Nenhum repositório configurado ainda.";
    emptyLinkBtn.hidden = false;
  } else {
    emptyText.textContent = "Nenhum repositório corresponde a esse filtro.";
    emptyLinkBtn.hidden = true;
  }

  for (const { repo, repoKey, summary, info } of visibleRows) {
    const node = repoCardTemplate.content.cloneNode(true);
    const card = node.querySelector(".repo-card");
    const badge = card.querySelector(".repo-card-badge");
    badge.classList.add(info.cls);
    badge.innerHTML = STATUS_ICONS[info.cls] || STATUS_ICONS.unknown;
    card.querySelector(".repo-card-name").textContent = repoKey;
    card.querySelector(".repo-card-muted-icon").hidden = !repo.muted;

    const openBtn = card.querySelector(".repo-card-open-btn");
    if (summary && summary.htmlUrl) {
      openBtn.hidden = false;
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        window.api.openExternal(summary.htmlUrl);
      });
    }

    const cancelBtn = card.querySelector(".repo-card-cancel-btn");
    if (info.cls === "progress" && summary && summary.id) {
      cancelBtn.hidden = false;
      cancelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleCancelClick(cancelBtn, { owner: repo.owner, repo: repo.repo, runId: summary.id });
      });
    }

    const cardRerunBtn = card.querySelector(".repo-card-rerun-btn");
    if (info.cls === "failure" && summary && summary.id) {
      cardRerunBtn.hidden = false;
      cardRerunBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        handleRerunClick(cardRerunBtn, { owner: repo.owner, repo: repo.repo, runId: summary.id });
      });
    }

    const runEl = card.querySelector(".repo-card-run");
    if (summary && !summary.error && !summary.empty) {
      runEl.textContent = `${summary.name || "workflow"} · ${summary.headBranch || ""} #${summary.runNumber ?? ""}`;
    } else if (summary && summary.error) {
      runEl.textContent = summary.error;
    } else if (repo.workflowFiles && repo.workflowFiles.length > 0) {
      runEl.textContent = `workflows: ${repo.workflowFiles.join(", ")}`;
    } else {
      runEl.textContent = "—";
    }

    const metaEl = card.querySelector(".repo-card-meta");
    const pill = document.createElement("span");
    pill.className = `status-pill ${info.cls}`;
    pill.textContent = info.label;
    const time = document.createElement("span");
    time.textContent = summary && summary.updatedAt ? formatRelativeTime(summary.updatedAt) : "";
    metaEl.appendChild(pill);
    metaEl.appendChild(time);

    renderHistory(card, repo, summary && summary.recentRuns);
    card.classList.toggle("expanded", expandedRepos.has(repoKey));

    card.querySelector(".repo-card-expand").addEventListener("click", (e) => {
      e.stopPropagation();
      if (expandedRepos.has(repoKey)) {
        expandedRepos.delete(repoKey);
      } else {
        expandedRepos.add(repoKey);
      }
      card.classList.toggle("expanded", expandedRepos.has(repoKey));
    });

    if (summary && summary.htmlUrl) {
      card.addEventListener("click", () => window.api.openExternal(summary.htmlUrl));
    }

    repoCards.appendChild(node);
  }
}

/* ---------- Inicialização ---------- */

async function init() {
  const config = await window.api.getConfig();
  tokenInput.value = config.token || "";
  intervalInput.value = Math.round((config.pollIntervalMs || 30000) / 1000);
  currentPollIntervalMs = config.pollIntervalMs || 30000;
  startOnLoginInput.checked = !!config.startOnLogin;
  currentRepos = config.repos;

  reposList.innerHTML = "";
  if (config.repos.length === 0) {
    addRepoRow();
    switchView("settings");
  } else {
    config.repos.forEach(addRepoRow);
  }

  currentSummaries = await window.api.getSummaries();
  renderDashboard();

  await refreshStatus();

  window.api.onSummaries((summaries) => {
    currentSummaries = summaries;
    renderDashboard();
    if (isWatcherRunning) resetPollCountdown();
  });
  window.api.onStatusChanged(({ isRunning }) => applyStatus(isRunning));

  if (window.api.onUpdateStatus) {
    window.api.onUpdateStatus(renderUpdateStatus);
  }
  if (window.api.getUpdateStatus) {
    renderUpdateStatus(await window.api.getUpdateStatus());
  }
  if (window.api.onUpdateInstalling) {
    window.api.onUpdateInstalling(() => {
      updateOverlay.hidden = false;
    });
  }
  if (window.api.getVersion) {
    appVersionEl.textContent = `v${await window.api.getVersion()}`;
  }
}

init();
