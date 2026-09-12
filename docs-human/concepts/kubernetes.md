# Kubernetes - concepts

# Container e Pod
- Eu tenho ou gero uma imagem (postgres ou build .net) e envio ela para algum container registry, meu caso é o 
GitLab Container Registry.

- Pod seria um detentor de um container

# Workload

- Ai eu escrevo um manifesto de workload, que podem variar em 4 tipos cada um com varias possibilidades:
    
    - Deployment: para coisas que não guarda nada importante dentro dela (dado, identidade, etc), se um pod morrer sobe outro do zero com a mesma imagem sem alterações, por isso pode ter varias copias identicas rodando (réplica) -> API .net, Angular

    - StatefulSet: Para aplicações com estado e identidade (nome fixo), por exemplo esse POD é dono desse disco (onde salva dados, etc) se esse pod acabar morrendo vai subir um outro pod apontando para o mesmo disco -> postgres, redis, etc..

    - DaemonSet: para aplicações que precisam rodar em todos os nós do cluster, 1 aplicação por nó, precisa estar em todo lugar, o tempo todo -> falcos, log, etc...

    - Job/CronJob: não fica vivo para sempre, roda uma vez ou agendado e depois morre -> backup, kube-bench (scan de segurança).

- Esse manifesto de worload na maioria dos casos define o "comportamento" de um "container" por exemplo:

    - Deployment "api-dotnet" (Workload 1 - lidando com o container da imagem .net)
        → 3 Pods (réplicas)
        → cada um rodando o container da imagem .NET

    - Deployment "front-angular" (Workload 2 - lidando com o container da imagem Angular)
        → 2 Pods (réplicas)
        → cada um rodando o container da imagem Angular (Nginx servindo os arquivos)

# Node

- Com os worloads montados entra o node (nó) - Maquina virtual, servidor que contém a CPU/RAM que vai rodar os pods.
    - Podem rodar N pods em N nodes
    - Não importa worflow ou ordem é simplesmente todos os pods de todos worflows rodando em todos os nodes disponíveis.
    - multi-nodes é bom para gerenciar em caso de falhas, imagine 1 único node rodando todos os pods e esse node falha, já era.

# Cluster

- Tem dentro dele um control plane que gerencia os workres, pods, nodes, components compratilhados etc.

- É um enviroment de nodes, os worker nodes, então são um monte de servidores, VMs, gerenciados em um mesmo enviroment, eles conversam entre si, etc.