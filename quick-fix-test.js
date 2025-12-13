#!/usr/bin/env node

/**
 * JAREMIS PRO - Quick Test Script
 * Kiểm tra nhanh các chức năng đã fix
 */

console.log('🧪 JAREMIS PRO - Quick Test\n');

// Test 1: Check if critical functions exist
console.log('📋 Test 1: Checking critical functions...');
const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public', 'index.html');
const serverPath = path.join(__dirname, 'server.js');

if (!fs.existsSync(indexPath)) {
  console.error('❌ public/index.html not found!');
  process.exit(1);
}

if (!fs.existsSync(serverPath)) {
  console.error('❌ server.js not found!');
  process.exit(1);
}

const indexContent = fs.readFileSync(indexPath, 'utf8');
const serverContent = fs.readFileSync(serverPath, 'utf8');

// Check for event listeners
const hasEventListeners = indexContent.includes('sendBtn.addEventListener') && 
                          indexContent.includes('submitPatientBtn.addEventListener');
console.log(hasEventListeners ? '✅ Event listeners found' : '❌ Event listeners missing');

// Check for safe rendering
const hasSafeRender = indexContent.includes('result.replyHtml || result.reply || ');
console.log(hasSafeRender ? '✅ Safe rendering found' : '⚠️  Safe rendering might be missing');

// Check for profile functions
const hasAvatarUpload = indexContent.includes('handleAvatarUpload');
const hasSaveProfile = indexContent.includes('async function saveProfile');
const hasRemoveAvatar = indexContent.includes('removeAvatar');
console.log(hasAvatarUpload ? '✅ Avatar upload handler found' : '❌ Avatar upload missing');
console.log(hasSaveProfile ? '✅ Save profile function found' : '❌ Save profile missing');
console.log(hasRemoveAvatar ? '✅ Remove avatar function found' : '❌ Remove avatar missing');

// Check for API endpoint
const hasCheckUsername = serverContent.includes("/api/check-username");
console.log(hasCheckUsername ? '✅ Check username API found' : '❌ Check username API missing');

// Check for modal IDs
const hasPatientModalBtn = indexContent.includes('id="submit-patient-info-btn"');
console.log(hasPatientModalBtn ? '✅ Patient modal button ID found' : '❌ Patient modal button ID missing');

// Check for validation
const hasUsernameValidation = indexContent.includes('/^[a-zA-Z0-9_-]+$/');
console.log(hasUsernameValidation ? '✅ Username validation found' : '❌ Username validation missing');

// Test 2: Check for common issues
console.log('\n📋 Test 2: Checking for common issues...');

const hasUnsafeAccess = indexContent.match(/result\.message\s/g);
console.log(!hasUnsafeAccess ? '✅ No unsafe result.message access' : '⚠️  Found unsafe access to result.message');

const hasFlashNotice = indexContent.includes('function flashNotice');
console.log(hasFlashNotice ? '✅ Flash notice function found' : '❌ Flash notice missing');

// Test 3: Count critical functions
console.log('\n📋 Test 3: Function counts...');

const submitDataCount = (indexContent.match(/function submitData\(/g) || []).length;
const saveProfileCount = (indexContent.match(/function saveProfile\(/g) || []).length;
const flashNoticeCount = (indexContent.match(/function flashNotice\(/g) || []).length;

console.log(`submitData functions: ${submitDataCount} ${submitDataCount === 1 ? '✅' : '⚠️  (expected 1)'}`);
console.log(`saveProfile functions: ${saveProfileCount} ${saveProfileCount === 1 ? '✅' : '⚠️  (expected 1)'}`);
console.log(`flashNotice functions: ${flashNoticeCount} ${flashNoticeCount >= 1 ? '✅' : '❌'}`);

// Summary
console.log('\n' + '='.repeat(50));
console.log('📊 SUMMARY');
console.log('='.repeat(50));

const allChecks = [
  hasEventListeners,
  hasSafeRender,
  hasAvatarUpload,
  hasSaveProfile,
  hasRemoveAvatar,
  hasCheckUsername,
  hasPatientModalBtn,
  hasUsernameValidation,
  !hasUnsafeAccess,
  hasFlashNotice,
  submitDataCount === 1,
  saveProfileCount === 1,
  flashNoticeCount >= 1
];

const passed = allChecks.filter(Boolean).length;
const total = allChecks.length;
const percentage = ((passed / total) * 100).toFixed(1);

console.log(`\n✅ Passed: ${passed}/${total} (${percentage}%)`);

if (passed === total) {
  console.log('\n🎉 All checks passed! Ready to test in browser.');
  console.log('\n📝 Next steps:');
  console.log('   1. Run: npm start');
  console.log('   2. Open: http://localhost:3000');
  console.log('   3. Follow test guide in FIX_SUMMARY_COMPLETE.md');
} else {
  console.log('\n⚠️  Some checks failed. Please review the code.');
  console.log('\n📝 See FIX_SUMMARY_COMPLETE.md for details.');
}

console.log('\n' + '='.repeat(50));
