const fs = require('fs');
const path = require('path');

const htmlFile = 'public/index.html';
let content = fs.readFileSync(htmlFile, 'utf8');

// Pattern 1: Replace all escapeHtml( with window.escapeHtml( in template strings
// But be careful not to replace the function definition itself
content = content.replace(/([`"].*?\$\{)escapeHtml\(/g, '$1window.escapeHtml(');
content = content.replace(/(`[^`]*?)escapeHtml\(/g, '$1window.escapeHtml(');

// Replace in return statements and other places
const lines = content.split('\n');
const newLines = [];

for (let i = 0; i < lines.length; i++) {
  let line = lines[i];
  
  // Skip function definition lines
  if (line.includes('function escapeHtml(') || line.includes('return window.escapeHtml(str)')) {
    newLines.push(line);
    continue;
  }
  
  // Replace escapeHtml( with window.escapeHtml( in backticks and quotes
  if (line.includes('`') || line.includes('"') || line.includes("'")) {
    // Only replace if not in a comment
    if (!line.trim().startsWith('//') && !line.trim().startsWith('*')) {
      line = line.replace(/escapeHtml\(/g, 'window.escapeHtml(');
    }
  }
  
  newLines.push(line);
}

content = newLines.join('\n');

fs.writeFileSync(htmlFile, content, 'utf8');
console.log('✅ Fixed all escapeHtml references to window.escapeHtml');
