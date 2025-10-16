# 🚀 JAREMIS Advanced Diagnosis System - Features

## ✨ Tính Năng Chính

### 1. 📋 **Paste Image (Ctrl+V) - Dán Ảnh Trực Tiếp**
- **Mô tả:** Cho phép dán ảnh từ clipboard (Ctrl+C → Ctrl+V) trực tiếp vào chat
- **Sử dụng:**
  1. Copy ảnh từ bất kỳ nguồn nào (screenshot, file, web...)
  2. Paste (Ctrl+V) vào cửa sổ chat
  3. Ảnh sẽ hiện preview với badge "📋 Dán ảnh"
  4. Nhấn Gửi để phân tích
- **Hỗ trợ:** PNG, JPEG, BMP, WebP
- **Giới hạn:** 4MB/ảnh, không giới hạn số lượng

### 2. 🩺 **10 Tính Năng Chẩn Đoán Nâng Cao**

#### 2.1. **Lab Result Parser (Phân tích xét nghiệm)**
- Tự động parse kết quả xét nghiệm từ text/OCR
- Phát hiện chỉ số bất thường (WBC, RBC, Glucose, HbA1c, Creatinine...)
- Đánh giá mức độ: MILD, MODERATE, SEVERE
- Bảng markdown đẹp với màu sắc trực quan

**Example:**
```
WBC: 15000 cells/μL (BT: 4000-11000) → HIGH ⬆️ - MODERATE
Glucose: 180 mg/dL (BT: 70-100) → HIGH ⬆️ - SEVERE
```

#### 2.2. **Multi-modal AI (Phân tích đa phương thức)**
- **X-ray:** Phổi, tim, xương sườn
- **CT scan:** Chi tiết tổn thương, kích thước, đặc điểm
- **ECG:** Nhịp tim, tần số, trục QRS, ST segment
- **Dermatology:** Tổn thương da, phân loại benign/malignant

#### 2.3. **Vital Signs Scoring (NEWS2)**
- Tính toán NEWS2 Score (0-20)
- Đánh giá nguy cơ: LOW, MODERATE, HIGH
- Khuyến nghị can thiệp dựa trên điểm số
- Tham số: HR, RR, BP, Temp, SpO2, Consciousness

**Score interpretation:**
- 0-4: LOW RISK (ward care)
- 5-6: MODERATE RISK (frequent monitoring)
- 7+: HIGH RISK (urgent response)

#### 2.4. **Medical Scoring Systems**
- **Wells DVT Score:** Xác suất huyết khối tĩnh mạch sâu
- **CURB-65:** Mức độ nặng viêm phổi (0.7%-40% mortality)
- **CHA2DS2-VASc:** Nguy cơ đột quỵ trong rung nhĩ
- **APACHE II:** Dự đoán tử vong ICU

#### 2.5. **Differential Diagnosis Tree (Cây quyết định)**
- Phân nhánh theo triệu chứng
- Likelihood: HIGH, MODERATE, LOW
- Next steps: ECG, Troponin, Chest X-ray...
- Citations: ACC/AHA, ESC, IDSA Guidelines

**Example:**
```
Root: Chest Pain
├─ Crushing, radiating → ACS (HIGH) → [ECG, Troponin]
├─ Sharp, worse breathing → PE/Pneumonia (MODERATE) → [CT-PA, D-dimer]
└─ Burning, after meals → GERD (HIGH) → [PPI trial]
```

#### 2.6. **Explainable AI (XAI)**
- Giải thích quyết định AI chi tiết
- Key factors: Symptoms (40%), Labs (35%), Imaging (25%)
- Reasoning: Thuật toán Bayesian, so sánh ICD-10
- Limitations: Không thay thế khám lâm sàng

#### 2.7. **Treatment Recommendations**
- First-line drugs với liều lượng
- Evidence-based: WHO, ADA, ESC, IDSA
- Lifestyle modifications
- Monitoring parameters
- Contraindication warnings

**Example - Pneumonia:**
```
First-line:
- Amoxicillin 500mg TID x 5-7 days (WHO Essential)
- Azithromycin 500mg D1, 250mg D2-5 (IDSA)

Monitoring:
- SpO2, RR, fever curve

Citation: WHO CAP Guidelines 2023
```

