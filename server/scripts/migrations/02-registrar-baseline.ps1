# Marca migration como aplicada SEM executar o SQL (banco ja existe).
# So execute apos inspecao da baseline e alinhamento completo schema x MySQL.
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$prisma = '.\node_modules\.bin\prisma.cmd'
$version = '20261020_baseline_mysql_atual'
$folder = Join-Path '.\prisma\migrations' $version
if (-not (Test-Path (Join-Path $folder 'migration.sql'))) { throw 'Prepare a baseline primeiro com script 01.' }
$comparison = '.\prisma\migrations\REVISAO_SCHEMA_VS_MYSQL.sql'
if (-not (Test-Path $comparison)) { throw 'Arquivo de revisao nao encontrado. Execute script 01.' }
Write-Host 'AVISO: este passo grava _prisma_migrations no MySQL, sem aplicar tabelas.' -ForegroundColor Yellow
Write-Host 'Confirme que conferiu migration.sql, a comparacao e o backup.'
$answer = Read-Host 'Digite REGISTRAR para continuar'
if ($answer -cne 'REGISTRAR') { throw 'Cancelado. Nenhuma acao foi feita.' }
& $prisma migrate resolve --applied $version
if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar baseline.' }
& $prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'A baseline foi registrada, mas status apresentou erro. Investigue antes de prosseguir.' }
Write-Host 'Baseline registrada. Versione prisma/migrations no Git.' -ForegroundColor Green
