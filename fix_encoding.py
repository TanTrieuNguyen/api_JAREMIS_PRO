# -*- coding: utf-8 -*-
import codecs

file_path = r"d:\Ant's Folder\Code\JAREMIS\api_JAREMIS_PRO-main\server.js"

# Read file
with codecs.open(file_path, 'r', 'utf-8') as f:
    content = f.read()

# Remove the stray backtick on line 1632
content = content.replace('});\n`;\n\n// ========================================', '});\n\n// ========================================')

# Fix Vietnamese text
replacements = [
    ('YÃªu cáº§u Ä'Äƒng nháº­p', 'Yeu cau dang nhap'),
    ('KhÃ´ng tÃ¬m tháº¥y há»" sÆ¡ bá»‡nh nhÃ¢n', 'Khong tim thay ho so benh nhan'),
    ('Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p há»" sÆ¡ nÃ y', 'Ban khong co quyen truy cap ho so nay'),
    ('Lỗi tạo báo cáo', 'Loi tao bao cao'),
    ('âŒ', ''),
    ('✅', '')
]

for old, new in replacements:
    content = content.replace(old, new)

# Write back
with codecs.open(file_path, 'w', 'utf-8') as f:
    f.write(content)

print("Fixed encoding issues in server.js")
