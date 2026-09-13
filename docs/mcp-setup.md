# MCP por projeto

Todo projeto (repo próprio ou instanciado a partir do `ai-base`) tem seu próprio `.mcp.json` na raiz — nunca configuração global de MCP pra GitLab/GitHub. Claude Code lê `.mcp.json` nativo. `pi` lê depois de instalado o adapter (`pi install npm:pi-mcp-adapter`, ver `ai-base/docs/environment-setup.md`) — se `/mcp` não existir como comando dentro de uma sessão `pi`, o adapter não está instalado, pare e avise o humano em vez de seguir sem MCP.

**Todo servidor nasce desligado por padrão** (`"disabled": true` no `.mcp.json`, ver `docs/mcp-snippets.md`) — nunca ativar um MCP sozinho sem pedido explícito do humano pra aquela tarefa específica.

## Ao nascer um projeto novo, ou quando um projeto pedir um MCP que ainda não tem

1. Ler `docs/mcp-snippets.md` — biblioteca de trechos prontos (GitLab, GitHub, outros que forem adicionados lá). Todos já vêm com `"disabled": true`.
2. Copiar o bloco relevante pra dentro de `mcpServers` no `.mcp.json` da raiz do projeto (criar o arquivo se ainda não existir).
3. **GitLab entra por padrão, sempre** — cada projeto aponta pro próprio GitLab dele (`GITLAB_API_URL` + token daquele projeto).
4. **GitHub só entra se aquele projeto específico precisar** (ex: dependência hospedada lá, mirror). Não copiar por padrão junto com o GitLab.
5. Nunca escrever token literal no `.mcp.json` — sempre `${NOME_DA_VAR}` (ex: `${GITLAB_TOKEN}`). Se a variável de ambiente ainda não existir na máquina, parar e pedir pro humano criar (não adivinhar valor, não deixar em branco).
6. Validar que o `.mcp.json` resultante é JSON válido antes de terminar a tarefa.

## Ligar um MCP pra usar de verdade (só sob pedido explícito do humano, nunca por conta própria)

Mecanismo diferente por ferramenta, mesmo `.mcp.json` — ver `docs/mcp-snippets.md` pro passo a passo de cada um (`pi`: tirar `disabled`/`/reload`; Claude Code: `disabledMcpjsonServers` em `.claude/settings.json`).

## O que não faz parte disso

Claude Desktop (app gráfico, não Claude Code) e Figma são configuração de máquina, fora de qualquer projeto — configuração manual do humano, fora do escopo de qualquer agent. Nenhuma tarefa de projeto deve tocar nisso.