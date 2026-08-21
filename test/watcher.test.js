const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { checkAll, rerunRun, cancelRun, fetchJobs, fetchJobLog, extractStepLog, dispatchWorkflow } = require("../watcher");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function fakeResponse({ ok = true, status = 200, headers = {}, body = { workflow_runs: [] }, text } = {}) {
  return {
    ok,
    status,
    headers: { get: (key) => headers[key] ?? null },
    json: async () => body,
    text: async () => (text !== undefined ? text : JSON.stringify(body)),
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

test("cancelRun retorna ok quando a API responde com sucesso", async () => {
  let calledUrl, calledOpts;
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledOpts = opts;
    return fakeResponse({ status: 202, body: {} });
  };

  const result = await cancelRun({ owner: "a", repo: "b", runId: 42 }, "token");

  assert.equal(result.ok, true);
  assert.equal(result.status, 202);
  assert.equal(calledUrl, "https://api.github.com/repos/a/b/actions/runs/42/cancel");
  assert.equal(calledOpts.method, "POST");
});

test("cancelRun retorna erro com a mensagem da API quando falha", async () => {
  global.fetch = async () =>
    fakeResponse({ ok: false, status: 403, body: { message: "Sem permissão de escrita" } });

  const result = await cancelRun({ owner: "a", repo: "b", runId: 42 }, "token");

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

test("fetchJobs retorna jobs e steps normalizados", async () => {
  global.fetch = async () =>
    fakeResponse({
      body: {
        jobs: [
          {
            id: 1,
            name: "build",
            status: "completed",
            conclusion: "failure",
            steps: [
              { name: "Checkout", status: "completed", conclusion: "success", number: 1 },
              { name: "Run tests", status: "completed", conclusion: "failure", number: 2 },
            ],
          },
        ],
      },
    });

  const result = await fetchJobs({ owner: "a", repo: "b", runId: 1 }, "token");

  assert.equal(result.ok, true);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].name, "build");
  assert.equal(result.jobs[0].steps[1].name, "Run tests");
  assert.equal(result.jobs[0].steps[1].conclusion, "failure");
});

test("extractStepLog isola o trecho do passo pelos marcadores de group", () => {
  const log = [
    "2024-01-01T00:00:00Z ##[group]Checkout",
    "cloning repo...",
    "2024-01-01T00:00:01Z ##[endgroup]",
    "2024-01-01T00:00:02Z ##[group]Run tests",
    "line 1",
    "line 2",
    "FAIL: something broke",
    "2024-01-01T00:00:03Z ##[endgroup]",
  ].join("\n");

  const { lines, isolated } = extractStepLog(log, "Run tests", 50);

  assert.equal(isolated, true);
  assert.deepEqual(lines, ["line 1", "line 2", "FAIL: something broke"]);
});

test("extractStepLog cai pro final do log inteiro quando não acha o marcador", () => {
  const log = ["a", "b", "c"].join("\n");

  const { lines, isolated } = extractStepLog(log, "Passo inexistente", 2);

  assert.equal(isolated, false);
  assert.deepEqual(lines, ["b", "c"]);
});

test("fetchJobLog isola o log do step quando stepName é informado", async () => {
  const log = ["##[group]Run tests", "linha A", "linha B", "##[endgroup]"].join("\n");
  global.fetch = async () => fakeResponse({ text: log });

  const result = await fetchJobLog({ owner: "a", repo: "b", jobId: 1, stepName: "Run tests" }, "token");

  assert.equal(result.ok, true);
  assert.equal(result.isolated, true);
  assert.equal(result.log, "linha A\nlinha B");
});

test("dispatchWorkflow envia ref e inputs no corpo da requisição", async () => {
  let calledUrl, calledBody, calledOpts;
  global.fetch = async (url, opts) => {
    calledUrl = url;
    calledOpts = opts;
    calledBody = JSON.parse(opts.body);
    return fakeResponse({ status: 204, body: {} });
  };

  const result = await dispatchWorkflow(
    { owner: "a", repo: "b", workflowFile: "ci.yml", ref: "main", inputs: { env: "prod" } },
    "token"
  );

  assert.equal(result.ok, true);
  assert.equal(calledUrl, "https://api.github.com/repos/a/b/actions/workflows/ci.yml/dispatches");
  assert.equal(calledOpts.method, "POST");
  assert.deepEqual(calledBody, { ref: "main", inputs: { env: "prod" } });
});

test("dispatchWorkflow retorna erro com a mensagem da API quando falha", async () => {
  global.fetch = async () =>
    fakeResponse({ ok: false, status: 404, body: { message: "Workflow não encontrado" } });

  const result = await dispatchWorkflow(
    { owner: "a", repo: "b", workflowFile: "ci.yml", ref: "main", inputs: {} },
    "token"
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.equal(result.error, "Workflow não encontrado");
});
