// diagnosisEngine.js
// Tác giả: TT1403 (Nguyễn Tấn Triệu) & ANT (Đỗ Văn Vĩnh An)
// Mô-đun này xử lý phân tích bệnh hoặc câu hỏi sức khỏe bằng AI Google Gemini

const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config();

// Khởi tạo Gemini API
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Hàm chẩn đoán bệnh dựa trên mô tả triệu chứng của người dùng
 * @param {string} prompt - Câu hỏi hoặc mô tả triệu chứng của người dùng
 * @returns {Promise<string>} - Kết quả chẩn đoán hoặc gợi ý
 */
async function diagnose(prompt) {
  try {
    if (!prompt || prompt.trim().length === 0) {
      return "❗ Vui lòng nhập mô tả triệu chứng hoặc câu hỏi sức khỏe.";
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(
      `Bạn là bác sĩ ảo JAREMIS-AI. Hãy đọc mô tả sau và đưa ra nhận định chẩn đoán sơ bộ bằng tiếng Việt:
      "${prompt}"
      ---
      Trả lời ngắn gọn, dễ hiểu, nêu khả năng bệnh có thể gặp và khuyến nghị nên làm gì tiếp theo.`
    );

    const response = result.response.text();
    return response || "⚠️ Không có phản hồi từ AI.";
  } catch (error) {
    console.error("❌ diagnosisEngine error:", error);
    return "⚠️ Lỗi khi chẩn đoán: " + error.message;
  }
}

module.exports = { diagnose };
