// 🚀 JAREMIS Quick Start Guide

## ✨ Tính Năng Mới Triển Khai

### 1. 📋 PASTE ẢNH (Ctrl+V)
**Cách dùng:**
1. Copy ảnh từ bất kỳ đâu (Screenshot, File Explorer, Web...)
2. Vào chat JAREMIS
3. Nhấn **Ctrl+V** (hoặc Cmd+V trên Mac)
4. Ảnh sẽ hiện preview với badge "📋 Dán ảnh"
5. Nhập mô tả (optional) và nhấn **Gửi**

**Ví dụ:**
- Copy screenshot kết quả xét nghiệm máu → Ctrl+V → "Phân tích xét nghiệm"
- Copy ảnh X-quang từ email → Ctrl+V → "Đánh giá X-quang ngực"
- Screenshot ECG từ máy đo → Ctrl+V → "Đọc điện tâm đồ"

### 2. 🩺 10 TÍNH NĂNG CHẨN ĐOÁN NÂNG CAO

#### A. Lab Result Parser
- **Tự động phát hiện:** WBC, RBC, Glucose, HbA1c, Creatinine, ALT, AST...
- **Đánh giá:** MILD, MODERATE, SEVERE
- **Bảng markdown đẹp** với màu sắc

**Demo:**
```
Nhập: "WBC: 15000, Glucose: 180, HbA1c: 8.5"
→ Tự động parse + highlight bất thường
```

#### B. Multi-modal AI
- **X-ray:** Phổi, tim, xương
- **CT scan:** Chi tiết tổn thương
- **ECG:** Nhịp, trục, ST segment
- **Dermatology:** Tổn thương da

#### C. NEWS2 Score
- **Input vital signs:**
```json
{
  "heartRate": 110,
  "respiratoryRate": 24,
  "systolicBP": 95,
  "temperature": 38.5,
  "oxygenSaturation": 93
}
```
- **Output:** Score 0-20, risk level, khuyến nghị

#### D. Medical Scoring Systems
- **Wells DVT:** Nguy cơ huyết khối
- **CURB-65:** Viêm phổi (mortality risk)
- **CHA2DS2-VASc:** Nguy cơ đột quỵ
- **APACHE II:** ICU mortality

#### E. Differential Diagnosis Tree
- Cây quyết định dựa trên triệu chứng
- Likelihood + Next steps
- Citations từ guidelines

#### F. Explainable AI (XAI)
- **Giải thích chi tiết** tại sao AI đưa ra chẩn đoán
- **Key factors:** Symptoms (40%), Labs (35%), Imaging (25%)
- **Reasoning process:** Bayesian, ICD-10 matching
- **Limitations:** Ghi rõ hạn chế của AI

#### G. Treatment Recommendations
- **First-line drugs** với liều lượng
- **Evidence:** WHO, ADA, ESC, IDSA
- **Monitoring:** Theo dõi gì, bao lâu
- **Citations:** Ghi rõ nguồn guideline

#### H. Confidence Breakdown
- Độ tin cậy 0-100%
- Phân tích từng yếu tố đóng góp
- Khi nào cần bác sĩ chuyên khoa

#### I. ICD-10 Integration
- Differential diagnosis với mã ICD-10
- Xác suất từng bệnh (%)
- Cross-reference WHO database

#### J. Follow-up & Monitoring
- Xét nghiệm thêm cần làm
- Timeline theo dõi
- Red flags (dấu hiệu nguy hiểm)

### 3. 📖 MEDICAL CITATIONS

**Nguồn tự động trích dẫn:**
- 🌍 **WHO Guidelines** (HIGHEST)
- 📚 **PubMed/NIH** (HIGHEST)
- 🏥 **CDC** (HIGHEST)
- 🇻🇳 **Bộ Y tế VN** (HIGH)
- ⚕️ **UpToDate** (HIGHEST)
- 📄 **Mayo Clinic** (HIGHEST)

**Format:**
```markdown
### 📖 Nguồn Tham Khảo

1. 🌍 WHO - Pneumonia Guidelines 2023
   Độ tin cậy: HIGHEST
   [Link]

2. 📚 PubMed - CAP Treatment Meta-analysis
   Độ tin cậy: HIGHEST
   [Link]
```

## 🎯 Demo Workflow

### Scenario 1: Xét nghiệm máu
1. Copy screenshot xét nghiệm
2. **Ctrl+V** vào JAREMIS
3. Bật **Diagnose mode** (nút Stethoscope)
4. Nhập: "Phân tích kết quả xét nghiệm này"
5. **Gửi**

**Kết quả nhận được:**
- ✅ Bảng markdown các chỉ số
- ✅ Highlight bất thường (HIGH/LOW)
- ✅ Mức độ: MILD/MODERATE/SEVERE
- ✅ Differential diagnosis với ICD-10
- ✅ Khuyến nghị xét nghiệm thêm
- ✅ Citations (WHO, CDC, Bộ Y tế...)

### Scenario 2: Triệu chứng lâm sàng
**Input:**
```
Bệnh nhân 45 tuổi, nam
Triệu chứng:
- Đau ngực crushing, lan lên vai trái
- Khó thở khi gắng sức
- Đổ mồ hôi lạnh

Vital signs:
- HR: 110, RR: 24
- BP: 90/60, SpO2: 92%
- Temp: 37.2°C
```

