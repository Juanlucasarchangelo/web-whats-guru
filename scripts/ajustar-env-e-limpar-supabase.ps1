# FalaComigo - limpeza controlada apos merge (PowerShell no Windows)
# Executar NA RAIZ do repositorio whats-guru:
#   powershell -ExecutionPolicy Bypass -File .\scripts\ajustar-env-e-limpar-supabase.ps1
# O script nao reinstala dependencias nem mexe no banco, frontend, Prisma ou chaves secretas.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$serverEnv = Join-Path $root 'server\.env'
if (-not (Test-Path -LiteralPath $serverEnv)) {
    throw "server/.env nao encontrado. Nao foi criada uma configuracao vazia para evitar perder credenciais."
}

# Atualiza somente valores afetados por copia/Markdown, preservando demais linhas,
# chaves secretas, senha MySQL, configuracao do NAS e configuracoes opcionais.
$content = [System.IO.File]::ReadAllText($serverEnv)
$original = $content
$lines = [regex]::Split($content, "\r?\n")
$changed = New-Object 'System.Collections.Generic.List[string]'
for ($i = 0; $i -lt $lines.Count; $i++) {
    $line = $lines[$i]
    # Corrige comentario acidentalmente copiado como '*# ... *'.
    if ($line -match '^\s*\*#\s*(.*?)\s*\*\s*$') {
        $lines[$i] = '# ' + $Matches[1]
        continue
    }
    if ($line -match '^\s*(CORS_ORIGINS|EVOLUTION_WEBHOOK_PUBLIC_URL)\s*=(.*)$') {
        $key = $Matches[1]
        $originalValue = $Matches[2]
        $val = $originalValue.Trim()
        # Uma URL copiada da conversa pode aparecer como [url](url).
        if ($key -eq 'EVOLUTION_WEBHOOK_PUBLIC_URL' -and $val -match '^\[([^\]]+)\]\(([^)]+)\)$') {
            $val = $Matches[2]
        }
        $val = $val.Replace('\:', ':').Replace('\/', '/')
        if ($val -ne $originalValue) {
            $lines[$i] = "$key=$val"
            $changed.Add($key)
        }
    }
}
$newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$newContent = [string]::Join($newline, $lines)
if ($newContent -cne $original) {
    # Escreve UTF-8 sem BOM. Valores secretos nao sao exibidos no terminal.
    [System.IO.File]::WriteAllText($serverEnv, $newContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'server/.env: formato corrigido (sem substituir credenciais).'
} else {
    Write-Host 'server/.env: nenhuma correcao necessaria.'
}

# A pasta supabase/ guarda antigas Edge Functions e migrations do banco Supabase.
# Ela nao e usada pela API MySQL ou pelo frontend atual; o adaptador
# src/lib/supabase.ts NAO deve ser excluido: ainda e importado pelas paginas.
$legacyDir = Join-Path $root 'supabase'
if (Test-Path -LiteralPath $legacyDir) {
    $marker = Join-Path $legacyDir 'config.toml'
    if (-not (Test-Path -LiteralPath $marker)) {
        throw 'supabase/ nao parece ser a pasta legada esperada. Exclusao cancelada.'
    }
    Remove-Item -LiteralPath $legacyDir -Recurse -Force
    Write-Host 'Pasta legada supabase/ removida.'
} else {
    Write-Host 'Pasta legada supabase/ nao existe; nada a remover.'
}
Write-Host 'Concluido. O adaptador MySQL src/lib/supabase.ts foi preservado.'
