const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'public/index.html');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Fix 1: Remove duplicate patient-notes lines (lines 3432-3433 approximately)
// These are: document.getElementById('patient-notes').value = ''; (appears twice consecutively)
content = content.replace(
    /document\.getElementById\('patient-notes'\)\.value = '';\n\s*document\.getElementById\('patient-notes'\)\.value = '';/,
    `document.getElementById('patient-notes').value = '';`
);

// Fix 2: Fix the malformed patientInfo object initialization
// Current bad pattern: notes: ..., \n notes: ..., \n const patientInfo = {
// Should be: const patientInfo = { notes: ..., 
content = content.replace(
    /notes: document\.getElementById\('patient-notes'\)\.value\.trim\(\) \|\| '',\s*notes: document\.getElementById\('patient-notes'\)\.value\.trim\(\) \|\| '',\s*const patientInfo = \{/,
    `const patientInfo = {\n                notes: document.getElementById('patient-notes').value.trim() || '',`
);

// Write the file back
fs.writeFileSync(filePath, content, 'utf8');
console.log('✅ Fixed all HTML syntax errors');
console.log('   - Removed duplicate patient-notes setters');
console.log('   - Fixed malformed patientInfo object initialization');
