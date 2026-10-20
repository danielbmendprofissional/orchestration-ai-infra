# Profiles do VS Code — pra que servem e quando usar

Cada arquivo `.settings.json` aqui é o conteúdo do **Settings JSON de um Profile do VS Code** (não confundir com o `settings.json` global da máquina, que é `users-appdata-roaming-code-user-settings.json` — esse continua valendo pra tudo, os profiles só sobrepõem/adicionam por cima dele quando o profile ativo é aquele).

Um Profile do VS Code é um conjunto isolado de settings + extensões + keybindings que você troca conforme o tipo de projeto que abriu. A ideia aqui é: **um profile por natureza de trabalho**, não um profile por projeto — você não cria um profile novo pra cada repo Angular, usa sempre o mesmo `angular-frontend` pra qualquer projeto Angular.

## Os 4 arquivos

### `profile-base.settings.json` — não é um profile pra ativar sozinho

Este é o denominador comum: GitLens (current line ligado, CodeLens desligado pra não poluir), Error Lens (mostra erro/warning inline sem precisar abrir o Problems), Todo Tree (reconhece `TODO`/`FIXME`/`HACK`/`BUG`/`XXX`), corretor ortográfico em inglês + português, e desliga o preview de editor (abrir arquivo já vira aba fixa, não substitui a anterior ao abrir o próximo).

**Quando usar:** sempre — mas colando dentro de cada um dos outros 3 profiles, não como profile isolado. Ver seção "Como aplicar" abaixo.

### `profile-angular-frontend.settings.json` — quando o projeto aberto é Angular

Prettier como formatter fixo pra `.ts`, `.html`, `.scss` e `.json`, com format-on-save ligado. Tab size 2 (padrão da comunidade Angular/TS). ESLint validando `.ts` e `.html`, com autofix no save. Suporte a Tailwind (`includeLanguages` pra HTML e "javascript" — cobre os templates). Esconde `dist/` e `.angular/` do explorer, porque são pasta de build, não código.

**Quando usar:** qualquer repo que seja o app Angular do template (`ai-base` → stack fixa de frontend). Ative antes de começar a mexer em componente, service, template — o autofix do ESLint e o Prettier já saem configurados certos.

### `profile-dotnet-backend.settings.json` — quando o projeto aberto é backend .NET/C#

CSharpier como formatter (`.cs`), format-on-save ligado, tab size 4 (padrão C#, diferente do TS). Inlay hints ligado pra parâmetros, desligado pra tipos (evita poluir a linha com tipo óbvio, mas ajuda a lembrar qual argumento é qual numa chamada com vários parâmetros posicionais). Roslyn Analyzers ligado (via OmniSharp) — pega bug e code smell em tempo real, não só no build. Esconde `bin/`, `obj/`, `.vs/` do explorer e do watcher de arquivos (evita o VS Code ficar reindexando pasta de build toda hora). "Peek View" de teste desligado (abre o teste na aba normal, não numa view flutuante).

**Quando usar:** qualquer repo/projeto backend em C#/.NET aberto a partir deste template. Como o backend não tem stack fixa (`CLAUDE.md`), isso só se aplica quando o projeto específico escolheu .NET — se for outra stack de backend, nenhum destes 4 profiles serve e vale criar um profile novo seguindo o mesmo padrão.

### `profile-devops.settings.json` — quando está mexendo em infra/CI, não em código de aplicação

Desliga a start page do Docker (não serve pra nada depois da primeira vez). Garante que `.yaml`/`.yml` sejam reconhecidos como YAML e `Dockerfile*` como Dockerfile (evita o VS Code tratar como plain text). Sem format-on-save em Dockerfile (não tem um formatter confiável universal pra ele, forçar um formata errado). YAML com tab size 2 e espaços (não tabs — a maioria dos parsers de YAML em CI quebra com tab literal).

**Quando usar:** editando `docker-compose.yml`, `.gitlab-ci.yml`, manifests de Kubernetes, Dockerfiles — geralmente dentro do repo `ai-infra` ou na pasta de deploy de um projeto, não no código-fonte da aplicação.

## Como aplicar de verdade dentro do VS Code

Estes arquivos são só o *conteúdo*, criar o profile em si é manual, dentro do VS Code:

1. Ícone de engrenagem (canto inferior esquerdo) → **Profiles** → **Create Profile...** (ou clique no seletor de profile na barra de status, se já tiver mais de um).
2. Dê o nome exato do arquivo sem `.settings.json` (`angular-frontend`, `dotnet-backend`, `devops`) — facilita bater arquivo com profile na hora de atualizar.
3. Com o profile novo ativo, abra a Command Palette → **Preferences: Open User Settings (JSON)** — isso abre o `settings.json` *daquele profile*, vazio.
4. Cole primeiro o conteúdo de `profile-base.settings.json`, depois por cima (mesma chave de nível raiz, sem duplicar) o conteúdo do profile específico (`profile-angular-frontend.settings.json`, etc.).
5. Repita pros outros 2 profiles.

Depois de criado uma vez, trocar de profile é só clicar no seletor da barra de status ou `Ctrl+Shift+P` → **Profiles: Switch Profile** — não precisa reabrir o VS Code.

## Observação

Nenhum destes 4 arquivos configura extensões (Prettier, ESLint, CSharpier, GitLens, Error Lens, Todo Tree, Tailwind IntelliSense, Docker) — isso é o Settings JSON assumindo que a extensão já está instalada naquele profile. Se for criar o profile do zero numa máquina nova, instala a extensão primeiro (o VS Code avisa sozinho quando o setting referencia uma extensão ausente, ex: `"editor.defaultFormatter": "csharpier.csharpier-vscode"` sem o CSharpier instalado).