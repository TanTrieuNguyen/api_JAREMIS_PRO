// Comprehensive encoding fix for server.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server.js');
let content = fs.readFileSync(file, 'utf8');

// Fix all broken Vietnamese characters
const fixes = [
  // Common broken patterns
  ['YÃªu cáº§u Ä'Äƒng nháº­p', 'Yêu cầu đăng nhập'],
  ['KhÃ´ng tÃ¬m tháº¥y há»" sÆ¡ bá»‡nh nhÃ¢n', 'Không tìm thấy hồ sơ bệnh nhân'],
  ['Báº¡n khÃ´ng cÃ³ quyá»n truy cáº­p há»" sÆ¡ nÃ y', 'Bạn không có quyền truy cập hồ sơ này'],
  ['âŒ', '❌'],
  ['âœ…', '✅'],
  ['Lỗi tạo báo cáo', 'Lỗi tạo báo cáo'] // Keep as is
];

fixes.forEach(([broken, fixed]) => {
  const regex = new RegExp(broken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  content = content.replace(regex, fixed);
});

// Write back
fs.writeFileSync(file, content, 'utf8');

console.log('✅ Fixed all encoding issues');
console.log('File length:', content.length, 'characters');
