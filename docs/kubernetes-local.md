# Kubernetes local (k3d) — procedimento do agente

Valida cluster + operators + GitLab Agent conectado, na máquina local, zero custo de nuvem. Não é a arquitetura de produção (AWS/EC2/Let's Encrypt — fora do escopo de qualquer agent, decisão/execução do humano) e não deploya aplicação nenhuma dentro dos clusters — falta um job `deploy-kubernetes` no `template-ci` que ainda não existe.

Pré-requisito: Docker Desktop rodando (`docker info` responde). Se não: **parar aqui**, devolver pro humano — não tentar abrir o app sozinho (GUI).

## 1. Verificar o que já está instalado

```powershell
k3d version
kubectl version --client
helm version
docker info
```

## 2. Instalar o que faltou (um de cada vez, confirmando antes de seguir)

```powershell
winget install k3d
winget install Kubernetes.kubectl
winget install Helm.Helm
```

## 3. Confirmar com o humano antes de consumir recurso real

Antes de criar cluster: avisar que isso consome RAM/CPU real enquanto estiver de pé, e os nomes que serão usados (`<projeto>-qa-local`, `<projeto>-hml-local` — `<projeto>` = nome do projeto da vez). Só depois da confirmação, seguir.

## 4. Criar os 2 clusters (qa e hml, isolados)

```powershell
k3d cluster create <projeto>-qa-local --agents 1
k3d cluster create <projeto>-hml-local --agents 1
kubectl config get-contexts
```

Troca de contexto: `kubectl config use-context k3d-<projeto>-qa-local` (ou `-hml-local`).

## 5. cert-manager, Issuer self-signed (sem domínio público, sem Let's Encrypt)

Repetir em cada cluster (trocar contexto antes):

```powershell
helm repo add jetstack https://charts.jetstack.io
helm repo update
helm install cert-manager jetstack/cert-manager --namespace cert-manager --create-namespace --set installCRDs=true
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

Traefik já vem de fábrica no k3d/k3s — não instalar separado.

## 6. Os 4 operators — repetir em cada cluster

Confirmar versão/URL mais recente na doc oficial de cada operator antes de rodar — isso muda com frequência, não travar num link antigo por estar escrito aqui.

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

Depois de cada operator instalado: criar 1 CR mínimo (`Cluster`/`Redis`/`RabbitmqCluster`/`Keycloak`, 1 réplica) só pra confirmar que o operator provisiona de verdade.

## 7. GitLab Kubernetes Agent — sempre parar aqui

Token de registro só sai clicando na UI do GitLab (projeto → Operate → Kubernetes clusters → Connect a cluster). Não usar Personal Access Token pra isso via API mesmo sendo tecnicamente possível — escopo largo demais pra um agent segurar. **Parar aqui**, pedir pro humano gerar 1 token por cluster (2, um por ambiente) e colar de volta.

No repo do projeto (não em `ai-base`/`infra`):
```yaml
# .gitlab/agents/<projeto>-qa-local/config.yaml
ci_access:
  projects:
    - id: <namespace>/<projeto>
```

Instalar o agent dentro de cada cluster correspondente, com o token daquele ambiente:
```powershell
helm repo add gitlab https://charts.gitlab.io
helm repo update
helm upgrade --install <projeto>-qa-local gitlab/gitlab-agent --namespace gitlab-agent --create-namespace --set config.token=<TOKEN_GERADO_NO_GITLAB> --set config.kasAddress=wss://kas.gitlab.com
```

Confirmar: `kubectl get nodes` aparece na aba Kubernetes do projeto no GitLab (conexão de saída, sem porta nenhuma aberta no roteador).

## 8. Relatório final

O que foi instalado no passo 2, os 2 clusters no ar (nomes), os 4 operators confirmados (`kubectl get deploy`/`get pods` de cada namespace), Falco (se aplicável a esse contexto) subiu ou ficou de fora, confirmação dos 2 GitLab Agents conectados.

## Derrubar tudo (só sob pedido explícito)

```powershell
k3d cluster delete <projeto>-qa-local
k3d cluster delete <projeto>-hml-local
```