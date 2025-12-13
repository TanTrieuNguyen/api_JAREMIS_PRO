// Script tự động chuyển comment tiếng Anh sang tiếng Việt
const fs = require('fs');
const path = require('path');

// Bảng từ điển chuyển đổi comment phổ biến
const translations = {
  // Cấu trúc code
  'Helper': 'Hàm hỗ trợ',
  'Utility': 'Tiện ích',
  'Function': 'Hàm',
  'Component': 'Thành phần',
  'Module': 'Module',
  
  // File operations
  'Read': 'Đọc',
  'Write': 'Ghi',
  'Save': 'Lưu',
  'Load': 'Tải',
  'Delete': 'Xóa',
  'Create': 'Tạo',
  'Update': 'Cập nhật',
  'File': 'File',
  'Path': 'Đường dẫn',
  
  // API & Network
  'API': 'API',
  'Endpoint': 'Endpoint',
  'Request': 'Yêu cầu',
  'Response': 'Phản hồi',
  'Fetch': 'Lấy dữ liệu',
  'Send': 'Gửi',
  'Receive': 'Nhận',
  
  // Database
  'Database': 'Cơ sở dữ liệu',
  'Query': 'Truy vấn',
  'Insert': 'Thêm',
  'Select': 'Chọn',
  'User': 'Người dùng',
  'Session': 'Phiên',
  'History': 'Lịch sử',
  
  // Logic
  'Check': 'Kiểm tra',
  'Validate': 'Xác thực',
  'Error': 'Lỗi',
  'Success': 'Thành công',
  'Failed': 'Thất bại',
  'Return': 'Trả về',
  'If': 'Nếu',
  'Else': 'Ngược lại',
  
  // Medical
  'Patient': 'Bệnh nhân',
  'Doctor': 'Bác sĩ',
  'Diagnose': 'Chẩn đoán',
  'Symptom': 'Triệu chứng',
  'Treatment': 'Điều trị',
  'Medical': 'Y tế',
  'Record': 'Hồ sơ',
  'Report': 'Báo cáo',
  
  // UI
  'Modal': 'Hộp thoại',
  'Button': 'Nút',
  'Form': 'Biểu mẫu',
  'Input': 'Ô nhập',
  'Display': 'Hiển thị',
  'Hide': 'Ẩn',
  'Show': 'Hiện',
  'Close': 'Đóng',
  'Open': 'Mở',
  
  // Common phrases
  'Initialize': 'Khởi tạo',
  'Configure': 'Cấu hình',
  'Setup': 'Thiết lập',
  'Process': 'Xử lý',
  'Handle': 'Xử lý',
  'Render': 'Hiển thị',
  'Parse': 'Phân tích',
  'Format': 'Định dạng',
  'Convert': 'Chuyển đổi',
  'Transform': 'Biến đổi',
};

