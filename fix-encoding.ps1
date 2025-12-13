# Fix encoding issues in server.js

$file = "d:\Ant's Folder\Code\JAREMIS\api_JAREMIS_PRO-main\server.js"

# Read with original encoding
$content = Get-Content $file -Raw -Encoding UTF8

# Fix broken Unicode characters
$content = $content -replace 'âŒ', '❌'
$content = $content -replace 'âœ…', '✅'
$content = $content -replace 'Lá»—i táº¡o bÃ¡o cÃ¡o', 'Lỗi tạo báo cáo'

# Write back with UTF-8 without BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($file, $content, $utf8NoBom)

Write-Host "✅ Fixed encoding issues"
