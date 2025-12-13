# Script to remove duplicate code blocks in server.js

$file = "d:\Ant's Folder\Code\JAREMIS\api_JAREMIS_PRO-main\server.js"
$content = Get-Content $file

# Find line numbers for duplicate sections
# Remove lines 1632-1793 (duplicate diagnose endpoint)

$newContent = @()
$skipLines = $false
$lineNum = 0

foreach ($line in $content) {
    $lineNum++
    
    # Start skipping at line 1632
    if ($lineNum -eq 1632) {
        $skipLines = $true
    }
    
    # Stop skipping at line 1794 (PATIENT MEDICAL RECORDS ENDPOINTS)
    if ($lineNum -eq 1794) {
        $skipLines = $false
    }
    
    if (-not $skipLines) {
        $newContent += $line
    }
}

# Write back
$newContent | Set-Content $file -Encoding UTF8

Write-Host "✅ Removed duplicate code blocks (lines 1632-1793)"
Write-Host "New file has $($newContent.Count) lines (was $($content.Count))"
