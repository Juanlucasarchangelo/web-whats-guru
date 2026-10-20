# Verifica se as migracoes correspondem ao banco (somente leitura).
$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))
$prisma = '.\node_modules\.bin\prisma.cmd'
& $prisma migrate status
if ($LASTEXITCODE -ne 0) { throw 'migrate status falhou.' }
$path = '.\prisma\migrations\REVISAO_SCHEMA_VS_MYSQL.sql'
& $prisma migrate diff --from-schema-datamodel '.\prisma\schema.prisma' --to-schema-datasource '.\prisma\schema.prisma' --script | Out-File -FilePath $path -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'migrate diff falhou.' }
Write-Host "Revisar $path (comandos SQL indicam diferencas)." -ForegroundColor Yellow
