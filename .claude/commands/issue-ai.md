---
description: Executa uma issue de melhoria do orchestration-ai neste repositório (ai-base, ai-infra, ai-ops ou template-ci) — plano, branch, implementação, MR; nunca mergeia
argument-hint: "<número da issue> [— instrução extra]"
---
Argumento: `$ARGUMENTS`. Rode **da raiz de um repositório do `orchestration-ai`** (`ai-base`, `ai-infra`, `ai-ops`, `ai-pipeline/template-ci`). Se a pasta atual é um projeto de produto (tem `specs/README.md` e `<projeto>-api/`), **pare**: este comando não vale ali; diga qual repositório abrir.

Processo e formato da issue: `ai-base/docs/agents/melhoria-orquestracao.md`.

## 1. Entender (nada é alterado ainda)

1. `glab issue view <n> --comments` neste repositório (`glab repo view` confirma qual é). Issue fechada, sem o label `melhoria` ou de outro repositório → pare.
2. Sincronize: `git fetch origin`; working tree sujo → pare e diga o que há.
3. Leia só o que a issue aponta, mais o `README.md`/`CLAUDE.md` do repositório e os testes existentes da área.
4. **Mostre o plano** em poucas linhas: o que muda (arquivos), o que fica de fora (o "Fora do escopo" da issue), como vai provar que funciona (teste ou comando), riscos (algo que reinicia contêiner, troca segredo, afeta outros projetos). Se a issue for ambígua, ou o plano passar do que ela pede → **pergunte antes** e espere.

Mudança que **altera algo em execução** (ex.: `apply` no `ai-infra`) ou **segredo**: peça o ok do humano a cada passo e mostre o diff antes; nunca leia nem imprima valor de credencial.

## 2. Fazer

- Branch `feature/issue-<n>-<slug>` a partir da branch padrão (`git symbolic-ref refs/remotes/origin/HEAD`). Nunca commite na branch padrão, nunca `--force`.
- Só o escopo da issue. Algo útil que sobrou → proponha outra issue (mesmo processo), não faça.
- Código ou script: teste primeiro quando o repositório tem onde testar (vermelho → verde); sem estrutura de teste, prove com o comando de verificação do repositório e cole a saída no relatório.
- Commits pequenos: `<tipo>: <o que fez> (issue #<n>)`.

## 3. Entregar

1. `git push -u origin <branch>` e MR para a branch padrão: título `<resumo> (#<n>)`, descrição com o que mudou, como foi provado, o que **não** mudou e o impacto em projetos (`origem:` e `bloqueia:` da issue).
2. `glab issue note <n> -m "MR: <link>. <como provar em 1 linha>"`.
3. Se a issue tem `bloqueia:<projeto>`: diga **qual fatia desse projeto espera este merge**.

## 4. Encerrar — sempre com este relatório

```
Issue #<n> — PRONTA PARA SUA REVISÃO     (ou: PAROU: precisa de você)
MR: <link> · branch feature/issue-<n>-… · repositório <repo>
Provado: <teste ou comando + resultado>
Impacto: <projetos/ambientes afetados; algo que exige reiniciar ou reaplicar>
Você agora: revisar e mergear a MR <e, se bloqueava, avisar a sessão do projeto: "melhoria #<n> mergeada">
```

Nunca mergeie, nunca feche a issue (o merge da MR fecha). Termine com `PushNotification` quando a sessão tiver.
