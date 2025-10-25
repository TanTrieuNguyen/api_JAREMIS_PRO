/**
 * medicalImageAnalysis.js
 * Mô-đun giả lập phân tích ảnh y khoa (X-ray, MRI, CT, PET, ECG, Ultrasound, v.v.)
 * Phiên bản ổn định cho Render
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

/**
 * Phân tích hình ảnh y khoa — mô phỏng (AI model placeholder)
 * @param {string} imagePath - đường dẫn tới file ảnh (từ multer upload)
 * @returns {Promise<object>} kết quả phân tích (giả lập)
 */
async function analyzeImage(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error('Không tìm thấy ảnh: ' + imagePath);
    }

    const filename = path.basename(imagePath);

    // Mô phỏng gửi ảnh đến AI (placeholder)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Trả về kết quả mẫu (bạn có thể thay thế bằng model thật sau)
    return {
      status: 'success',
      file: filename,
      analysis: {
        summary: 'Ảnh hợp lệ, không phát hiện bất thường nghiêm trọng.',
        confidence: Math.round(Math.random() * 10) / 10 + 0.85, // ví dụ: 0.87–0.95
        recommendations: [
          'Tiếp tục theo dõi triệu chứng trong 3–5 ngày.',
          'Nếu có dấu hiệu bất thường, nên tái khám bác sĩ chuyên khoa.'
        ],
      },
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[medicalImageAnalysis] Lỗi phân tích ảnh:', error.message);
    return {
      status: 'error',
      message: error.message,
    };
  }
}

/**
 * Xóa ảnh tạm sau khi xử lý
 * @param {string} filePath
 */
function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn('[medicalImageAnalysis] Không thể xóa ảnh:', err.message);
  }
}

module.exports = {
  analyzeImage,
  cleanup,
};
