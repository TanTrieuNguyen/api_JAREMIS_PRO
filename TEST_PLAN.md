# 🧪 JAREMIS v2.0 - Test Plan

## 📋 Test Environment Setup

### Prerequisites
```bash
✅ Node.js >= 16.x installed
✅ Dependencies installed (npm install)
✅ .env file configured with GOOGLE_API_KEY
✅ Server running (npm start)
```

### Browser Testing
- [ ] Chrome/Edge (recommended)
- [ ] Firefox
- [ ] Safari
- [ ] Mobile browsers (Chrome/Safari)

---

## 🎯 TEST CASES

### 1. PASTE IMAGE (Ctrl+V) - Priority: CRITICAL

#### Test 1.1: Basic Paste
**Steps:**
1. Open any image in viewer (Windows Photo Viewer, Chrome, etc.)
2. Copy image (Ctrl+C)
3. Go to JAREMIS chat window
4. Paste (Ctrl+V)

**Expected:**
- ✅ Image preview appears
- ✅ Badge "📋 Dán ảnh" visible
- ✅ Flash notification: "✅ Đã dán ảnh từ clipboard!"
- ✅ Remove button (×) functional
- ✅ Console log: "📋 Pasted image: ..."

**Actual:**
- [ ] Pass
- [ ] Fail (describe issue): ___________

---

#### Test 1.2: Multiple Paste
**Steps:**
1. Paste image 1 (Ctrl+V)
2. Paste image 2 (Ctrl+V)
3. Verify both previews visible

**Expected:**
- ✅ Both images show in preview
- ✅ Each has remove button
- ✅ No duplicate previews

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 1.3: Mixed Upload + Paste
**Steps:**
1. Click paperclip → Select file → Upload
2. Paste another image (Ctrl+V)
3. Verify both visible

**Expected:**
- ✅ File upload image shows
- ✅ Pasted image shows with badge
- ✅ Both sent when clicking Send

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 1.4: Remove Pasted Image
**Steps:**
1. Paste image (Ctrl+V)
2. Click × button
3. Verify removed

**Expected:**
- ✅ Image preview disappears
- ✅ No error in console

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 2. LAB RESULT PARSER - Priority: HIGH

#### Test 2.1: Parse Abnormal Values
**Input:**
```
WBC: 15000
Glucose: 180
HbA1c: 8.5
Creatinine: 2.5
```

**Steps:**
1. Enable Diagnose mode
2. Paste text above
3. Send

**Expected:**
- ✅ Table shows all 4 values
- ✅ "HIGH ⬆️" indicators
- ✅ Severity: MODERATE/SEVERE
- ✅ Normal ranges shown

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

**Screenshot:** ___________

---

#### Test 2.2: Normal Values
**Input:**
```
WBC: 7000
Glucose: 90
HbA1c: 5.2
```

**Expected:**
- ✅ No abnormal findings
- ✅ "Tất cả các chỉ số trong giới hạn bình thường"

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 3. NEWS2 SCORE - Priority: HIGH

#### Test 3.1: High Risk Patient
**Input (in Diagnose mode):**
```json
{
  "vitalSigns": {
    "heartRate": 130,
    "respiratoryRate": 28,
    "systolicBP": 85,
    "temperature": 39.5,
    "oxygenSaturation": 88,
    "consciousness": "Alert"
  }
}
```

**Expected:**
- ✅ NEWS2 Score: 10-12/20
- ✅ Risk: HIGH RISK (red color)
- ✅ Interpretation shown
- ✅ Breakdown by parameter

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 4. MULTI-MODAL AI - Priority: CRITICAL

#### Test 4.1: X-ray Analysis
**Steps:**
1. Find chest X-ray image online
2. Copy image (Ctrl+C)
3. Paste (Ctrl+V)
4. Diagnose mode ON
5. Type: "Đánh giá X-quang ngực này"
6. Send

**Expected:**
- ✅ Image analysis appears
- ✅ Mentions: phổi, tim, xương
- ✅ Diagnosis with ICD-10
- ✅ Confidence score

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

**Screenshot:** ___________

---

#### Test 4.2: ECG Analysis
**Steps:**
1. Copy ECG strip image
2. Paste (Ctrl+V)
3. Type: "Đọc điện tâm đồ"
4. Send

**Expected:**
- ✅ Mentions: nhịp, tần số, trục QRS
- ✅ ST segment / T wave analysis
- ✅ Diagnosis: Normal sinus rhythm / Arrhythmia

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 5. MEDICAL CITATIONS - Priority: CRITICAL

