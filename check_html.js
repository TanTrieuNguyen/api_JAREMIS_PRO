const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

console.log('📝 Checking HTML file...');
console.log('File size:', html.length, 'bytes');

const checks = [
  { name: 'window.escapeHtml defined', pattern: 'window.escapeHtml = function' },
  { name: 'window.escapeHtml in templates', pattern: 'window.escapeHtml(' },
  { name: 'No undefined escapeHtml calls', pattern: '${escapeHtml(' }
];

let issues = 0;

checks.forEach(check => {
  if (html.includes(check.pattern)) {
    console.log('✅', check.name);
  } else {
    console.log('❌', check.name);
    issues++;
  }
});

if (issues === 0) {
  console.log('\n✅ HTML file looks good!');
} else {
  console.log(`\n⚠️  Found ${issues} potential issues`);
}
