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
   access tokens, com escopo `repo` ou permissão de leitura em Actions).
2. Adicione os repositórios (`owner` + `repo`). Opcionalmente, digite o
   nome de um ou mais arquivos de workflow (ex: `ci.yml`, Enter para
   adicionar cada um) para filtrar quais workflows monitorar — deixe vazio
   para acompanhar todos.
3. Use o botão 🔎 em cada linha para testar o acesso antes de salvar, e o
   botão 🔔/🔕 para silenciar notificações daquele repo específico (ele
   continua sendo monitorado e aparecendo no dashboard, só não dispara
   toast).
4. Clique em **Salvar**. Se o monitoramento já estiver ligado, ele reinicia
   automaticamente com a nova configuração.
5. Na aba **Monitoramento**, cada repositório aparece como um card
   (ordenado com falhas primeiro) — clique para abrir a run mais recente,
   ou no ▾ para ver o histórico das últimas 5 execuções.
6. Clique com o botão direito no ícone da bandeja para Iniciar/Parar,
   abrir Configurações ou Sair.

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
iniciar e a cada 4h, baixa em segundo plano e avisa quando está pronta pra
instalar — pelo banner na janela, notificação do sistema, ou item no menu
da bandeja). Isso só roda no app empacotado (`app.isPackaged`); em
`npm start` fica inerte de propósito.

Falta configurar **onde** as versões publicadas ficam hospedadas — isso é
feito pela chave `build.publish` no `package.json`, que ainda não está
definida. A opção mais comum com `electron-builder` é GitHub Releases:
criar um repositório no GitHub, adicionar `"publish": { "provider": "github" }`
ao `build` do `package.json`, e rodar `electron-builder --publish always`
(com a variável `GH_TOKEN` definida) para subir cada release. Sem isso, o
auto-updater no app empacotado vai falhar silenciosamente ao checar
atualizações (erro tratado, não derruba o app).

## 5. Estrutura do projeto

```
main.js                     # processo principal: tray, ciclo de polling, auto-update, notificações
watcher.js                  # lógica de consulta à API do GitHub (reaproveitável)
store.js                    # persistência da config (token criptografado) e do estado de notificações já enviadas
preload.js                  # ponte segura entre a janela de configurações e o main
settings.html/.css/.js      # janela única com as telas de Monitoramento e Configurações
assets/                     # ícones da bandeja e do app
```
