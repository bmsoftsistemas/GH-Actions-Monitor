# GH Actions Watcher (GUI)

App de bandeja (system tray) para monitorar GitHub Actions de vários
repositórios e mostrar um toast nativo quando um workflow termina.
Tem uma janela com duas telas: **Monitoramento** (dashboard com o status
de cada repo) e **Configurações**, onde você:

- cola o GitHub Token;
- adiciona/remove repositórios, cada um com sua própria lista de
  workflows a monitorar (vazio = todos os workflows do repo);
- silencia notificações por repositório sem parar o monitoramento;
- define o intervalo de checagem;
- marca "iniciar com o sistema";
- testa o acesso a cada repositório;
- liga/desliga o monitoramento (pelo botão da janela ou pelo menu da bandeja).

## 1. Instalação (modo desenvolvimento)

```bash
npm install
npm start
```

Isso abre a janela de configurações na primeira vez (não há config salva
ainda) e coloca um ícone na bandeja do sistema.

## 2. Uso

1. Cole seu **GitHub Token** (Settings → Developer settings → Personal
   access tokens, com escopo `repo` em token classic, ou permissão
   "Actions: Read and write" em fine-grained — o "and write" é necessário
   para re-executar, cancelar e disparar workflows manualmente, não só
   para monitorar). Use o botão **"Testar token"** pra confirmar na hora
   se é válido — mostra o usuário, o tipo (classic/fine-grained) e, pra
   token classic, os escopos concedidos (fine-grained não expõe isso pela
   API; nesse caso teste o acesso a um repo específico com o 🔎 de cada
   linha).
2. Adicione os repositórios (`owner` + `repo`). Opcionalmente, digite o
   nome de um ou mais arquivos de workflow (ex: `ci.yml`, Enter para
   adicionar cada um) para filtrar quais workflows monitorar — deixe vazio
   para acompanhar todos.
3. Use o ícone de lupa em cada linha para testar o acesso antes de salvar,
   e o ícone de sino pra silenciar completamente as notificações daquele
   repo (continua monitorado e aparecendo no dashboard, só não dispara
   toast). Pra um controle mais fino, use o seletor **"Notificar tudo /
   Notificar só falhas / Falhas + quando voltar a passar"** e o campo de
   branches pra silenciar notificações só de branches específicas (nome
   exato, ex: `dev`) sem silenciar o repo inteiro.
4. Opcionalmente, dê um **grupo** pro repositório (ex: `Backend`,
   `Frontend`, `DevOps`) — no dashboard, os cards ficam organizados em
   seções por grupo (repos sem grupo caem numa seção "Sem grupo" no
   final). Use **Importar/Exportar** pra compartilhar a lista de
   repositórios (com grupos, filtros de workflow e preferências de
   notificação) com a equipe — o Token nunca entra no arquivo exportado.
   Importar soma repositórios novos à sua lista atual sem duplicar os que
   já existem (por owner/repo).
5. Clique em **Salvar**. Se o monitoramento já estiver ligado, ele reinicia
   automaticamente com a nova configuração.
6. Na aba **Monitoramento**, cada repositório aparece como um card
   (ordenado com falhas primeiro dentro de cada grupo) — usa os mesmos
   ícones de status do GitHub Actions (✓ verde, ✕ vermelho, spinner
   amarelo pra em andamento). Use os botões **Todos / Apenas falhas /
   Rodando agora** para filtrar.
   Passe o mouse sobre um card (ou linha do histórico, no ▾) pra ver ações
   rápidas: abrir no navegador, cancelar (se estiver rodando) ou
   re-executar (se falhou) — sem precisar sair do app.
7. Clique numa linha do histórico (▾) para expandir os **jobs e steps**
   daquela execução. Se um step falhou, clique nele pra ver as últimas 50
   linhas do log direto no app (a API do GitHub só expõe o log inteiro do
   job — o app tenta isolar só o trecho daquele step pelos marcadores do
   log; quando não consegue, mostra um aviso e cai pro final do log
   completo do job).
8. Use o ícone ▶ no card para **disparar um workflow manualmente**
   (`workflow_dispatch`) — informe o arquivo do workflow, a branch/tag e,
   opcionalmente, inputs em JSON.
9. Clique com o botão direito no ícone da bandeja para Iniciar/Parar,
   abrir Configurações ou Sair.

