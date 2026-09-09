# backup-postgres.ps1
$ErrorActionPreference = "Stop"

$containerName = "postgres"
$pgUser = "postgres"  # ou o POSTGRES_USER do seu .env
$backupRoot = "C:\backups\postgres"
$driveRoot = "G:\My Drive\ia\backups\postgres"
$date = Get-Date -Format "yyyy-MM-dd"
$dayOfWeek = (Get-Date).DayOfWeek

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
New-Item -ItemType Directory -Force -Path $driveRoot | Out-Null

# Lista os bancos de projeto (exclui os internos do Postgres)
$databases = docker exec $containerName psql -U $pgUser -t -c "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');"
$databases = $databases -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }

foreach ($db in $databases) {
    $fileName = "$db-$date.sql"
    docker exec $containerName pg_dump -U $pgUser -d $db -F c -f "/tmp/$fileName"
    docker cp "${containerName}:/tmp/$fileName" "$backupRoot\$fileName"
    docker exec $containerName rm "/tmp/$fileName"
    Copy-Item "$backupRoot\$fileName" "$driveRoot\$fileName" -Force
}

# Globals (roles de cluster inteiro) — separado, sempre
$globalsFile = "globals-$date.sql"
docker exec $containerName pg_dumpall -U $pgUser --globals-only -f "/tmp/$globalsFile"
docker cp "${containerName}:/tmp/$globalsFile" "$backupRoot\$globalsFile"
docker exec $containerName rm "/tmp/$globalsFile"
Copy-Item "$backupRoot\$globalsFile" "$driveRoot\$globalsFile" -Force

# Rotação: sempre mantém os 7 últimos arquivos por banco (diário).
# Aos domingos, copia uma cópia extra pra pasta "semanal", mantendo só as últimas 4.
if ($dayOfWeek -eq "Sunday") {
    $weeklyRoot = "$driveRoot\semanal"
    New-Item -ItemType Directory -Force -Path $weeklyRoot | Out-Null
    Get-ChildItem "$driveRoot\*.sql" | Where-Object { $_.Name -match $date } | ForEach-Object {
        Copy-Item $_.FullName "$weeklyRoot\$($_.Name)" -Force
    }
    $oldWeekly = Get-ChildItem "$weeklyRoot\*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -Skip 28  # 4 semanas x até 7 arquivos
    $oldWeekly | Remove-Item -Force
}

# Rotação diária: mantém só os últimos 7 dias na pasta raiz
$cutoff = (Get-Date).AddDays(-7)
Get-ChildItem "$driveRoot\*.sql" | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force
Get-ChildItem "$backupRoot\*.sql" | Where-Object { $_.LastWriteTime -lt $cutoff } | Remove-Item -Force