# RTK + Caveman — instalação e configuração (Windows, Claude Code + OpenCode)

Guia de referência para instalar, configurar e verificar as duas ferramentas. Ambiente de referência: Windows 10/11, `rtk 0.46.0`, Claude Code, OpenCode com múltiplos providers (Deepseek, GPT via Luna, Qwen local via Ollama).

Para práticas de uso, quando ligar cada uma, e a comparação entre o que é prometido e o que foi medido de verdade, ver o arquivo separado **`less-tokens.md`**.

---

## 1. O que cada ferramenta faz

**RTK ("Rust Token Killer")** — CLI proxy em Rust que intercepta comandos de bash (grep, read, cat, etc.) executados pelo agente e reescreve/filtra a saída antes dela virar contexto do modelo. Atua na camada de *ferramentas*, roda como hook nativo, sem overhead perceptível quando não há comando pra filtrar.

**Caveman** — duas coisas debaixo do mesmo nome:
1. Um **hook/proxy** (`caveman-proxy.exe`) que comprime contexto.
2. Uma **skill/plugin** que faz o próprio modelo responder em "caveman-speak" (frases telegráficas), ativável e ajustável dentro do chat via `/caveman [lite|full|ultra|wenyan]`. Essa parte injeta uma instrução de sistema **em todo turno**, o que tem custo fixo mesmo quando não economiza nada.

---

## 2. Instalação — comandos que funcionaram neste ambiente

### RTK — instalar o binário do zero (Windows, PowerShell como Admin)

O RTK não tem instalador; é um binário único que você baixa e coloca no PATH manualmente.

```powershell
# 1. Criar uma pasta local pro binário
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.local\bin"

# 2. Baixar o zip da release mais recente pro Windows
Invoke-WebRequest -Uri "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip" -OutFile "$env:USERPROFILE\.local\bin\rtk.zip"

# 3. Extrair o rtk.exe
Expand-Archive -Path "$env:USERPROFILE\.local\bin\rtk.zip" -DestinationPath "$env:USERPROFILE\.local\bin" -Force

# 4. Apagar o zip
Remove-Item "$env:USERPROFILE\.local\bin\rtk.zip"

# 5. Adicionar ao PATH do usuário
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.local\bin", "User")
```

**Feche e abra o PowerShell de novo** (como Admin) pra o PATH novo ser lido, depois confirme:
```powershell
rtk --version
```

### RTK — configurar nos agentes (depois do binário instalado)

```powershell
rtk --version
# certifique-se de estar em >= 0.37.2 (versão com hook nativo binário, sem depender de bash/jq)

rtk init -g                # Claude Code (global)
rtk init -g --opencode     # OpenCode (global) — cria ~/.config/opencode/plugins/rtk.ts, autodescoberto
```

Não precisa editar `opencode.json` manualmente: arquivos `.ts` em `~/.config/opencode/plugins/` são carregados automaticamente no startup. Só pacotes **npm** precisam de entrada explícita no array `"plugin": [...]`.

### Caveman

```powershell
npm i -g @caveman-ai/cli
caveman setup --install

# Skill/plugin do Claude Code (dá o comando /caveman) — via marketplace nativo
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
```

**Atenção:** a instalação via `claude plugin install` (marketplace nativo) NÃO conecta a badge da statusline sozinha — precisa ser cravado manualmente (seção 5) e o modo precisa ser ativado explicitamente com `/caveman full` pra criar o flag `~/.claude/.caveman-active` (seção 5 também).

---

## 3. Adicionando um agente novo depois

**RTK** — cada agente tem sua própria flag:
```powershell
rtk init -g --opencode
rtk init -g --codex
rtk init -g --agent cursor
rtk init -g --agent windsurf
```

**Caveman** — instalador seguro pra rodar de novo (detecta binários novos no PATH):
```powershell
npx -y github:JuliusBrussee/caveman -- --all
npx -y github:JuliusBrussee/caveman -- --only <nome-do-agente>
```

---

## 4. Cuidado: conflito com plugins de terceiros no OpenCode

Pacotes npm não-oficiais existem (`openrtk`, `opencode-rtk`, `rtk-for-opencode`, `@rezamonangg/opencode-rtk`). Plugin de diretório (oficial) e plugin npm (terceiro) carregam **separadamente** no OpenCode — os dois podem ficar ativos ao mesmo tempo competindo pelo mesmo hook.

