# bolaOn

Sistema simples de bolao da Copa do Mundo 2026.

## Estrutura

- `client/`: frontend React com Vite.
- `server/`: backend Node.js/Express.
- `server/bolaon.sqlite`: banco SQLite local.

## Como rodar para desenvolvimento

Instale as dependencias:

```bash
npm run install:all
```

Rode o servidor e o frontend em modo desenvolvimento:

```bash
npm run dev:server
npm run dev:client
```

Frontend de desenvolvimento: `http://localhost:5173`

API: `http://localhost:3333`

## Como rodar para uso no setor

Gere o build do frontend:

```bash
npm run build
```

Suba o servidor:

```bash
npm start
```

O Node serve o frontend e a API no mesmo endereco:

```text
http://192.168.3.69:3333
```

Depois de alterar o frontend, rode `npm run build` novamente e reinicie o servidor.

## Rodar sem terminal aberto

Crie um arquivo `iniciar-bolaon.vbs` com:

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d C:\codex\bolaOn && npm start", 0, False
```

Para iniciar junto com o Windows, coloque um atalho desse arquivo em:

```text
Win + R -> shell:startup
```

## Sustentacao

- O banco principal fica em `server/bolaon.sqlite`.
- Antes de limpar dados ou fazer mudancas grandes, copie `server/bolaon.sqlite` como backup.
- Os arquivos `bolaon.sqlite-wal` e `bolaon.sqlite-shm` podem aparecer quando o banco esta em uso.
- O endpoint `http://192.168.3.69:3333/api/health` deve responder `{ "ok": true }` quando o servidor esta online.
- O usuario administrador padrao e `admin@bolaon.local`.

## Regras principais

- Palpites dos jogos bloqueiam 5 minutos antes do inicio da partida.
- Bonus bloqueia 5 minutos antes do primeiro jogo da Copa.
- Resultados oficiais sao lancados pelo administrador.
- Ranking ignora usuarios administradores.
- O mata-mata pode ser ativado pelo administrador quando os confrontos estiverem definidos.
- A primeira etapa do mata-mata e a 2 fase da Copa: 16-avos, com 32 classificados.

## Dados de teste

Para liberar testes, limpe apenas dados de movimento:

- `audit_logs`
- `predictions`
- `bonus_predictions`
- `bonus_results`
- campos de resultado em `matches`

Nao apague `users`, `teams`, `matches` ou `app_settings` sem backup.
