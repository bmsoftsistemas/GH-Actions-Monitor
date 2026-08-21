/**
 * Consulta a API do GitHub Actions para uma lista de repositórios
 * e retorna quais runs terminaram (mudaram de conclusão) desde a
 * última checagem, atualizando o objeto de estado.
 */

class RateLimitError extends Error {
  constructor(message, resetAt) {
    super(message);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

function parseRateLimit(res) {
  const limit = Number(res.headers.get("x-ratelimit-limit"));
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  const resetHeader = res.headers.get("x-ratelimit-reset");
  if (Number.isNaN(limit) || Number.isNaN(remaining)) return null;
  return {
    limit,
    remaining,
    resetAt: resetHeader ? new Date(Number(resetHeader) * 1000).toISOString() : null,
  };
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

async function fetchRunsForWorkflow(owner, repo, workflowFile, token) {
  const base = workflowFile
    ? `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs`
    : `https://api.github.com/repos/${owner}/${repo}/actions/runs`;

  const url = `${base}?per_page=15`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const rateLimit = parseRateLimit(res);

  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      const primaryLimitHit = rateLimit && rateLimit.remaining === 0;
      if (primaryLimitHit || retryAfter) {
        const resetAt = primaryLimitHit
          ? rateLimit.resetAt
          : new Date(Date.now() + Number(retryAfter) * 1000).toISOString();
        throw new RateLimitError(
          `Limite de requisições da API do GitHub atingido (renova às ${resetAt ? formatTime(resetAt) : "em breve"})`,
          resetAt
        );
      }
    }
    const workflowNote = workflowFile ? ` (workflow ${workflowFile})` : "";
    throw new Error(`GitHub API respondeu ${res.status} para ${owner}/${repo}${workflowNote}`);
  }

  const data = await res.json();
  return { runs: data.workflow_runs || [], rateLimit };
}

/**
 * Um repositório pode monitorar vários workflows (repoCfg.workflowFiles).
 * Como a API do GitHub só filtra por um workflow por requisição, fazemos uma
 * chamada por workflow configurado e mesclamos os resultados. Se nenhum
 * workflow for configurado, busca todas as runs do repositório (1 chamada).
 * Se algum workflow individual falhar mas outros funcionarem, ignora o que
 * falhou e segue com o que deu certo — só propaga erro se TODOS falharem
 * (rate limit sempre tem prioridade e aborta imediatamente).
 */
async function fetchRuns({ owner, repo, workflowFiles }, token) {
  const files = Array.isArray(workflowFiles) && workflowFiles.length > 0 ? workflowFiles : [undefined];

  const settled = await Promise.all(
    files.map((wf) =>
      fetchRunsForWorkflow(owner, repo, wf, token)
        .then((r) => ({ ok: true, ...r }))
        .catch((err) => ({ ok: false, err }))
    )
  );

  const rateLimitFailure = settled.find((s) => !s.ok && s.err.name === "RateLimitError");
  if (rateLimitFailure) throw rateLimitFailure.err;

  const successes = settled.filter((s) => s.ok);
  if (successes.length === 0) {
    throw settled[0].err;
  }

  const runs = successes.flatMap((s) => s.runs).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  let rateLimit = null;
  for (const s of successes) {
    if (s.rateLimit && (!rateLimit || s.rateLimit.remaining < rateLimit.remaining)) rateLimit = s.rateLimit;
  }

  return { runs, rateLimit };
}

/**
 * Roda um ciclo de checagem para todos os repositórios configurados.
 * Retorna { state, events, errors, summaries, rateLimit }, onde events é a
 * lista de runs que terminaram agora (para disparar notificação), errors é
 * a lista de erros por repositório e rateLimit é a leitura mais conservadora
 * (menor "remaining") vista nas respostas desse ciclo.
 */
async function checkAll(repos, token, state) {
  const events = [];
  const errors = [];
  const summaries = [];
  let rateLimit = null;

  await Promise.all(
    repos.map(async (repoCfg) => {
      const repoKey = `${repoCfg.owner}/${repoCfg.repo}`;
      let runs;
      try {
        const result = await fetchRuns(repoCfg, token);
        runs = result.runs;
        if (result.rateLimit && (!rateLimit || result.rateLimit.remaining < rateLimit.remaining)) {
          rateLimit = result.rateLimit;
        }
      } catch (err) {
        errors.push({ repoKey, message: err.message, rateLimited: err.name === "RateLimitError" });
        summaries.push({ repoKey, error: err.message });
        if (err.name === "RateLimitError" && err.resetAt && !rateLimit) {
          rateLimit = { limit: null, remaining: 0, resetAt: err.resetAt };
        }
        return;
      }

      const latest = runs[0];
      const recentRuns = runs.slice(0, 5).map((run) => ({
        id: run.id,
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        headBranch: run.head_branch,
        runNumber: run.run_number,
        htmlUrl: run.html_url,
        updatedAt: run.updated_at,
      }));
      summaries.push(
        latest
          ? {
              repoKey,
              id: latest.id,
              name: latest.name,
              status: latest.status,
              conclusion: latest.conclusion,
              headBranch: latest.head_branch,
              runNumber: latest.run_number,
              htmlUrl: latest.html_url,
              updatedAt: latest.updated_at,
              recentRuns,
            }
          : { repoKey, empty: true }
      );

      // Na primeira checagem de um repositório (acabou de ser adicionado, ou
      // o app acabou de iniciar), só guardamos o estado atual como linha de
      // base — sem notificar runs que já tinham terminado antes de existir
      // monitoramento. A partir da segunda checagem, notificamos normalmente.
      const initKey = `__init:${repoKey}`;
      const isFirstCheck = !state[initKey];

      for (const run of runs) {
        const key = `${repoKey}:${run.id}`;
        const prev = state[key];

        if (run.status === "completed" && run.conclusion && !isFirstCheck) {
          const alreadyNotified = prev && prev.conclusion === run.conclusion;
          if (!alreadyNotified) {
            events.push({ repoKey, run });
          }
        }

        state[key] = { status: run.status, conclusion: run.conclusion };
      }

      state[initKey] = true;
    })
  );

  return { state, events, errors, summaries, rateLimit };
}

/**
 * Dispara um re-run completo de uma execução via API do GitHub. Requer que
 * o token tenha permissão de escrita em Actions (não basta leitura).
 */
async function rerunRun({ owner, repo, runId }, token) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/rerun`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.ok) return { ok: true, status: res.status };

  let message;
  try {
    message = (await res.json()).message;
  } catch {
    // resposta sem corpo JSON — segue sem mensagem detalhada
  }
  return { ok: false, status: res.status, error: message };
}

/**
 * Cancela uma execução em andamento/na fila via API do GitHub. Requer o
 * mesmo escopo de escrita em Actions que o rerun.
 */
async function cancelRun({ owner, repo, runId }, token) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (res.ok) return { ok: true, status: res.status };

  let message;
  try {
    message = (await res.json()).message;
  } catch {
    // resposta sem corpo JSON — segue sem mensagem detalhada
  }
  return { ok: false, status: res.status, error: message };
}

module.exports = { checkAll, RateLimitError, rerunRun, cancelRun };