#### Test 5.1: Citations Display
**Steps:**
1. Any diagnosis query
2. Check response

**Expected:**
- ✅ Section "📖 Nguồn Tham Khảo" appears
- ✅ At least 3 sources:
  - 🌍 WHO
  - 📚 PubMed
  - 🏥 CDC
  - 🇻🇳 Bộ Y tế VN
- ✅ Credibility: HIGHEST/HIGH
- ✅ Clickable links

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 5.2: Citation Links Work
**Steps:**
1. Click on WHO link
2. Click on PubMed link
3. Click on CDC link

**Expected:**
- ✅ Opens in new tab
- ✅ Relevant search results

**Actual:**
- [ ] Pass (WHO): ___
- [ ] Pass (PubMed): ___
- [ ] Pass (CDC): ___

---

### 6. MARKDOWN TABLES - Priority: HIGH

#### Test 6.1: Differential Diagnosis Table
**Expected:**
- ✅ Table layout: fixed width
- ✅ Center-aligned text
- ✅ Gradient header (blue → purple)
- ✅ Zebra striping (alternate rows)
- ✅ Hover effect on rows
- ✅ Excel-like appearance

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

**Screenshot:** ___________

---

### 7. TREATMENT RECOMMENDATIONS - Priority: MEDIUM

#### Test 7.1: Pneumonia Treatment
**Input:** "Viêm phổi"

**Expected:**
- ✅ **💊 Khuyến nghị điều trị:**
- ✅ First-line:
  - Amoxicillin 500mg TID
  - Azithromycin 500mg
- ✅ Evidence: (WHO/IDSA)
- ✅ Monitoring parameters
- ✅ Citation: WHO CAP Guidelines

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 8. XAI EXPLANATION - Priority: MEDIUM

#### Test 8.1: Explanation Display
**Steps:**
1. Any diagnosis query
2. Look for "🧠 Giải thích AI (XAI)"

**Expected:**
- ✅ Collapsible <details> section
- ✅ Key factors listed with weights
  - Symptoms (40%)
  - Labs (35%)
  - Imaging (25%)
- ✅ Reasoning process explained
- ✅ Limitations mentioned

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 9. DIAGNOSIS TREE - Priority: MEDIUM

#### Test 9.1: Chest Pain Tree
**Input:** "Đau ngực crushing"

**Expected:**
- ✅ Decision tree structure
- ✅ Options:
  - Crushing → ACS (HIGH)
  - Sharp → PE/Pneumonia (MODERATE)
  - Burning → GERD (HIGH)
- ✅ Next steps for each
- ✅ Citations

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 10. SCORING SYSTEMS - Priority: LOW

#### Test 10.1: CURB-65
**Input (API test):**
```javascript
calculateCURB65({
  confusion: false,
  urea: 8.5,
  respiratoryRate: 28,
  bloodPressure: true,
  age: 72
})
```

**Expected:**
- ✅ Score: 4/5
- ✅ Mortality: 14.5%
- ✅ Recommendation: ICU consideration

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 11. ERROR HANDLING - Priority: HIGH

#### Test 11.1: No Input
**Steps:**
1. Click Send without typing or uploading

**Expected:**
- ✅ Flash notification: "Vui lòng nhập tin nhắn hoặc đính kèm ảnh"
- ✅ No request sent

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 11.2: Oversized Image
**Steps:**
1. Paste image > 4MB

**Expected:**
- ✅ Error: "Kích thước ảnh vượt quá 4MB"
- ✅ Image not uploaded

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 11.3: Network Error
**Steps:**
1. Disconnect internet
2. Try to send

**Expected:**
- ✅ Error message displayed
- ✅ No crash
- ✅ Can retry after reconnect

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### 12. UI/UX - Priority: MEDIUM

#### Test 12.1: Flash Notifications
**Expected:**
- ✅ Success (green)
- ✅ Error (red)
- ✅ Info (blue)
- ✅ Auto-dismiss after 3s
- ✅ Slide-in/out animation

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 12.2: Animated Typing
**Expected:**
- ✅ Gemini-style line-by-line reveal
- ✅ Click anywhere to fast-forward
- ✅ Smooth animations

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 12.3: 3D Tilt Effects
**Expected:**
- ✅ Buttons tilt on hover
- ✅ Login, Diagnose, Send, Mic
- ✅ Smooth perspective transform

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

#### Test 12.4: Mobile Responsive
**Steps:**
1. Open on mobile (or DevTools mobile view)
2. Test all features

