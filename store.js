const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");
const STATE_PATH = path.join(app.getPath("userData"), "run-state.json");

const NOTIFY_MODES = ["all", "failure-only", "failure-and-fixed"];

const DEFAULT_CONFIG = {
  token: "",
  pollIntervalMs: 30000,
  startOnLogin: false,
  soundEnabled: true,
  repos: [], // [{ owner, repo, workflowFiles: string[], muted, notifyMode, mutedBranches }]
};

// Aceita repos salvos por versões antigas do app (campo `workflowFile`
// singular, sem `muted`/`notifyMode`/`mutedBranches`) e devolve sempre o
// formato atual.
function normalizeRepo(repo) {
  const workflowFiles = Array.isArray(repo.workflowFiles)
    ? repo.workflowFiles
    : repo.workflowFile
    ? [repo.workflowFile]
    : [];
  return {
    owner: repo.owner,
    repo: repo.repo,
    workflowFiles,
    muted: !!repo.muted,
    notifyMode: NOTIFY_MODES.includes(repo.notifyMode) ? repo.notifyMode : "all",
    mutedBranches: Array.isArray(repo.mutedBranches) ? repo.mutedBranches : [],
    group: typeof repo.group === "string" ? repo.group.trim() : "",
  };
}

/**
 * O token nunca é gravado em texto puro no disco quando o SO oferece um
 * backend de criptografia (DPAPI no Windows, Keychain no macOS, libsecret
 * no Linux). Ele é decifrado apenas em memória, ao carregar a config.
 */
function decryptToken(raw) {
  if (raw.tokenEncrypted) {
    try {
      return safeStorage.decryptString(Buffer.from(raw.tokenEncrypted, "base64"));
    } catch {
      // Chave do SO mudou (ex: perfil recriado) — token não recuperável,
      // usuário precisa colar novamente em Configurações.
      return "";
    }
  }
  // Compatibilidade com config.json de versões antigas (texto puro) ou com
  // SOs sem backend de criptografia disponível.
  return raw.token || raw.tokenPlain || "";
}

function encryptToken(token) {
  if (!token) return {};
  if (safeStorage.isEncryptionAvailable()) {
    return { tokenEncrypted: safeStorage.encryptString(token).toString("base64") };
  }
  return { tokenPlain: token };
}

function loadConfig() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { ...DEFAULT_CONFIG };
  }

  const token = decryptToken(raw);
  const { token: _legacyToken, tokenEncrypted: _te, tokenPlain: _tp, ...rest } = raw;
  const config = { ...DEFAULT_CONFIG, ...rest, token };
  config.repos = (config.repos || []).map(normalizeRepo);

  // Migra automaticamente um token salvo em texto puro (config.json de uma
  // versão anterior do app) para o armazenamento criptografado do SO.
  if (raw.token && safeStorage.isEncryptionAvailable()) {
    saveConfig(config);
  }

  return config;
}

function saveConfig(config) {
  const { token, ...rest } = config;
  const toPersist = { ...rest, ...encryptToken(token) };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toPersist, null, 2));
}

function loadRunState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveRunState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

module.exports = { loadConfig, saveConfig, loadRunState, saveRunState, CONFIG_PATH };