```powershell
npm ls -g --depth=0 | Select-String openrtk
npm view openrtk time.modified, maintainers, version
npm uninstall -g openrtk
# + remover a entrada "plugin": ["openrtk"] do opencode.json
```

---

## 5. Verificação — como confirmar que está funcionando de verdade

### RTK

```powershell
rtk init --show     # confirma hook nativo, RTK.md, settings.json, plugin OpenCode
rtk gain            # mostra quantos comandos foram processados e quanto foi "economizado" (self-reported)
```

Teste real: peça ao agente, em linguagem natural, pra rodar um comando de bash de verdade ("rode `git status`") — nunca digite o comando do RTK como se fosse mensagem de chat, modelos locais pequenos podem interpretar errado.

### Caveman

```powershell
claude plugin list             # deve listar caveman@caveman como enabled
```

Statusline (badge `[CAVEMAN] ⛏ Xk`) não vem conectada por padrão na instalação via plugin marketplace. Conectar:

```powershell
$path = "$env:USERPROFILE\.claude\settings.json"
$json = Get-Content $path -Raw | ConvertFrom-Json
$json | Add-Member -NotePropertyName statusLine -NotePropertyValue ([PSCustomObject]@{
    type    = "command"
    command = "powershell -NoProfile -File C:/Users/danib/.claude/plugins/marketplaces/caveman/src/hooks/caveman-statusline.ps1"
}) -Force
$json | ConvertTo-Json -Depth 10 | Set-Content $path
```
(ou, mais simples: dentro do Claude Code, `/statusline mostre o badge de savings do caveman usando o script em C:\Users\danib\.claude\plugins\marketplaces\caveman\src\hooks\caveman-statusline.ps1`)

Depois, ative de fato (o badge só aparece com o flag presente):
```
/caveman full
```

Ver economia da sessão:
```
/caveman-stats
```
Mostra tokens de saída, tokens de cache, estimativa sem o caveman, tokens economizados, overhead de regra injetada por turno, e o líquido real (que pode ser negativo).

### Bugs conhecidos no Windows (documentados nos próprios repositórios)

- Hook do RTK pode desaparecer do `settings.json` depois do primeiro comando, porque o Claude Code reescreve esse arquivo ([#1821](https://github.com/rtk-ai/rtk/issues/1821)).
- Comandos como `ls`, `wc`, `dir`, `echo` falham via RTK no PowerShell, por serem aliases/built-ins ([#1248](https://github.com/rtk-ai/rtk/issues/1248)).
- Badge da statusline do Caveman pode ficar dessincronizada do estado real do modo ([#245](https://github.com/JuliusBrussee/caveman/issues/245)).

---

## 6. Controle de intensidade dentro do chat

**Caveman**: `/caveman lite|full|ultra|wenyan`, persiste pela sessão. Sair: "normal mode".

**RTK**: não tem equivalente — comportamento fixo via `~/.config/rtk/config.toml` ou variável de ambiente (`RTK_DISABLED=1`), exige reiniciar o agente pra qualquer mudança.

---

## 7. Fontes (instalação/configuração)

- [rtk-ai/rtk (GitHub)](https://github.com/rtk-ai/rtk)
- [RTK — Configuration docs](https://www.rtk-ai.app/docs/getting-started/configuration/)
- [RTK — Supported Agents](https://www.rtk-ai.app/docs/getting-started/supported-agents/)
- [Issue #1821 — hook do RTK desaparece após primeiro comando](https://github.com/rtk-ai/rtk/issues/1821)
- [Issue #1248 — gaps de compatibilidade PowerShell](https://github.com/rtk-ai/rtk/issues/1248)
- [JuliusBrussee/caveman (GitHub)](https://github.com/juliusbrussee/caveman)
- [Caveman Quickstart docs](https://docs.caveman.so/docs/quickstart)
- [Issue #245 — badge da statusline do Caveman dessincroniza](https://github.com/JuliusBrussee/caveman/issues/245)
- [OpenCode — Plugins (docs oficiais)](https://opencode.ai/docs/plugins/)
- [Claude Code — Customize your status line (docs oficiais)](https://code.claude.com/docs/en/statusline)