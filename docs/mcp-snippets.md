# MCP — biblioteca de trechos (dado, sem julgamento — agent lê e usa direto)

Todo trecho nasce `"disabled": true`. Nunca token literal — sempre `${VAR}`; se a variável não existir na máquina, parar e pedir pro humano criar (nunca adivinhar valor).

## GitLab — por projeto, sempre

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      },
      "disabled": true
    }
  }
}
```

## GitHub — só se o projeto específico precisar

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "disabled": true
    }
  }
}
```

## Os dois no mesmo `.mcp.json`

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "${GITLAB_TOKEN}",
        "GITLAB_API_URL": "https://gitlab.com/api/v4"
      },
      "disabled": true
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      },
      "disabled": true
    }
  }
}
```

## Ligar um servidor (2 mecanismos diferentes, mesmo `.mcp.json`)

- **`pi`**: tirar o `"disabled"` (ou mudar pra `false`) e rodar `/reload` dentro da sessão `pi` — ou `/mcp enable <nome>` + `/reload`.
- **Claude Code**: ignora o `"disabled"` do `.mcp.json`. Quem liga/desliga é `.claude/settings.json`, campo `disabledMcpjsonServers` (lista nomes desligados) ou `enabledMcpjsonServers: []` (desliga tudo). Ligar 1 servidor: tirar o nome de `disabledMcpjsonServers`, ou adicionar em `enabledMcpjsonServers` se for lista de permissão.

Nunca ligar um MCP sozinho — só sob pedido explícito do humano pra aquela tarefa específica.