**Expected:**
- ✅ Sidebar toggles correctly
- ✅ Paste works on mobile (long-press → Paste)
- ✅ Tables fit screen
- ✅ Buttons large enough

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

## 🔬 INTEGRATION TESTS

### Integration 1: Full Workflow - Lab Analysis
**Scenario:** Bệnh nhân có kết quả xét nghiệm máu bất thường

**Steps:**
1. Copy screenshot xét nghiệm (WBC: 15000, Glucose: 180)
2. Ctrl+V
3. Diagnose mode ON
4. Type: "Phân tích xét nghiệm này"
5. Send

**Expected Full Response:**
- ✅ Lab analysis table
- ✅ Abnormal highlights (WBC HIGH, Glucose HIGH)
- ✅ Differential diagnosis (Infection + Diabetes)
- ✅ Treatment recommendations
- ✅ Citations (WHO, CDC, Bộ Y tế)
- ✅ XAI explanation
- ✅ Total response time < 10s

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

**Time taken:** _____ seconds

---

### Integration 2: Emergency Triage
**Scenario:** Bệnh nhân đau ngực cấp

**Input:**
```
Bệnh nhân 45 tuổi, nam
Đau ngực crushing, lan lên vai trái
Khó thở, đổ mồ hôi lạnh

Vital signs:
HR: 110, BP: 90/60, SpO2: 92%, Temp: 37.2°C
```

**Expected:**
- ✅ NEWS2 Score: 7/20 - HIGH RISK
- ✅ Diagnosis: ACS (85%)
- ✅ XAI: Tại sao chọn ACS?
- ✅ Treatment: Aspirin, Clopidogrel, Heparin
- ✅ Urgent: ECG, Troponin, Cath lab
- ✅ Citations: ESC STEMI Guidelines

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### Integration 3: X-ray + Symptoms
**Scenario:** Bệnh nhân ho + sốt + X-quang thâm nhiễm

**Steps:**
1. Paste X-quang ngực (với thâm nhiễm)
2. Type: "Bệnh nhân 35 tuổi, ho 5 ngày, sốt 39°C, khó thở"
3. Send

**Expected:**
- ✅ Image analysis: Thâm nhiễm phổi
- ✅ Diagnosis: CAP (78%)
- ✅ CURB-65 score (if vital signs provided)
- ✅ Treatment: Antibiotics
- ✅ Citations: IDSA CAP Guidelines

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

## 📊 PERFORMANCE TESTS

### Perf 1: Response Time
| Test Case | Expected | Actual | Pass/Fail |
|-----------|----------|--------|-----------|
| Simple chat | < 3s | ___ s | ___ |
| Lab analysis | < 5s | ___ s | ___ |
| 1 image diagnosis | < 7s | ___ s | ___ |
| 3 images diagnosis | < 15s | ___ s | ___ |
| Full workflow | < 10s | ___ s | ___ |

---

### Perf 2: Concurrent Users
**Steps:**
1. Open 5 browser tabs
2. Send requests simultaneously

**Expected:**
- ✅ All requests complete
- ✅ No timeout errors
- ✅ Responses correct

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

## 🔒 SECURITY TESTS

### Sec 1: XSS Prevention
**Input:** `<script>alert('XSS')</script>`

**Expected:**
- ✅ Escaped HTML shown
- ✅ No script execution

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

### Sec 2: File Type Validation
**Steps:**
1. Try to paste/upload .exe, .pdf, .txt

**Expected:**
- ✅ Only image types accepted
- ✅ Error for invalid types

**Actual:**
- [ ] Pass
- [ ] Fail: ___________

---

## 🎯 TEST SUMMARY

### Statistics
- **Total Tests:** 30+
- **Passed:** ___ / ___
- **Failed:** ___ / ___
- **Blocked:** ___ / ___
- **Pass Rate:** ___%

### Critical Issues Found
1. ___________
2. ___________
3. ___________

### Recommendations
1. ___________
2. ___________
3. ___________

### Sign-off
- **Tester:** ___________
- **Date:** ___________
- **Status:** ✅ Ready / ⏳ Pending / ❌ Not Ready

---

## 📝 NOTES

### Environment
- OS: ___________
- Browser: ___________
- Node version: ___________
- Server URL: ___________

### Issues Log
| # | Issue | Severity | Status | Notes |
|---|-------|----------|--------|-------|
| 1 | ___ | ___ | ___ | ___ |
| 2 | ___ | ___ | ___ | ___ |

---

**Test Plan Version:** 1.0  
**Created:** October 13, 2025  
**Last Updated:** ___________
