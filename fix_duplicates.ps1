# Script to fix all duplicate variable declarations
$content = Get-Content server.js

# Find and fix all duplicate variable patterns
$variables = @('sensitiveRegex', 'isSensitive', 'reassuranceBlock', 'systemPrompt', 'historySection')

foreach ($var in $variables) {
    $lines = Select-String -Pattern "const $var" -Path server.js | ForEach-Object { $_.LineNumber }
    for ($i = 1; $i -lt $lines.Count; $i++) {
        $lineIndex = $lines[$i] - 1
        $suffix = $i + 1
        $content[$lineIndex] = $content[$lineIndex] -replace "const $var", "const $var$suffix"
        Write-Host "Fixed $var at line $($lines[$i]) -> $var$suffix"
        
        # Find and update usages in the same block
        $startLine = $lines[$i]
        $endLine = if ($i + 1 -lt $lines.Count) { $lines[$i + 1] } else { $content.Count }
        
        for ($j = $startLine; $j -lt $endLine -and $j -lt $content.Count; $j++) {
            if ($content[$j] -match "= $var[^0-9]" -and $j -ne $lineIndex) {
                $content[$j] = $content[$j] -replace "$var\b", "$var$suffix"
                Write-Host "  Updated usage at line $($j + 1)"
            }
            if ($content[$j] -match "\$\{$var\}" -and $j -ne $lineIndex) {
                $content[$j] = $content[$j] -replace "$var", "$var$suffix"
                Write-Host "  Updated template usage at line $($j + 1)"
            }
        }
    }
}

$content | Set-Content server.js
Write-Host "All duplicates fixed!"
