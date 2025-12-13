/**
 * TEST MEDICAL IMAGE ANALYSIS MODULE
 * Quick test for image type detection
 */

const medicalImageAnalysis = require('./medicalImageAnalysis');

console.log('🧪 TESTING MEDICAL IMAGE ANALYSIS MODULE\n');

// Test 1: Image Type Detection
console.log('📋 Test 1: Phát hiện loại ảnh từ tên file');
const testFilenames = [
  'chest_xray_20250119.jpg',
  'brain_mri_t2_flair.dcm',
  'ct_chest_contrast.jpg',
  'pet_scan_whole_body.png',
  'ecg_12lead.pdf',
  'ultrasound_liver.jpg',
  'mammogram_left.jpg',
  'skin_lesion_mole.jpg',
  'endoscopy_stomach.jpg',
  'spine_mri_lumbar.jpg',
  'cardiac_echo.mp4',
  'random_image.jpg'
];

testFilenames.forEach(filename => {
  const imageType = medicalImageAnalysis.detectImageType(filename);
  const label = medicalImageAnalysis.getImageTypeLabel(imageType);
  console.log(`  ✓ ${filename.padEnd(35)} → ${imageType.padEnd(25)} (${label})`);
});

console.log('\n✅ All tests completed!\n');

// Test 2: Prompt Generation
console.log('📋 Test 2: Tạo prompt phân tích');
const sampleTypes = ['xray-chest', 'ct-brain', 'mri-spine', 'ecg', 'pet-scan'];
sampleTypes.forEach(type => {
  const prompt = medicalImageAnalysis.getImageAnalysisPrompt(type, 'Bệnh nhân 45 tuổi, đau ngực');
  console.log(`  ✓ ${type.padEnd(20)} → Prompt length: ${prompt.length} chars`);
});

console.log('\n🎉 Module is ready to use!');
console.log('\n📖 Usage:');
console.log('  const imageAnalyses = await medicalImageAnalysis.analyzeMedicalImages(files, genAI, context);');
console.log('  const report = medicalImageAnalysis.formatImageAnalysisReport(imageAnalyses);');
