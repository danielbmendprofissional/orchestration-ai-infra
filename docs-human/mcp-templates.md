# MCP — biblioteca de trechos pra copiar/colar

**docs-human — você cura este arquivo, o agente só lê.** Cada bloco abaixo é um trecho pronto pra colar dentro de `mcpServers` num `.mcp.json` de projeto (ver `docs/mcp-setup.md` pro procedimento). Quando descobrir um MCP novo que vale a pena reusar, adiciona um bloco aqui.

Regras fixas:
- Nunca token literal em bloco nenhum daqui — sempre `${VAR}`. A variável precisa existir na máquina antes (`setx NOME_DA_VAR "valor"`, mesmo padrão do passo 3 de `comandos-para-rodar.md`).
- **Todo servidor nasce desligado por padrão** (`"disabled": true`) — só liga quando for usar de verdade. Ver seção final pra como ligar em cada ferramenta.

## GitLab — por projeto, sempre (cada repo aponta pro GitLab dele)

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

## GitHub — só se o projeto específico precisar (não é padrão)

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

## Exemplo com os dois no mesmo `.mcp.json`, os dois desligados

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

## Como ligar quando for usar (2 mecanismos diferentes, um por ferramenta)

`.mcp.json` é o mesmo arquivo pras duas ferramentas, mas cada uma decide "ligado/desligado" no seu próprio lugar — mudar um não muda o outro.

- **`pi`:** o `"disabled": true` acima já é suficiente. Pra ligar: tira o campo (ou muda pra `false`) e roda `/reload` dentro da sessão `pi` — ou usa `/mcp enable <nome>` + `/reload`.
- **Claude Code:** ignora o `"disabled"` do `.mcp.json` — ele nunca leu esse campo. Quem liga/desliga pra ele é `.claude/settings.json`, campo `disabledMcpjsonServers` (lista os nomes desligados) ou `enabledMcpjsonServers: []` (desliga tudo de uma vez). Pra ligar 1 servidor específico: tira o nome dele de `disabledMcpjsonServers`, ou adiciona ele em `enabledMcpjsonServers` se estiver usando a lista de permissão.

## Fora daqui

Figma e o que for GUI-only (Claude Desktop) não têm trecho JSON — não entram nesta biblioteca. Ver `docs-human/mcp-desktop.md`.