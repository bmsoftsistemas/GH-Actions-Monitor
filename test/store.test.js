const { test } = require("node:test");
const assert = require("node:assert/strict");

// store.js faz `require("electron")` no topo (pra app.getPath/safeStorage),
// que não existe fora de um processo Electron real — mockamos o módulo antes
// de exigir store.js pra poder testar normalizeRepo isoladamente.
const Module = require("node:module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === "electron") return require.resolve("./fakes/electron-fake.js");
  return originalResolveFilename.call(this, request, ...args);
};

const { normalizeRepo } = require("../store");

test("normalizeRepo preenche tags como array vazio quando ausente", () => {
  const result = normalizeRepo({ owner: "a", repo: "b" });
  assert.deepEqual(result.tags, []);
});

test("normalizeRepo preserva tags já existentes", () => {
  const result = normalizeRepo({ owner: "a", repo: "b", tags: ["youtube", "prod"] });
  assert.deepEqual(result.tags, ["youtube", "prod"]);
});

test("normalizeRepo migra workflowFile singular (config antiga) pro array", () => {
  const result = normalizeRepo({ owner: "a", repo: "b", workflowFile: "ci.yml" });
  assert.deepEqual(result.workflowFiles, ["ci.yml"]);
});

test("normalizeRepo aplica notifyMode padrão quando valor é inválido", () => {
  const result = normalizeRepo({ owner: "a", repo: "b", notifyMode: "algo-invalido" });
  assert.equal(result.notifyMode, "all");
});