O rodapé da janela mostra o consumo da cota da API do GitHub (ex: "API:
4500/5000 requisições restantes"), ficando amarelo quando perto do limite.

**Smart polling**: o intervalo configurado é só a linha de base — o app
acelera pra no máximo 10s enquanto algum workflow estiver rodando/na fila
(pra pegar a conclusão logo), e relaxa pra pelo menos 2 minutos fora do
horário comercial (fim de semana ou antes das 7h) quando nada está
rodando, economizando cota da API. O contador "Próxima verificação em..."
já reflete o intervalo efetivo, não só o configurado.

Em **Configurações**, "Tocar som ao concluir um build" ativa um bipe curto
sintetizado (sem depender de nenhum arquivo de áudio) — sutil no sucesso,
mais chamativo na falha. Esses sons e as notificações nativas respeitam o
mute, a granularidade e as branches silenciadas de cada repo.

O botão **"Não perturbe"** no rodapé da bandeja pausa notificações nativas
e sons por 1h, 2h ou até amanhã (8h) — o monitoramento e o dashboard
continuam normalmente, só a interrupção é silenciada enquanto o foco
estiver ativo.

O ícone da bandeja muda de cor: cinza (parado), verde (rodando sem erro),
vermelho (erro ao consultar algum repositório, ou limite de requisições da
API do GitHub atingido — passe o mouse para ver detalhes). Nesse último
caso o app pausa o polling sozinho e retoma automaticamente quando a cota
da API renova, em vez de continuar batendo na API.

Há um botão de sol/lua ao lado do nome do app para alternar entre tema
escuro e claro; a escolha fica salva no navegador da janela.

## 3. Onde fica salva a configuração

- `config.json` e `run-state.json` ficam na pasta de dados do usuário do
  Electron (`app.getPath('userData')`), por exemplo:
  - Linux: `~/.config/gh-actions-watcher-gui/`
  - macOS: `~/Library/Application Support/gh-actions-watcher-gui/`
  - Windows: `%APPDATA%\gh-actions-watcher-gui\`
- O token é criptografado com o `safeStorage` do Electron (usa o
  DPAPI no Windows, Keychain no macOS, libsecret no Linux) antes de ir
  pro disco — nunca fica em texto puro no `config.json`. Um `config.json`
  de uma versão antiga do app (com token em texto puro) é migrado
  automaticamente na primeira leitura. Em sistemas sem backend de
  criptografia disponível, o app cai de volta para texto puro como último
  recurso.

## 4. Gerar um instalador (app "de verdade")

```bash
npm run dist
```

Usa o `electron-builder` (config já no `package.json`) para gerar:
- `.AppImage` no Linux
- `.exe`/instalador no Windows
- `.app`/`.dmg` no macOS (precisa rodar num Mac para assinar)

Os binários saem em `dist/`.

### Auto-update

O app já vem com `electron-updater` integrado (checa por atualização ao
iniciar e a cada 5min, baixa em segundo plano e avisa quando está pronta pra
instalar — pelo banner na janela, notificação do sistema, ou item no menu
da bandeja). Isso só roda no app empacotado (`app.isPackaged`); em
`npm start` fica inerte de propósito.

As versões publicadas ficam hospedadas em GitHub Releases, no repositório
[`bmsoftsistemas/GH-Actions-Monitor`](https://github.com/bmsoftsistemas/GH-Actions-Monitor)
(configurado em `build.publish` no `package.json`).

### Publicando uma nova versão

```bash
npm run release -- patch   # ou minor / major / 1.2.3
```

Isso automatiza (`scripts/release.js`):

1. `npm version` — bump da versão no `package.json`, commit e tag git.
2. `git push` do commit e da tag.
3. `electron-builder --publish always` — builda o instalador e cria a
   release no GitHub (usa `gh auth token` automaticamente se `GH_TOKEN`
   não estiver definido no ambiente).
4. Remove o "draft" da release, deixando-a publicada (o `electron-updater`
   só enxerga releases publicadas, não rascunhos).

Requer working tree limpo (sem mudanças não commitadas) e a GitHub CLI
(`gh`) autenticada.

## 5. Estrutura do projeto

```
main.js                     # processo principal: tray, ciclo de polling, auto-update, notificações
watcher.js                  # lógica de consulta à API do GitHub (reaproveitável)
store.js                    # persistência da config (token criptografado) e do estado de notificações já enviadas
preload.js                  # ponte segura entre a janela de configurações e o main
settings.html/.css/.js      # janela única com as telas de Monitoramento e Configurações
audio.html/.js, audio-preload.js  # janela oculta que só sintetiza os bipes de som (Web Audio)
assets/                     # ícones da bandeja e do app
test/                       # testes de watcher.js (node:test, sem dependências extras)
```

## 6. Testes

```bash
npm test
```

Roda `test/watcher.test.js` com o test runner nativo do Node
(`node --test`), cobrindo `checkAll`/`fetchRuns`: baseline na primeira
checagem, dedupe de notificação, comportamento de rate limit e merge de
runs quando um workflow falha mas outro funciona.
