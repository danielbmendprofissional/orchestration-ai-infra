# Kubernetes local (k3d) — procedimento do agente

Comandos exatos ficam em `docs-human/kubernetes-local.md` — este arquivo é só a ordem/regra de quando parar e pedir humano. Nunca pular direto pros comandos sem seguir as 5 fases abaixo, nessa ordem.

## 1. Verificar o que já está instalado

Rodar, sem instalar nada ainda:
```powershell
k3d version
kubectl version --client
helm version
docker info
```
Cada um responde versão ou falha. `docker info` falhando = Docker Desktop não está rodando — **parar aqui e voltar pro humano**, não tentar abrir o app sozinho (GUI, fora do que um agente de terminal deve tentar).

## 2. Instalar o que faltar

Só o que faltou no passo 1, um de cada vez, confirmando que instalou antes de seguir pro próximo:
```powershell
winget install k3d
winget install Kubernetes.kubectl
winget install Helm.Helm
```
Não instalar Docker Desktop sozinho — é o único item do passo 1 que, se faltar, encerra o procedimento ali.

## 3. Confirmar com o humano antes de qualquer coisa que consome recurso real

Antes de criar os clusters (passo seguinte), avisar explicitamente o que vai rodar e esperar confirmação — não seguir direto:
- Nomes dos 2 clusters (`valuto-qa-local`, `valuto-hml-local`, ou o padrão `<projeto>-<ambiente>-local` que valer pro projeto da vez).
- Que isso consome RAM/CPU real da máquina enquanto estiver de pé.

Só depois da confirmação: criar os clusters, cert-manager self-signed, os 4 operators — comandos exatos em `docs-human/kubernetes-local.md`, seções 2 a 4. Se o Falco (seção 4) falhar ao subir, não insistir — comentar o serviço, registrar no relatório final (passo 5), seguir sem ele.

## 4. Solicitar configuração humana — o único ponto sem alternativa automatizável

Registrar o GitLab Kubernetes Agent (`docs-human/kubernetes-local.md`, seção 5) exige um token que só sai clicando na UI do GitLab (Operate → Kubernetes clusters → Connect a cluster) — não usar Personal Access Token pra fazer isso via API, mesmo sendo tecnicamente possível, escopo largo demais pra um agente segurar.

Parar exatamente aqui: pedir pro humano gerar o token de cada cluster (2, um por ambiente) e colar de volta. Não seguir sem os 2 tokens.

## 5. Devolver pro humano

Relatório final, curto: o que foi instalado no passo 2, os 2 clusters no ar (nomes), os 4 operators confirmados rodando (`kubectl get deploy`/`get pods` de cada namespace), se o Falco subiu ou ficou de fora, e confirmação de que os 2 GitLab Agents conectaram (`kubectl get nodes` aparecendo na aba Kubernetes do projeto).

## O que este procedimento não cobre

Publicar aplicação de verdade dentro desses clusters — falta o job `deploy-kubernetes` no `template-ci`, que não existe ainda (ver `docs-human/pendencias.md`). Esse procedimento só deixa cluster+operators+Agent prontos, não deploya nada além disso.