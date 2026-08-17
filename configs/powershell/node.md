## CONFIGURAÇÃO DO NODE

## DESINTALAR TUDO

- Entre no PowerShell como Admin

```
npm uninstall -g @angular/cli

nvm list
nvm uninstall xx.xx.x --list results
```

# Enviroment Variables

Remover os caminhos dentro do PATH que apontem para nvm ou npm.
Remover esses mesmos caminhos no explorer path fisico.

# Instalação

* [URL](https://github.com/coreybutler/nvm-windows/releases)

- Download nvm-setup.exe

- nvm use xxxx

- Feche o PowerShell e abra novamente como Admin:

```
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

nvm root

npm --version
node --version
nvm --version

```