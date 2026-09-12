# MCP — Claude Desktop (app gráfico) e Figma

**docs-human — config de máquina, fora de qualquer projeto, só você mexe.** Claude Desktop é o app de chat (não é Claude Code, a ferramenta de código) — o que está aqui não tem relação com `.mcp.json` de projeto nenhum (`docs/mcp-setup.md` + `mcp-templates.md`).

## GitHub / GitLab no Claude Desktop

Cole em `mcpServers` dentro do `claude_desktop_config.json` (`%APPDATA%\Claude\claude_desktop_config.json`):

```json
"github": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}" }
},
"gitlab": {
  "command": "npx",
  "args": ["-y", "@zereight/mcp-gitlab"],
  "env": {
    "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_TOKEN}",
    "GITLAB_API_URL": "https://gitlab.com/api/v4"
  }
}
```

Mesma regra: nunca token literal, sempre `${VAR}` (já deve existir na máquina se você seguiu o passo 3 de `comandos-para-rodar.md`).

## Figma

Extensão oficial ("Connector") no Claude Desktop — botão **+** → **Connectors** → instalar Figma → reiniciar o app pelo processo (não só fechar a janela). Sem JSON, sem token pra colar.

`pi` e Claude Code (CLI) não têm integração com Figma até a data desta nota — só o app Claude Desktop tem o Connector oficial.