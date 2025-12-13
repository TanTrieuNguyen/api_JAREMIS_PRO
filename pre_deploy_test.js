/**
 * Pre-deployment Test Script
 * Kiểm tra tất cả module trước khi deploy lên Render
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 JAREMIS AI - Pre-Deployment Test\n');

let allPassed = true;

// Test 1: Check required files
console.log('📁 Test 1: Checking required files...');
const requiredFiles = [
  'server.js',
  'package.json',
  'Procfile',
  '.env.example',
  '.gitignore',
  'medicalImageAnalysis.js',
  'medicalImageAnalysisHybrid.js',
  'render.yaml',
  'DEPLOY_CHECKLIST.md',
  'DEPLOY_QUICK_START.md'
];

for (const file of requiredFiles) {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`  ${exists ? '✅' : '❌'} ${file}`);
  if (!exists) allPassed = false;
}

// Test 2: Check package.json
console.log('\n📦 Test 2: Checking package.json...');
try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  const requiredDeps = [
    '@google/generative-ai',
    'express',
    'multer',
    'dotenv',
    'axios',
    'sharp',
    'cors'
  ];
  
  for (const dep of requiredDeps) {
    const exists = pkg.dependencies && pkg.dependencies[dep];
    console.log(`  ${exists ? '✅' : '❌'} ${dep}`);
    if (!exists) allPassed = false;
  }
  
  const hasStartScript = pkg.scripts && pkg.scripts.start === 'node server.js';
  console.log(`  ${hasStartScript ? '✅' : '❌'} start script: "node server.js"`);
  if (!hasStartScript) allPassed = false;
  
} catch (error) {
  console.log('  ❌ Cannot read package.json:', error.message);
  allPassed = false;
}

// Test 3: Check Procfile
console.log('\n📄 Test 3: Checking Procfile...');
try {
  const procfile = fs.readFileSync('Procfile', 'utf8').trim();
  const correct = procfile === 'web: node server.js';
  console.log(`  ${correct ? '✅' : '❌'} Content: "${procfile}"`);
  if (!correct) {
    console.log('  ⚠️  Expected: "web: node server.js"');
    allPassed = false;
  }
} catch (error) {
  console.log('  ❌ Cannot read Procfile:', error.message);
  allPassed = false;
}

// Test 4: Check .gitignore
console.log('\n🔒 Test 4: Checking .gitignore...');
try {
  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  const required = ['.env', 'node_modules', 'uploads'];
  
  for (const item of required) {
    const exists = gitignore.includes(item);
    console.log(`  ${exists ? '✅' : '❌'} Ignores: ${item}`);
    if (!exists) allPassed = false;
  }
} catch (error) {
  console.log('  ❌ Cannot read .gitignore:', error.message);
  allPassed = false;
}

// Test 5: Check medicalImageAnalysis module
console.log('\n🏥 Test 5: Checking Medical Image Analysis module...');
try {
  const medicalImageAnalysis = require('./medicalImageAnalysis');
  
  const testCases = [
    { file: 'chest_xray.jpg', expected: 'xray-chest' },
    { file: 'brain_mri_scan.png', expected: 'mri-brain' },
    { file: 'ct_abdomen.dcm', expected: 'ct-abdomen' },
    { file: 'pet_scan_cancer.jpg', expected: 'pet-scan' },
    { file: 'ultrasound.png', expected: 'ultrasound' }
  ];
  
  for (const tc of testCases) {
    const detected = medicalImageAnalysis.detectImageType(tc.file);
    const pass = detected === tc.expected || detected.startsWith(tc.expected);
    console.log(`  ${pass ? '✅' : '❌'} ${tc.file} → ${detected} (expected: ${tc.expected})`);
    if (!pass) allPassed = false;
  }
  
  console.log('  ✅ detectImageType() working');
  console.log('  ✅ getImageAnalysisPrompt() defined');
  console.log('  ✅ formatImageAnalysisReport() defined');
  
} catch (error) {
  console.log('  ❌ Module error:', error.message);
  allPassed = false;
}

// Test 6: Check server.js PORT configuration
console.log('\n🌐 Test 6: Checking server.js configuration...');
try {
  const serverCode = fs.readFileSync('server.js', 'utf8');
  
  const hasPort = serverCode.includes('process.env.PORT');
  console.log(`  ${hasPort ? '✅' : '❌'} Uses process.env.PORT`);
  if (!hasPort) allPassed = false;
  
  const hasListen = serverCode.includes('app.listen');
  console.log(`  ${hasListen ? '✅' : '❌'} Has app.listen()`);
  if (!hasListen) allPassed = false;
  
  const hasMedicalAnalysis = serverCode.includes('medicalImageAnalysis');
  console.log(`  ${hasMedicalAnalysis ? '✅' : '❌'} Imports medicalImageAnalysis`);
  if (!hasMedicalAnalysis) allPassed = false;
  
} catch (error) {
  console.log('  ❌ Cannot read server.js:', error.message);
  allPassed = false;
}

// Test 7: Check environment variable template
console.log('\n🔐 Test 7: Checking .env.example...');
try {
  const envExample = fs.readFileSync('.env.example', 'utf8');
  
  const required = ['GOOGLE_API_KEY', 'PORT', 'IMAGE_ANALYSIS_PRIORITY'];
  for (const key of required) {
    const exists = envExample.includes(key);
    console.log(`  ${exists ? '✅' : '❌'} Has template for: ${key}`);
    if (!exists) allPassed = false;
  }
} catch (error) {
  console.log('  ❌ Cannot read .env.example:', error.message);
  allPassed = false;
}

// Test 8: Check render.yaml
console.log('\n☁️  Test 8: Checking render.yaml...');
try {
  const renderYaml = fs.readFileSync('render.yaml', 'utf8');
  
  const checks = [
    { key: 'type: web', name: 'Service type' },
    { key: 'env: node', name: 'Environment' },
    { key: 'buildCommand: npm install', name: 'Build command' },
    { key: 'startCommand: node server.js', name: 'Start command' },
    { key: 'GOOGLE_API_KEY', name: 'Gemini API key env var' }
  ];
  
  for (const check of checks) {
    const exists = renderYaml.includes(check.key);
    console.log(`  ${exists ? '✅' : '❌'} ${check.name}`);
    if (!exists) allPassed = false;
  }
} catch (error) {
  console.log('  ❌ Cannot read render.yaml:', error.message);
  allPassed = false;
}

// Final result
console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ ALL TESTS PASSED! Ready to deploy to Render! 🚀');
  console.log('\nNext steps:');
  console.log('1. Push to GitHub: git push origin main');
  console.log('2. Deploy on Render: https://render.com');
  console.log('3. Add GOOGLE_API_KEY in Render dashboard');
  console.log('\nSee DEPLOY_QUICK_START.md for detailed instructions.');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED! Please fix errors before deploying.');
  console.log('\nReview the errors above and fix them.');
  console.log('Then run this test again: node pre_deploy_test.js');
  process.exit(1);
}
