# Executar na pasta server: .\scripts\migrations\01-preparar-baseline.ps1
# Nao executa CREATE/DROP/ALTER no MySQL. Apenas gera arquivos SQL locais.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$schema = '.\prisma\schema.prisma'
if (-not (Test-Path '.\.env')) { throw 'Arquivo server/.env ausente. Configure DATABASE_URL antes.' }
if (-not (Test-Path '.\node_modules\.bin\prisma.cmd')) { throw 'Execute npm install em server primeiro.' }
$prisma = '.\node_modules\.bin\prisma.cmd'
& $prisma validate --schema $schema
if ($LASTEXITCODE -ne 0) { throw 'Schema invalido. Processo interrompido.' }
$folderName = '20261020_baseline_mysql_atual'
$target = Join-Path '.\prisma\migrations' $folderName
if (Test-Path $target) { throw "Migration $folderName ja existe. Nao sobrescrever uma migration versionada." }
New-Item -ItemType Directory -Force -Path $target | Out-Null
$baselineFile = Join-Path $target 'migration.sql'
# A fonte e o MySQL REAL, com indices e FKs, nao uma suposicao baseada apenas nos modelos.
& $prisma migrate diff --from-empty --to-schema-datasource $schema --script | Out-File -FilePath $baselineFile -Encoding utf8
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $baselineFile) -or (Get-Item $baselineFile).Length -lt 100) {
  Remove-Item -Recurse -Force $target
  throw 'Nao foi possivel gerar a baseline. Nenhuma alteracao foi feita no banco.'
}
$lock = '.\prisma\migrations\migration_lock.toml'
if (-not (Test-Path $lock)) { Set-Content -Path $lock -Value '# Please do not edit manually\nprovider = "mysql"' -Encoding ascii }
$reviewPath = '.\prisma\migrations\REVISAO_SCHEMA_VS_MYSQL.sql'
& $prisma migrate diff --from-schema-datamodel $schema --to-schema-datasource $schema --script | Out-File -FilePath $reviewPath -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Erro ao comparar schema e MySQL. Revise manualmente a baseline.' }
Write-Host ''
Write-Host "Baseline criada em $baselineFile" -ForegroundColor Green
Write-Host "Comparacao criada em $reviewPath" -ForegroundColor Yellow
Write-Host 'IMPORTANTE: NAO execute migrate resolve ate revisar a comparacao e aprovar a baseline.'
Write-Host 'Se REVISAO_SCHEMA_VS_MYSQL.sql tiver comandos ALTER/DROP/CREATE, o schema nao corresponde ao banco.'
Write-Host 'Execute 02-registrar-baseline.ps1 somente apos resolver essas diferencas.'
