#!/usr/bin/env node
/**
 * Automatiza o fluxo de release:
 *   1. bump de versão no package.json (npm version, cria commit + tag git)
 *   2. push do commit e da tag
 *   3. build + publish do instalador via electron-builder (cria a release no GitHub)
 *   4. remove o "draft" da release recém-criada
 *
 * Uso: npm run release -- <patch|minor|major|premajor|preminor|prepatch|prerelease|X.Y.Z>
 * Padrão: patch
 */

const { execSync } = require("child_process");

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { stdio: "pipe", encoding: "utf8", ...opts }).trim();
}

function runInherit(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

const bump = process.argv[2] || "patch";

const dirty = run("git status --porcelain");
if (dirty) {
  fail("Há mudanças não commitadas. Commit ou stash antes de rodar o release.");
}

let newVersionOutput;
try {
  newVersionOutput = run(`npm version ${bump} -m "chore: release %s"`);
} catch (err) {
  fail(`npm version falhou: ${err.message}`);
}

const tag = newVersionOutput.trim(); // ex: v1.0.1
const version = tag.replace(/^v/, "");
console.log(`\n→ Nova versão: ${version} (tag ${tag})`);

runInherit("git push");
runInherit(`git push origin ${tag}`);

let ghToken = process.env.GH_TOKEN;
if (!ghToken) {
  try {
    ghToken = run("gh auth token");
  } catch {
    fail("GH_TOKEN não definido e `gh auth token` falhou. Rode `gh auth login` primeiro.");
  }
}

runInherit("npx electron-builder --publish always", {
  env: { ...process.env, GH_TOKEN: ghToken },
});

runInherit(`gh release edit ${tag} --draft=false`);

const releaseUrl = run(`gh release view ${tag} --json url --jq .url`);
console.log(`\n✔ Release ${tag} publicada: ${releaseUrl}`);