#### 2.8. **Confidence Breakdown**
- Overall confidence: 0-100%
- Factor contributions
- Uncertainty quantification
- When to seek specialist

#### 2.9. **ICD-10 Integration**
- Differential diagnosis với mã ICD-10
- Xác suất từng bệnh (%)
- Mô tả đầy đủ từ WHO database
- Cross-reference với guidelines

#### 2.10. **Follow-up & Monitoring**
- Khuyến nghị xét nghiệm thêm
- Timeline theo dõi
- Red flags (dấu hiệu nguy hiểm)
- Referral criteria

### 3. 📖 **Medical Citations & Sources**
- **Tự động trích dẫn nguồn tin cậy:**
  - 🌍 **WHO Guidelines** (HIGHEST credibility)
  - 📚 **PubMed/NIH** Medical Literature (HIGHEST)
  - 🏥 **CDC** Disease Control (HIGHEST)
  - 🇻🇳 **Bộ Y tế Việt Nam** (HIGH)
  - ⚕️ **UpToDate** Evidence-based medicine (HIGHEST)
  - 📄 **Mayo Clinic** (HIGHEST)

**Format citation:**
```markdown
### 📖 Nguồn Tham Khảo Khoa Học

1. **🌍 WHO Guidelines**
   - [WHO - Pneumonia Treatment Protocol 2023](https://www.who.int...)
   - Độ tin cậy: HIGHEST

2. **📚 Research Database**
   - [PubMed - CAP Antibiotic Resistance](https://pubmed...)
   - Độ tin cậy: HIGHEST

3. **🇻🇳 Bộ Y tế Việt Nam**
   - [Hướng dẫn chẩn đoán và điều trị - Viêm phổi](https://moh.gov.vn...)
   - Độ tin cậy: HIGH
```

### 4. 📊 **Beautiful Markdown Tables**
- Table layout: fixed, center-aligned
- Gradient headers (blue → purple)
- Zebra striping (xen kẽ màu)
- Hover effects
- Responsive design
- Excel-like appearance

**Example:**
| Bệnh | ICD-10 | Xác suất | Cơ sở |
|------|--------|----------|-------|
| Viêm phổi | J18.9 | 78% | Ho, sốt, X-quang thâm nhiễm |
| Lao phổi | A15.0 | 15% | Sốt kéo dài, đổ mồ hôi đêm |

### 5. 🎨 **Enhanced UX/UI**
- Animated typing (Gemini-style)
- Progress indicators cho chẩn đoán
- Flash notifications
- 3D tilt effects
- Snowfall animation
- Smooth transitions
- Mobile-optimized

## 🛠️ Installation & Setup

### Prerequisites
```bash
Node.js >= 16.x
npm or yarn
Google AI API Key
```

### Install Dependencies
```bash
npm install
```

### Environment Variables
Create `.env` file:
```env
GOOGLE_API_KEY=your_google_ai_key
OPENWEATHER_API_KEY=your_weather_key
PORT=3000
```

### Run Server
```bash
npm start
# or
node server.js
```

Visit: `http://localhost:3000`

## 📝 Usage Examples

### Example 1: Paste Image + Lab Results
1. Copy screenshot xét nghiệm máu
2. Ctrl+V vào chat
3. Nhập: "Phân tích kết quả xét nghiệm này"
4. Bật **Diagnose mode** (Ctrl+Shift+K)
5. Nhấn Send

**Kết quả:**
- Lab analysis với bảng markdown
- Chỉ số bất thường highlight
- NEWS2 score (nếu có vital signs)
- Differential diagnosis
- Treatment recommendations
- Citations từ WHO, CDC...

### Example 2: X-ray Analysis
1. Copy ảnh X-quang ngực
2. Ctrl+V
3. Nhập: "Đánh giá X-quang này"
4. Diagnose mode ON
5. Send

**Kết quả:**
- Phân tích chi tiết phổi, tim, xương
- Chẩn đoán phân biệt với ICD-10
- Confidence score
- Khuyến nghị CT/MRI nếu cần
- Citations: ACC/AHA Guidelines

