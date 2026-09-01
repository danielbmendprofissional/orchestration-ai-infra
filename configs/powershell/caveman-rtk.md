## CONFIGURAÇÃO DO CAVEMAN

- Entre no CMD como Admin

```
npm install -g @caveman-ai/cli && caveman setup --install

caveman claude
caveman opencode
caveman hermes

npx skills add JuliusBrussee/caveman
```

## CONFIGURAÇÃO DO RTK

- Entre no PowerShell como Admin

```
# 1. Create a local bin directory
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.local\bin"

# 2. Download the latest Windows release zip
Invoke-WebRequest -Uri "https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip" -OutFile "$env:USERPROFILE\.local\bin\rtk.zip"

# 3. Extract rtk.exe
Expand-Archive -Path "$env:USERPROFILE\.local\bin\rtk.zip" -DestinationPath "$env:USERPROFILE\.local\bin" -Force

# 4. Clean up zip
Remove-Item "$env:USERPROFILE\.local\bin\rtk.zip"

# 5. Add to User PATH
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";$env:USERPROFILE\.local\bin", "User")
```

- Feche e abra o powershell como admin novamente

```
rtk --version
```

## CONFIGURAÇÃO DO RTK NO CLAUDE CODE

```
rtk init -g
```

## CONFIGURAÇÃO DO RTK NO OPEN CODE

```
npm install -g openrtk
```

- Adicionar no .config/opencode/opencode.json:

{
  "plugin": ["openrtk"]
}