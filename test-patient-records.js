/**
 * Quick test for Patient Records System
 */

const API_BASE = 'http://localhost:3000';

async function testPatientRecords() {
  console.log('🧪 Testing Patient Records System...\n');
  
  // Test 1: Get patient records (need login)
  try {
    const response = await fetch(`${API_BASE}/api/patient-records?doctor=test_doctor`);
    const data = await response.json();
    console.log('✅ Test 1 - Get patient records:', data);
  } catch (error) {
    console.error('❌ Test 1 failed:', error.message);
  }
  
  // Test 2: Health check
  try {
    const response = await fetch(`${API_BASE}/api/health`);
    const data = await response.json();
    console.log('✅ Test 2 - Health check:', data);
  } catch (error) {
    console.error('❌ Test 2 failed:', error.message);
  }
  
  console.log('\n✅ Tests completed!');
}

// Chạy nếu được gọi trực tiếp
if (require.main === module) {
  testPatientRecords().catch(console.error);
}

module.exports = { testPatientRecords };
