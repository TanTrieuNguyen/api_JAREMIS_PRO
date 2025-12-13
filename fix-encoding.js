// Fix encoding issues in server.js
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server.js');
let content = fs.readFileSync(file, 'utf8');

// Count occurrences before
const before = {
  broken1: (content.match(/âŒ/g) || []).length,
  broken2: (content.match(/âœ…/g) || []).length,
  broken3: (content.match(/Lá»—i táº¡o bÃ¡o cÃ¡o/g) || []).length
};

// Fix broken Unicode
content = content.replace(/âŒ/g, '❌');
content = content.replace(/âœ…/g, '✅');
content = content.replace(/Lá»—i táº¡o bÃ¡o cÃ¡o/g, 'Lỗi tạo báo cáo');

// Count after
const after = {
  fixed1: (content.match(/❌/g) || []).length,
  fixed2: (content.match(/✅/g) || []).length,
  fixed3: (content.match(/Lỗi tạo báo cáo/g) || []).length
};

// Write back
fs.writeFileSync(file, content, 'utf8');

console.log('✅ Fixed encoding issues:');
console.log('  - Broken ❌:', before.broken1, '→ Fixed:', after.fixed1);
console.log('  - Broken ✅:', before.broken2, '→ Fixed:', after.fixed2);
console.log('  - Broken text:', before.broken3, '→ Fixed:', after.fixed3);
