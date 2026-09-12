# Kubernetes local (k3d) — prática completa, zero custo de nuvem

Este arquivo é sobre rodar o desenho decidido **na sua máquina**, sem AWS. Quando for pra nuvem de verdade, o desenho completo (EC2, Let's Encrypt, domínio real) já está em `docs-human/infra.md` — este arquivo aqui **não substitui aquele, é um estágio anterior**. Nada muda em `infra.md`.

## O que este arquivo NÃO cobre (leia antes de começar)

`template-ci` hoje não tem job de deploy em Kubernetes — `deploy-dotnet` usa `msdeploy.exe`, `deploy-angular-apache` usa `rsync`. Então, com o que existe hoje, dá pra validar cluster + operators + GitLab Agent conectado — mas o pipeline real (`ci-execucao.yml`) ainda não vai publicar sua aplicação dentro desse cluster. Isso exige um job novo (`deploy-kubernetes`, tipo `kubectl apply`/Helm) que ainda não existe — fica pra quando você mexer no `template-ci` por conta própria.

Pré-requisito: Docker Desktop rodando.

## 1. Instalar k3d

```powershell
winget install k3d
k3d version
```

## 2. Criar os 2 clusters (qa e hml, isolados — mesmo desenho da AWS, "Opção 3")

```powershell
k3d cluster create valuto-qa-local --agents 1
k3d cluster create valuto-hml-local --agents 1
kubectl config get-contexts
```

Troca de contexto entre os dois com `kubectl config use-context k3d-valuto-qa-local` (ou `-hml-local`).

## 3. cert-manager, com Issuer self-signed (sem Let's Encrypt)

Sem domínio público apontando pro seu IP de casa, Let's Encrypt não emite certificado nenhum — usa self-signed só pra validar o mecanismo. Repetir em cada cluster (troca o contexto antes):

```powershell
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager `
  --namespace cert-manager --create-namespace `
  --set installCRDs=true
```

```yaml
# cluster-issuer-selfsigned.yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned
spec:
  selfSigned: {}
```

```powershell
kubectl apply -f cluster-issuer-selfsigned.yaml
```

Traefik já vem de fábrica no k3d/k3s (não precisa instalar separado).

## 4. Os 4 operators — repetir em cada cluster (qa e hml)

**Aviso honesto:** URLs/versões abaixo são as mais recentes que conheço agora — confira na doc oficial de cada operator antes de rodar, isso muda com frequência e eu posso estar desatualizado.

**CloudNativePG (Postgres):**
```powershell
kubectl apply --server-side -f https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-1.24/releases/cnpg-1.24.1.yaml
kubectl get deploy -n cnpg-system
```

**Redis Operator (OT-ContainerKit):**
```powershell
helm repo add ot-helm https://ot-container-kit.github.io/helm-charts/
helm repo update
helm install redis-operator ot-helm/redis-operator --namespace redis-operator --create-namespace
```

**RabbitMQ Cluster Operator (oficial):**
```powershell
kubectl apply -f "https://github.com/rabbitmq/cluster-operator/releases/latest/download/cluster-operator.yml"
```

**Keycloak Operator (oficial keycloak.org):**
```powershell
kubectl create -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/main/kubernetes/keycloaks.k8s.keycloak.org-v1.yml
kubectl create -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/main/kubernetes/keycloakrealmimports.k8s.keycloak.org-v1.yml
kubectl create -f https://raw.githubusercontent.com/keycloak/keycloak-k8s-resources/main/kubernetes/kubernetes.yml
```

Depois de cada operator instalado, criar 1 `Cluster`/`Redis`/`RabbitmqCluster`/`Keycloak` CR mínimo (1 réplica) só pra confirmar que o operator provisiona de verdade.

## 5. GitLab Kubernetes Agent — conectar cada cluster no GitLab de verdade

No GitLab: projeto → Operate → Kubernetes clusters → Connect a cluster → escolhe/cria o nome do agent (ex: `valuto-qa-local`). Isso cria um token de registro.

No repo do projeto (ex: `valuto`, não `ai-base`/`infra`):
```yaml
# .gitlab/agents/valuto-qa-local/config.yaml
ci_access:
  projects:
    - id: personal.daniel.bmend/valuto
```

Instalar o agent dentro do cluster correspondente (repetir pro `hml`, com o agent/token do `hml`):
```powershell
helm repo add gitlab https://charts.gitlab.io
helm repo update
helm upgrade --install valuto-qa-local gitlab/gitlab-agent `
  --namespace gitlab-agent --create-namespace `
  --set config.token=<TOKEN_GERADO_NO_GITLAB> `
  --set config.kasAddress=wss://kas.gitlab.com
```

Confirma que funcionou: `kubectl get nodes` deve aparecer na aba Kubernetes do projeto no GitLab, mesmo sem porta nenhuma aberta no seu roteador — a conexão é de saída, do cluster pro GitLab.

## 6. O que dá pra validar hoje vs. o que fica faltando

**Dá pra validar agora:** os 2 clusters existem e são isolados, os 4 operators sobem de verdade (não é YAML teórico), o GitLab Agent conecta e o GitLab enxerga o cluster.

**Não dá ainda:** a esteira publicando sua aplicação dentro desses clusters — falta o job `deploy-kubernetes` no `template-ci`, que não existe hoje. Sem isso, `qa`/`hml` continuam "vazios" do ponto de vista da esteira, mesmo com cluster e operators de pé.

## 7. Quando for pra AWS de verdade

Reaproveita os manifests/Helm charts dos operators (passo 4) sem mudar nada — é o mesmo padrão. O que muda: cluster nasce em EC2 (não k3d), Let's Encrypt real (domínio público existe), e dados não vêm junto automaticamente — se quiser levar algo do cluster local, é `pg_dump`/restore manual. Desenho completo da AWS: `docs-human/infra.md` (não alterado por este arquivo).

## 8. Derrubar tudo

```powershell
k3d cluster delete valuto-qa-local
k3d cluster delete valuto-hml-local
```