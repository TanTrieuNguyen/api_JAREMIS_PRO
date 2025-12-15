/**
 * TEST HYBRID MEDICAL IMAGE ANALYSIS BACKENDS
 * Test all available backends: OpenAI, Claude, Gemini, Ollama
 */

require('dotenv').config();
const hybridAnalysis = require('./medicalImageAnalysisHybrid');

console.log('🧪 TESTING HYBRID MEDICAL IMAGE ANALYSIS BACKENDS\n');
console.log('========================================\n');

// Kiểm tra backends khả dụng
console.log('📋 Checking Available Backends:\n');

const backends = {
  'OpenAI GPT-4o': process.env.OPENAI_API_KEY ? '✅ API Key Found' : '❌ Missing OPENAI_API_KEY',
  'Claude 3.5': process.env.ANTHROPIC_API_KEY ? '✅ API Key Found' : '❌ Missing ANTHROPIC_API_KEY',
  'Google Gemini': process.env.GOOGLE_API_KEY ? '✅ API Key Found' : '❌ Missing GOOGLE_API_KEY',
  'Ollama (Local)': 'ℹ️  Check if running: curl http://localhost:11434/api/tags'
};

Object.entries(backends).forEach(([name, status]) => {
  console.log(`  ${name.padEnd(20)} → ${status}`);
});

console.log('\n========================================\n');

// Current priority
const priority = process.env.IMAGE_ANALYSIS_PRIORITY || 'openai,claude,gemini,ollama';
console.log(`📊 Current Priority: ${priority}\n`);

// Kiểm tra kết nối Ollama
async function testOllama() {
  try {
    const axios = require('axios');
    const response = await axios.get('http://localhost:11434/api/tags', { timeout: 2000 });
    console.log('✅ Ollama is running');
    console.log(`   Models available: ${response.data.models?.map(m => m.name).join(', ') || 'None'}\n`);
    return true;
  } catch (error) {
    console.log('❌ Ollama is NOT running');
    console.log('   Install: https://ollama.ai');
    console.log('   Then run: ollama pull llava:13b\n');
    return false;
  }
}

// Kiểm thử với ảnh base64 mẫu (1x1 red pixel)
async function testSampleImage() {
  const sampleBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const sampleMimeType = 'image/png';
  
  console.log('🔬 Testing with sample image (1x1 red pixel)...\n');
  
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');
  
  try {
    const result = await hybridAnalysis.analyzeImageHybrid(
      sampleBase64,
      sampleMimeType,
      'xray-chest',
      genAI,
      'Test patient'
    );
    
    console.log('\n✅ Analysis Result:');
    console.log(`   Backend used: ${result.backend}`);
    console.log(`   Success: ${result.success}`);
    if (result.cost) {
      console.log(`   Estimated cost: $${result.cost.toFixed(4)}`);
    }
    if (result.analysis) {
      console.log(`   Analysis length: ${result.analysis.length} chars`);
      console.log(`   Preview: ${result.analysis.substring(0, 150)}...`);
    }
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  }
}

// Chạy chương trình kiểm thử
async function runTests() {
  console.log('========================================\n');
  console.log('🚀 Starting Tests...\n');
  
  await testOllama();
  
  console.log('========================================\n');
  
  // Bỏ comment để test với ảnh thật:
  // await testSampleImage();
  
  console.log('\n📝 Next Steps:\n');
  console.log('1. ✅ Choose your preferred backend(s)');
  console.log('2. ✅ Set API keys in .env file');
  console.log('3. ✅ Configure IMAGE_ANALYSIS_PRIORITY in .env');
  console.log('4. ✅ Test with real medical images\n');
  
  console.log('📖 See SETUP_HYBRID_IMAGE_ANALYSIS.md for detailed setup guide.\n');
}

runTests().catch(console.error);
