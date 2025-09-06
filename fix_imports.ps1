# Recursively replace Windows absolute path imports with the module import path.
# Run from repo root in PowerShell:
#   .\fix_imports.ps1
param(
    [string]$Module = 'github.com/xashathebest/clovia',
    [switch]$DryRun = $false
)

Get-ChildItem -Recurse -Filter *.go | ForEach-Object {
    $path = $_.FullName
    $orig = Get-Content -Raw -LiteralPath $path
    $new = $orig

    # 1) Replace Windows absolute path variants with module path
    $new = $new -replace '(?i)c:\\\\xampp\\\\htdocs\\\\Clovia', $Module
    $new = $new -replace '(?i)c:/xampp/htdocs/Clovia', $Module

    # 2) Normalize repeated slashes/backslashes inside quoted import strings for the module.
    #    Matches "...github.com/xashathebest/clovia[/\]+...": collapse to single forward slash.
    $pattern = '"([^"]*' + [regex]::Escape($Module) + ')[/\\]+([^"]*)"'
    $new = [regex]::Replace($new, $pattern, '"$1/$2"')

    # 3) As a safety, collapse any occurrences of double slashes inside module path segments (avoid http:// by restricting to module prefix)
    $new = [regex]::Replace($new, [regex]::Escape($Module) + '[/\\]{2,}', $Module + '/')

    if ($new -ne $orig) {
        if ($DryRun) {
            Write-Host "[DryRun] Would patch imports in $path"
        } else {
            Copy-Item -LiteralPath $path -Destination ($path + '.bak') -Force
            Set-Content -LiteralPath $path -Value $new
            Write-Host "Patched imports in $path (backup saved as $path.bak)"
        }
    }
}
