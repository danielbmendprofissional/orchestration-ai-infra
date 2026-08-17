## GitHub

**Claude Desktop** — cole em `mcpServers` no `claude_desktop_config.json`:
```json
"github": {
  "command": "docker",
  "args": ["run", "-i", "--rm", "-e", "GITHUB_PERSONAL_ACCESS_TOKEN",
           "ghcr.io/github/github-mcp-server"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_seu_token_aqui" }
}
```
(Alternativa sem Docker: `npx -y @modelcontextprotocol/server-github`.)

**Claude Code** — rode quando quiser usar, escopo `user` (disponível em
todo projeto até você remover):
```powershell
claude mcp add-json github --scope user "{\"command\":\"npx\",\"args\":[\"-y\",\"@modelcontextprotocol/server-github\"],\"env\":{\"GITHUB_PERSONAL_ACCESS_TOKEN\":\"$env:GITHUB_TOKEN\"}}"
```
Para desligar depois: `claude mcp remove github` (ou toggle via `/mcp`
dentro da sessão).

**OpenCode** — já está definido em `opencode.json` com `"enabled": false`.
Para ligar: mude para `true` (global) ou copie o bloco para o
`opencode.json` do projeto específico.

## GitLab

**Claude Desktop**:
```json
"gitlab": {
  "command": "npx",
  "args": ["-y", "@zereight/mcp-gitlab"],
  "env": {
    "GITLAB_PERSONAL_ACCESS_TOKEN": "glpat-seu-token-aqui",
    "GITLAB_API_URL": "https://gitlab.com/api/v4"
  }
}
```

**Claude Code**:
```powershell
claude mcp add-json gitlab --scope user "{\"command\":\"npx\",\"args\":[\"-y\",\"@zereight/mcp-gitlab\"],\"env\":{\"GITLAB_PERSONAL_ACCESS_TOKEN\":\"$env:GITLAB_TOKEN\",\"GITLAB_API_URL\":\"https://gitlab.com/api/v4\"}}"
```

**OpenCode** — já definido com `"enabled": false` (mesmo formato que você já
tinha, só migrei para desligado por padrão).

## Figma

Já existe uma extensão oficial ("Connector") pra Figma no Claude Desktop —
mais fácil que editar JSON: botão **+** → **Connectors** → instalar Figma →
reiniciar o app pelo processo (não só fechar a janela).

**Claude Code** — o `settings.json` que te mandei agora tem
`"enabledMcpjsonServers": []`, ou seja, o Figma que estava habilitado antes
foi desligado. Para religar, edite
`C:\Users\danib\.claude\settings.json` e volte para
`"enabledMcpjsonServers": ["figma"]` (supondo que o servidor `figma` já
esteja definido em algum `.mcp.json`).

**OpenCode** — suporte oficial ainda não existe (issue #3875 em aberto na
época do seu material antigo). Use o Claude Desktop para Figma por
enquanto.