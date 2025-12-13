const fs = require('fs');
const path = require('path');

const htmlFile = 'public/index.html';
const content = fs.readFileSync(htmlFile, 'utf8');

const issues = [];

// Issue 1: Check for unclosed tags
const openTags = (content.match(/<div[^>]*(?<!\/\s*>)>/g) || []).length;
const closeTags = (content.match(/<\/div>/g) || []).length;
if (openTags !== closeTags) {
  issues.push(`Mismatched div tags: ${openTags} open vs ${closeTags} close`);
}

// Issue 2: Check for unquoted attributes
const unquotedAttrs = content.match(/\w+:\w+(?!["\'])/g) || [];
if (unquotedAttrs.length > 0) {
  issues.push(`Found potentially unquoted attributes: ${unquotedAttrs.slice(0, 3).join(', ')}`);
}

// Issue 3: Check for missing onclick handlers
const onclickMissing = (content.match(/onclick="[^"]*undefined[^"]*"/g) || []).length;
if (onclickMissing > 0) {
  issues.push(`Found ${onclickMissing} onclick handlers with 'undefined'`);
}

// Issue 4: Check for template literals with undefined variables
const undefinedVars = (content.match(/\$\{\s*\w+\s*\}/g) || []).filter(v => 
  !['record', 'title', 'timeLabel', 'sess', 'entry', 'message', 'visit', 'med', 'result', 'item', 'r', 'index', 'visitNum', 'shortTitle', 'c', 'drug', 'tr', 'a', 'patientId', 'doctor', 'patientInfo', 'latestRecord', 'latestVisit', 'sortedConsultations'].some(v2 => v.includes(v2))
);
if (undefinedVars.length > 0) {
  issues.push(`Potentially undefined template variables: ${undefinedVars.slice(0, 3).join(', ')}`);
}

// Issue 5: Check for missing closing script tags
const scriptOpens = (content.match(/<script/g) || []).length;
const scriptCloses = (content.match(/<\/script>/g) || []).length;
if (scriptOpens !== scriptCloses) {
  issues.push(`Mismatched script tags: ${scriptOpens} open vs ${scriptCloses} close`);
}

// Issue 6: Check for unclosed style tags
const styleOpens = (content.match(/<style/g) || []).length;
const styleCloses = (content.match(/<\/style>/g) || []).length;
if (styleOpens !== styleCloses) {
  issues.push(`Mismatched style tags: ${styleOpens} open vs ${styleCloses} close`);
}

// Issue 7: Check for orphaned closing tags
const orphanedClosing = (content.match(/<\/\w+>/g) || []).filter(tag => {
  const tagName = tag.match(/\w+/)[0];
  const openCount = (content.match(new RegExp(`<${tagName}[^>]*>`, 'g')) || []).length;
  const closeCount = (content.match(new RegExp(`</${tagName}>`, 'g')) || []).length;
  return closeCount > openCount;
});
if (orphanedClosing.length > 0) {
  issues.push(`Found ${orphanedClosing.length} orphaned closing tags`);
}

// Issue 8: Check for duplicate IDs
const ids = content.match(/id=["\']([^"\']+)["\']/g) || [];
const idValues = ids.map(id => id.match(/["\']([^"\']+)["\']/)[1]);
const duplicateIds = idValues.filter((id, idx) => idValues.indexOf(id) !== idx);
if (duplicateIds.length > 0) {
  issues.push(`Found duplicate IDs: ${[...new Set(duplicateIds)].slice(0, 3).join(', ')}`);
}

// Issue 9: Check for missing img alt attributes
const imgsWithoutAlt = (content.match(/<img(?!.*alt=)[^>]*>/g) || []).length;
if (imgsWithoutAlt > 0) {
  issues.push(`Found ${imgsWithoutAlt} img tags without alt attribute`);
}

// Issue 10: Check for inline event handlers with syntax errors
const invalidHandlers = (content.match(/on\w+="[^"]*;[^"]*"/g) || []).filter(handler => {
  return handler.includes(';;') || handler.includes(')}');
});
if (invalidHandlers.length > 0) {
  issues.push(`Found ${invalidHandlers.length} potentially invalid event handlers`);
}

console.log('🔍 HTML Issue Analysis:');
console.log('========================\n');

if (issues.length === 0) {
  console.log('✅ No major issues detected!\n');
} else {
  issues.forEach((issue, idx) => {
    console.log(`❌ Issue ${idx + 1}: ${issue}`);
  });
}

console.log('\n📊 Statistics:');
console.log(`- Total characters: ${content.length}`);
console.log(`- Lines: ${content.split('\n').length}`);
console.log(`- Script tags: ${scriptOpens}`);
console.log(`- Style tags: ${styleOpens}`);