### Example 3: Symptom-based Diagnosis
Nhập:
```
Triệu chứng:
- Đau ngực crushing, lan lên vai trái
- Khó thở khi gắng sức
- Đổ mồ hôi lạnh

Vital signs:
- HR: 110, BP: 90/60, SpO2: 92%
```

**Kết quả:**
- NEWS2 Score: 7/20 - HIGH RISK
- Differential: ACS (85%), PE (10%), Panic attack (5%)
- Urgent ECG + Troponin
- Treatment: Aspirin, Clopidogrel, Heparin
- Citations: ESC STEMI Guidelines 2023

## 🔒 Security & Privacy

- ✅ No data stored on server (ephemeral sessions)
- ✅ API keys secured via .env
- ✅ HTTPS recommended for production
- ✅ Input sanitization (DOMPurify)
- ✅ File size limits (4MB)
- ⚠️ **Medical Disclaimer:** AI suggestions are for reference only. Always consult licensed physicians.

## 🚀 Roadmap

### Phase 1 (Current) ✅
- [x] Paste image support
- [x] 10 advanced diagnosis features
- [x] Medical citations
- [x] Beautiful markdown tables
- [x] XAI explanations

### Phase 2 (Next)
- [ ] OCR for lab results PDFs
- [ ] Voice input for symptoms
- [ ] Export diagnosis report (PDF)
- [ ] Multi-language support
- [ ] Drug interaction checker
- [ ] Allergy warnings

### Phase 3 (Future)
- [ ] Real-time collaboration (multiple doctors)
- [ ] Integration with hospital EHR systems
- [ ] AI-powered differential diagnosis ranking
- [ ] Continuous learning from feedback
- [ ] Mobile app (React Native)

## 📚 API Documentation

### POST `/api/diagnose`
**Request:**
```javascript
FormData {
  message: string,
  labResults: string,
  symptoms: string,
  vitalSigns: JSON, // { hr, rr, bp, temp, spo2 }
  demographics: JSON, // { age, sex, weight }
  images: File[],
  model: 'pro' | 'flash',
  sessionId: string,
  submittedBy: string
}
```

**Response:**
```javascript
{
  modelUsed: string,
  diagnosis: string,
  diagnosisHtml: string,
  labAnalysis: {
    abnormal: [...],
    normalRanges: {...}
  },
  news2Score: {
    score: number,
    risk: 'LOW' | 'MODERATE' | 'HIGH',
    interpretation: string
  },
  imageAnalyses: [{
    filename: string,
    type: 'xray' | 'ct' | 'ecg' | 'dermatology',
    summary: string
  }],
  xaiExplanation: string,
  treatmentRecommendations: {
    firstLine: [...],
    lifestyle: [...],
    monitoring: [...],
    citation: string
  },
  diagnosisTree: { root, branches },
  citations: [{
    type: string,
    title: string,
    url: string,
    credibility: 'HIGHEST' | 'HIGH' | 'MODERATE',
    icon: string
  }],
  citationsHtml: string,
  confidence: number,
  diseases: string[],
  icdDescriptions: [...]
}
```

## 🤝 Contributing

Contributions welcome! Areas to improve:
- Medical knowledge base expansion
- UI/UX enhancements
- Performance optimization
- Test coverage
- Documentation

## 📄 License

MIT License - See LICENSE file

## ⚠️ Medical Disclaimer

**QUAN TRỌNG:**
- Hệ thống này CHỈ mang tính tham khảo
- KHÔNG thay thế ý kiến bác sĩ chuyên khoa
- KHÔNG tự ý điều trị dựa trên kết quả AI
- Luôn tham khảo bác sĩ trước khi quyết định điều trị
- Các trường hợp cấp cứu: GỌI 115 NGAY LẬP TỨC

## 📞 Contact & Support

- **Email:** support@jaremis.dev
- **GitHub Issues:** [Report bugs](https://github.com/your-repo/issues)
- **Documentation:** [Full docs](https://docs.jaremis.dev)

---

**Made with ❤️ for Vietnam Science & Technology Competition**

*JAREMIS - Advancing Medical AI for Better Healthcare* 🏥🤖