// Các mẫu comment cần chuyển đổi
const patterns = [
  // Single line comments
  { regex: /\/\/ (.+)/g, type: 'single' },
  // Multi-line comments
  { regex: /\/\*(.+?)\*\//gs, type: 'multi' },
  // HTML comments
  { regex: /<!-- (.+?) -->/g, type: 'html' },
];

function translateComment(text) {
  // Các câu thường gặp
  const commonPhrases = {
    'NEW: Server-side LaTeX rendering utilities': 'MỚI: Công cụ render LaTeX phía server',
    'Helper: detect invalid/expired API key errors': 'Hàm hỗ trợ: phát hiện lỗi API key không hợp lệ hoặc hết hạn',
    'Optional: customize birth year shown in self-introduction': 'Tùy chọn: tùy chỉnh năm sinh của ứng dụng hiển thị khi giới thiệu',
    'Ephemeral session history for non-logged users': 'Lịch sử phiên tạm thời cho người dùng chưa đăng nhập',
    'Extract location from weather query (Vietnamese patterns)': 'Trích xuất địa điểm từ câu hỏi thời tiết (mẫu tiếng Việt)',
    'Translate Vietnamese city names to English for API': 'Dịch tên thành phố tiếng Việt sang tiếng Anh cho API',
    'Fetch weather data from Open-Meteo (free API, no key required)': 'Lấy dữ liệu thời tiết từ Open-Meteo (API miễn phí, không cần key)',
    'Weather code interpretation (WMO Weather interpretation codes)': 'Giải mã mã thời tiết (theo chuẩn WMO)',
    'Check if it\'s a weather query': 'Kiểm tra xem có phải câu hỏi về thời tiết không',
    'Real-time search nếu cần thông tin mới': 'Tìm kiếm thời gian thực nếu cần thông tin mới',
    'Build history section from blocks': 'Xây dựng phần lịch sử từ các khối',
    'Safe guard: only use items if it\'s an array': 'Kiểm tra an toàn: chỉ dùng items nếu nó là mảng',
    'User memory retrieval placeholder': 'Placeholder lấy bộ nhớ người dùng',
    'Merge facts into user memory placeholder': 'Placeholder hợp nhất thông tin vào bộ nhớ người dùng',
    'Get medical report for a specific patient (for frontend compatibility)': 'Lấy báo cáo y tế cho một bệnh nhân cụ thể (để tương thích frontend)',
    'Return HTML page with medical record template': 'Trả về trang HTML với template hồ sơ bệnh án',
    'Build visit history sections': 'Xây dựng các phần lịch sử khám',
    'Signature': 'Chữ ký',
    'Notes Section': 'Phần ghi chú',
    'Visit History': 'Lịch sử khám',
    'Medical History': 'Tiền sử bệnh',
    'Patient Info': 'Thông tin bệnh nhân',
    'Header': 'Phần đầu',
    'Identity Documents': 'Giấy tờ tùy thân',
    'Health Insurance': 'Bảo hiểm y tế',
    'Basic Info': 'Thông tin cơ bản',
    'Medical History Section': 'Phần tiền sử bệnh tật',
  };
  
  // Kiểm tra các cụm từ thường gặp trước
  for (const [eng, vie] of Object.entries(commonPhrases)) {
    if (text.includes(eng)) {
      text = text.replace(eng, vie);
    }
  }
  
  // Dịch các từ đơn
  for (const [eng, vie] of Object.entries(translations)) {
    const regex = new RegExp(`\\b${eng}\\b`, 'gi');
    text = text.replace(regex, vie);
  }
  
  return text;
}

function processFile(filePath) {
  console.log(`Đang xử lý: ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  let changes = 0;
  
  // Xử lý single-line comments
  content = content.replace(/\/\/ (.+)/g, (match, comment) => {
    const translated = translateComment(comment);
    if (translated !== comment) {
      changes++;
      return `// ${translated}`;
    }
    return match;
  });
  
  // Xử lý multi-line comments (cẩn thận với code)
  content = content.replace(/\/\*\*?([^*]|\*(?!\/))*\*\//g, (match) => {
    const inner = match.slice(2, -2);
    const translated = translateComment(inner);
    if (translated !== inner) {
      changes++;
      return `/*${translated}*/`;
    }
    return match;
  });
  
  // Xử lý HTML comments
  if (filePath.endsWith('.html')) {
    content = content.replace(/<!-- (.+?) -->/g, (match, comment) => {
      const translated = translateComment(comment);
      if (translated !== comment) {
        changes++;
        return `<!-- ${translated} -->`;
      }
      return match;
    });
  }
  
  if (changes > 0) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Đã chuyển đổi ${changes} comment trong ${path.basename(filePath)}`);
  } else {
    console.log(`⚠️ Không tìm thấy comment nào cần chuyển đổi trong ${path.basename(filePath)}`);
  }
  
  return changes;
}

// Main
const files = [
  path.join(__dirname, 'server.js'),
  path.join(__dirname, 'public', 'index.html'),
];

let totalChanges = 0;
files.forEach(file => {
  if (fs.existsSync(file)) {
    totalChanges += processFile(file);
  } else {
    console.log(`❌ File không tồn tại: ${file}`);
  }
});

console.log(`\n🎉 Hoàn thành! Đã chuyển đổi ${totalChanges} comment tổng cộng.`);
