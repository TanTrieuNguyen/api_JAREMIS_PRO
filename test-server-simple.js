/**
 * SIMPLE TEST - Kiểm tra server và API
 */

const axios = require('axios');

const SERVER_URL = 'http://localhost:3000';

async function testServer() {
  console.log('🧪 Bắt đầu test server...\n');
  
  // Test 1: Server có chạy không?
  console.log('📋 Test 1: Kiểm tra server đang chạy...');
  try {
    const response = await axios.get(SERVER_URL);
    console.log('✅ Server đang chạy OK!\n');
  } catch (error) {
    console.log('❌ Server KHÔNG chạy!');
    console.log('   → Hãy chạy: npm start');
    console.log('   → Hoặc: node server.js\n');
    return;
  }
  
  // Test 2: API /api/chat
  console.log('📋 Test 2: Kiểm tra API /api/chat...');
  try {
    const response = await axios.post(`${SERVER_URL}/api/chat`, {
      message: 'hi',
      model: 'flash',
      sessionId: 'test-' + Date.now()
    });
    
    if (response.data && response.data.success) {
      console.log('✅ API /api/chat hoạt động OK!');
      console.log('   Reply:', response.data.reply.substring(0, 50) + '...\n');
    } else {
      console.log('⚠️  API trả về nhưng không có success=true');
      console.log('   Response:', response.data, '\n');
    }
  } catch (error) {
    console.log('❌ API /api/chat BỊ LỖI!');
    console.log('   Status:', error.response?.status);
    console.log('   Error:', error.response?.data || error.message);
    console.log('\n📝 Chi tiết lỗi:');
    
    if (error.response?.data?.error) {
      console.log('   Server error:', error.response.data.error);
      
      // Kiểm tra các lỗi thường gặp
      if (error.response.data.error.includes('getUserMemory is not defined')) {
        console.log('\n🔧 FIX: Thêm function getUserMemory vào server.js');
        console.log('   Line ~1884, thêm:');
        console.log('   function getUserMemory(username) {');
        console.log('     return { summary: \'\' };');
        console.log('   }');
      }
      
      if (error.response.data.error.includes('searchRealTimeInfo is not defined')) {
        console.log('\n🔧 FIX: Thêm function searchRealTimeInfo vào server.js');
        console.log('   Line ~2232, thêm:');
        console.log('   async function searchRealTimeInfo(query) {');
        console.log('     return null;');
        console.log('   }');
      }
    }
    console.log('');
  }
  
  // Test 3: API /api/check-username
  console.log('📋 Test 3: Kiểm tra API /api/check-username...');
  try {
    const response = await axios.get(`${SERVER_URL}/api/check-username?username=test_user_123`);
    
    if (response.data && typeof response.data.available === 'boolean') {
      console.log('✅ API /api/check-username hoạt động OK!');
      console.log('   Available:', response.data.available, '\n');
    } else {
      console.log('⚠️  API trả về không đúng format\n');
    }
  } catch (error) {
    console.log('❌ API /api/check-username BỊ LỖI!');
    console.log('   Error:', error.message, '\n');
  }
  
  console.log('='.repeat(50));
  console.log('📊 KẾT QUẢ TEST');
  console.log('='.repeat(50));
  console.log('');
  console.log('Nếu tất cả đều ✅ → Mở browser: http://localhost:3000');
  console.log('Nếu có ❌ → Làm theo hướng dẫn fix ở trên');
  console.log('');
}

// Chạy test
testServer().catch(err => {
  console.error('❌ Test script error:', err.message);
});
