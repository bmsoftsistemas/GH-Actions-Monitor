const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { checkAll, rerunRun } = require("../watcher");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function fakeResponse({ ok = true, status = 200, headers = {}, body = { workflow_runs: [] } } = {}) {
  return {
    ok,
    status,
    headers: { get: (key) => headers[key] ?? null },
    json: async () => body,
  };
}

function run(overrides = {}) {
  return {
    id: 1,
    name: "CI",
    status: "completed",
    conclusion: "success",
    head_branch: "main",
    run_number: 1,
    html_url: "https://github.com/a/b/actions/runs/1",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("primeira checagem grava baseline sem disparar notificação", async () => {
  global.fetch = async () => fakeResponse({ body: { workflow_runs: [run()] } });

  const repos = [{ owner: "a", repo: "b", workflowFiles: [] }];
  const { state, events } = await checkAll(repos, "token", {});

  assert.equal(events.length, 0);
  assert.equal(state["__init:a/b"], true);
  assert.deepEqual(state["a/b:1"], { status: "completed", conclusion: "success" });
});

test("notifica quando um run em andamento termina, na segunda checagem em diante", async () => {
  global.fetch = async () => fakeResponse({ body: { workflow_runs: [run({ conclusion: "success" })] } });

  const initialState = {
    "__init:a/b": true,
    "a/b:1": { status: "in_progress", conclusion: null },
  };
  const { events, state } = await checkAll([{ owner: "a", repo: "b", workflowFiles: [] }], "token", initialState);

  assert.equal(events.length, 1);
  assert.equal(events[0].repoKey, "a/b");
  assert.equal(events[0].run.conclusion, "success");
  assert.deepEqual(state["a/b:1"], { status: "completed", conclusion: "success" });
});

test("não notifica de novo a mesma conclusão já vista", async () => {
  global.fetch = async () => fakeResponse({ body: { workflow_runs: [run({ conclusion: "success" })] } });

  const initialState = {
    "__init:a/b": true,
    "a/b:1": { status: "completed", conclusion: "success" },
  };
  const { events } = await checkAll([{ owner: "a", repo: "b", workflowFiles: [] }], "token", initialState);

  assert.equal(events.length, 0);
});

test("rate limit em qualquer workflow aborta o repositório e é reportado", async () => {
  global.fetch = async () =>
    fakeResponse({
      ok: false,
      status: 403,
      headers: { "x-ratelimit-limit": "60", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" },
    });

  const { errors, events, summaries } = await checkAll([{ owner: "a", repo: "b", workflowFiles: [] }], "token", {});

  assert.equal(events.length, 0);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].rateLimited, true);
  assert.ok(summaries[0].error);
});

test("mescla resultados quando 1 de 2 workflows falha (não rate limit)", async () => {
  global.fetch = async (url) => {
    if (url.includes("ci.yml")) return fakeResponse({ body: { workflow_runs: [run({ id: 1 })] } });
    return fakeResponse({ ok: false, status: 500 });
  };

  const repos = [{ owner: "a", repo: "b", workflowFiles: ["ci.yml", "deploy.yml"] }];
  const { errors, summaries } = await checkAll(repos, "token", {});

  assert.equal(errors.length, 0);
  assert.equal(summaries[0].repoKey, "a/b");
  assert.equal(summaries[0].name, "CI");
});

test("rerunRun retorna ok quando a API responde com sucesso", async () => {
  let calledUrl, calledOpts;
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledOpts = opts;
    return fakeResponse({ status: 201, body: {} });
  };

  const result = await rerunRun({ owner: "a", repo: "b", runId: 42 }, "token");

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(calledUrl, "https://api.github.com/repos/a/b/actions/runs/42/rerun");
  assert.equal(calledOpts.method, "POST");
});

test("rerunRun retorna erro com a mensagem da API quando falha", async () => {
  global.fetch = async () =>
    fakeResponse({ ok: false, status: 403, body: { message: "Sem permissão de escrita" } });

  const result = await rerunRun({ owner: "a", repo: "b", runId: 42 }, "token");

  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.error, "Sem permissão de escrita");
});

test("propaga erro somente se todos os workflows falharem", async () => {
  global.fetch = async () => fakeResponse({ ok: false, status: 500 });

  const repos = [{ owner: "a", repo: "b", workflowFiles: ["ci.yml", "deploy.yml"] }];
  const { errors } = await checkAll(repos, "token", {});

  assert.equal(errors.length, 1);
  assert.equal(errors[0].repoKey, "a/b");
  assert.equal(errors[0].rateLimited, false);
});