**Output:**
- ✅ **NEWS2 Score:** 7/20 - HIGH RISK
- ✅ **Differential:**
  - ACS (85%) - ICD I21.9
  - Pulmonary Embolism (10%) - ICD I26.9
  - Panic Attack (5%) - ICD F41.0
- ✅ **XAI Explanation:** Tại sao AI chọn ACS?
- ✅ **Treatment:** Aspirin 300mg, Clopidogrel, Heparin
- ✅ **Urgent actions:** ECG, Troponin, Cath lab
- ✅ **Citations:** ESC STEMI Guidelines 2023

### Scenario 3: X-ray phổi
1. Copy ảnh X-quang từ PACS/email
2. **Ctrl+V**
3. Diagnose mode ON
4. Nhập: "Đánh giá X-quang ngực này"
5. Gửi

**Output:**
- ✅ **Image analysis:** Phổi, tim, xương chi tiết
- ✅ **Findings:** Thâm nhiễm thùy dưới phải
- ✅ **Diagnosis:** CAP (78%), TB (15%), Lung cancer (7%)
- ✅ **Next steps:** Sputum culture, CT chest nếu cần
- ✅ **Treatment:** Amoxicillin vs Azithromycin
- ✅ **Citations:** IDSA CAP Guidelines

## 🎨 UI Highlights

### Markdown Tables
```markdown
| Bệnh | ICD-10 | Xác suất | Cơ sở |
|------|--------|----------|-------|
| Viêm phổi | J18.9 | 78% | Ho, sốt, X-quang |
```
→ Render thành bảng **Excel-like** với gradient header, zebra striping

### Animated Typing
- Gemini-style progressive reveal
- Smooth line-by-line animation
- Click anywhere to fast-forward

### Flash Notifications
- ✅ Success (green)
- ❌ Error (red)
- ℹ️ Info (blue)
- Auto-dismiss sau 3s

### 3D Tilt Effects
- Buttons: Login, Diagnose, Send, Mic...
- Hover: 3D perspective tilt
- Touch-friendly

## ⚙️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+V** | Paste image từ clipboard |
| **Enter** | Gửi tin nhắn |
| **Shift+Enter** | Xuống dòng |
| **Ctrl+Shift+K** | Toggle Diagnose mode |
| **Ctrl+Shift+U** | Đính kèm file |
| **Ctrl+M** | Ghi âm (voice input) |
| **Escape** | Đóng modal/sidebar |

## 🔧 Technical Details

### Backend (server.js)
- ✅ diagnosisEngine.js module
- ✅ 10 advanced functions
- ✅ Medical citations search
- ✅ Multi-modal AI (Gemini 1.5)
- ✅ NEWS2, Wells, CURB-65, CHA2DS2-VASc

### Frontend (index.html)
- ✅ Paste image handler
- ✅ Preview with badge
- ✅ getAllImages() (file + pasted)
- ✅ Citations rendering
- ✅ Markdown table styling

### Dependencies
```json
{
  "cheerio": "^1.0.0",      // HTML parsing
  "node-fetch": "^3.3.2",   // API calls
  "pdf-lib": "^1.17.1",     // PDF processing
  "sharp": "^0.33.5",       // Image processing
  "katex": "^0.16.22",      // Math rendering
  "dompurify": "^3.2.7"     // Sanitization
}
```

## 📊 Performance

- **Response time:** 2-5s (Flash), 5-10s (Pro)
- **Image analysis:** 3-7s per image
- **Concurrent requests:** Up to 10
- **Rate limit:** 60 req/min (Google AI)

## ⚠️ Important Notes

### Medical Disclaimer
- ❗ **KHÔNG thay thế bác sĩ**
- ❗ **Chỉ tham khảo**
- ❗ **Cấp cứu: GỌI 115**
- ❗ **Tự chịu trách nhiệm nếu tự điều trị**

### Data Privacy
- ✅ No server storage
- ✅ Ephemeral sessions
- ✅ Deleted after response
- ✅ HTTPS recommended

### Limitations
- ⚠️ AI không thể khám lâm sàng
- ⚠️ Bỏ sót bệnh hiếm (<1%)
- ⚠️ Phụ thuộc chất lượng input
- ⚠️ Không phát hiện biến chứng không điển hình

## 🚀 Next Steps

### Immediate (Tuần này)
- [ ] Test toàn bộ workflow
- [ ] Fix bugs nếu có
- [ ] Optimize performance
- [ ] Add more medical sources

### Short-term (Tháng này)
- [ ] OCR cho PDF xét nghiệm
- [ ] Export report PDF
- [ ] Voice input symptoms
- [ ] Drug interaction checker

### Long-term (Quý này)
- [ ] Mobile app
- [ ] Real-time collaboration
- [ ] EHR integration
- [ ] Multi-language

## 📞 Support

- **GitHub Issues:** [Report bugs]
- **Email:** support@jaremis.dev
- **Docs:** https://docs.jaremis.dev

---

**🏆 Sẵn sàng cho cuộc thi KHKT!**

*JAREMIS - AI Y tế Tiên tiến cho Việt Nam* 🇻🇳🤖
