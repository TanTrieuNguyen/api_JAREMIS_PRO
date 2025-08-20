// server.js
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const upload = multer({ dest: 'uploads/' });
const genAI = new GoogleGenerativeAI('AIzaSyDTlW4FKd2rANZyXjLv7XwveYsAnt-FpMk'); // nhớ thay API key của bạn

app.use(express.static('public'));
app.use(express.json());

// ===== Load dữ liệu ICD =====
const whoICDPath = path.join(__dirname, 'who_guidelines.json');
const icdData = JSON.parse(fs.readFileSync(whoICDPath, 'utf8'));

// ===== Hàm parse kết quả =====
function parseDiagnosisResponse(text) {
  const result = { differentialDiagnosis: [], diseases: [], confidence: 0, whoGuideline: '' };
  const diffRegex = /## Chẩn đoán phân biệt \(WHO\)\n([\s\S]*?)\n##/gm;
  const diffMatch = diffRegex.exec(text);
  if (diffMatch) {
    result.differentialDiagnosis = diffMatch[1]
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
      .map(line => line.replace('- ', '').trim());
  }
  const diseaseRegex = /•\s*(.+?)\s*\(Xác suất:\s*(\d+)%\)/g;
  let diseaseMatch;
  while ((diseaseMatch = diseaseRegex.exec(text)) !== null) {
    result.diseases.push({
      name: diseaseMatch[1].trim(),
      probability: parseInt(diseaseMatch[2])
    });
  }
  const confidenceMatch = text.match(/Độ tin cậy:\s*(\d+)%/);
  if (confidenceMatch) result.confidence = parseInt(confidenceMatch[1]);
  const whoMatch = text.match(/WHO \(([^)]+)\)/);
  if (whoMatch) result.whoGuideline = whoMatch[1];
  return result;
}

function enrichWithICDDescriptions(diagnoses) {
  return diagnoses.map(entry => {
    const icdCodeMatch = entry.match(/\((.*?)\)$/);
    const icdCode = icdCodeMatch ? icdCodeMatch[1] : null;
    const description = icdCode && icdData[icdCode] ? icdData[icdCode].name : null;
    return {
      label: entry,
      icdCode,
      description: description || 'Không tìm thấy trong dữ liệu ICD'
    };
  });
}

// ===== API Diagnose =====
app.post('/api/diagnose', upload.array('images'), async (req, res) => {
  try {
    const labResults = req.body.labResults || '';
    const files = req.files || [];

    if (!labResults && files.length === 0) {
      return res.status(400).json({ error: 'Vui lòng cung cấp thông tin xét nghiệm hoặc hình ảnh' });
    }

    const imageParts = await Promise.all(files.map(async file => ({
      inlineData: {
        data: fs.readFileSync(file.path).toString('base64'),
        mimeType: file.mimetype
      }
    })));

    const prompt = `Đóng vai bác sĩ chuyên khoa. Phân tích theo hướng dẫn WHO:

**Dữ liệu bệnh nhân:**
${labResults ? `- Xét nghiệm: ${labResults}\n` : ''}
${files.length ? `- Hình ảnh y tế: [${files.length} ảnh]` : ''}

**Yêu cầu phân tích:**
1. Chẩn đoán phân biệt với ICD-10 codes (tối đa 5)
2. Liệt kê 3 bệnh khả thi nhất với xác suất
3. Độ tin cậy tổng (0-100%)
4. Khuyến nghị xét nghiệm theo WHO
5. Ghi rõ phiên bản hướng dẫn WHO sử dụng

**Định dạng bắt buộc:**
Chẩn đoán phân biệt
- [Bệnh 1] (Mã ICD-10)
- [Bệnh 2] (Mã ICD-10)
...
Khả năng chẩn đoán
• [Bệnh] (Xác suất: XX%)
...
Độ tin cậy: XX%
Hướng dẫn WHO: [Tên và phiên bản]`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 👉 FIX: Nếu không có ảnh thì chỉ gửi text, tránh "Load failed"
    let result;
    if (imageParts.length > 0) {
      result = await model.generateContent([prompt, ...imageParts]);
    } else {
      result = await model.generateContent(prompt);
    }

    const response = await result.response;
    const diagnosisText = response.text();

    const parsedData = parseDiagnosisResponse(diagnosisText);
    parsedData.differentialDiagnosisFull = enrichWithICDDescriptions(parsedData.differentialDiagnosis);

    files.forEach(file => fs.unlinkSync(file.path));

    res.json({
      ...parsedData,
      diagnosis: diagnosisText,
      icdDescriptions: parsedData.differentialDiagnosisFull,
      warning: '⚠️ **Cảnh báo:** Kết quả chỉ mang tính tham khảo. Luôn tham khảo ý kiến bác sĩ!'
    });
  } catch (err) {
    console.error('Lỗi:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chạy cổng ${PORT}`));
