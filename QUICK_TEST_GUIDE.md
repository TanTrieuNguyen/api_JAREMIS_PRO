# 🧪 HƯỚNG DẪN TEST - MARKDOWN TABLE & CITATION

## ✅ Cách test nhanh

### 🔍 Mở trang web
1. Truy cập: http://localhost:3000
2. Server đang chạy: ✅

---

## 📋 Test Case 1: Markdown Table trong Diagnose

### Bước 1: Vào Diagnose Mode
- Click nút **"Chế độ Chẩn đoán"** (hoặc tương tự)
- Icon: 🩺

### Bước 2: Nhập triệu chứng
```
ho khan, lâu lâu bị sốt, tức ngực
```

### Bước 3: Submit & Đợi
- Click **Submit**
- Đợi AI phản hồi (30-60s)

### Bước 4: Kiểm tra kết quả

#### ✅ Phần "🩺 CHẨN ĐOÁN PHÂN BIỆT"

**Kỳ vọng thấy:**
- Bảng HTML đẹp với 4 cột:
  - `Bệnh`
  - `Mã ICD-10`
  - `Xác suất`
  - `Cơ sở`
- Border rõ ràng
- Zebra stripes (dòng chẵn/lẻ khác màu)
- Hover vào dòng → highlight

**KHÔNG được thấy:**
- ❌ Text thô: `| Bệnh | Mã ICD-10 | ...`
- ❌ Ký tự: `|:-----|:----------|:---------|`
- ❌ Dấu gạch ngang: `|------|-----------|`

#### ✅ Phần "📖 NGUỒN THAM KHẢO"

**Kỳ vọng thấy:**
- Nhiều nút bấm (buttons) nằm ngang:
  - `📚 🌍 WHO Guidelines: WHO - Unknown...`
  - `📚 📚 Research Database: PubMed - Medical...`
  - `📚 🏥 CDC Guidelines: CDC - Unknown...`
- Gradient background (xanh pastel)
- Border radius (pill shape)

**Test interaction:**
1. **Hover vào nút** → Kỳ vọng:
   - Màu sáng hơn
   - Nút nổi lên (translateY -1px)
   - Shadow rõ hơn
2. **Click vào nút** → Kỳ vọng:
   - Mở tab mới
   - Dẫn đến WHO/PubMed/CDC

**KHÔNG được thấy:**
- ❌ List dài với card:
  ```
  1. 🌍 WHO Guidelines
     - [WHO - Unknown](https://www.who.int/...)
     - Độ tin cậy: HIGHEST
  ```
- ❌ Link URL dài ngoằn hiển thị toàn bộ

---

## 📋 Test Case 2: Markdown Table trong Chat

### Bước 1: Vào Chat Mode
- Click nút **"Chat"** (hoặc thoát khỏi Diagnose mode)

### Bước 2: Nhập câu hỏi
```
So sánh iPhone 15 và iPhone 16 dạng bảng
```

### Bước 3: Submit & Đợi
- Click **Send** hoặc **Enter**
- Đợi AI phản hồi (5-10s)

### Bước 4: Kiểm tra kết quả

**Kỳ vọng thấy:**
- Bảng HTML đẹp so sánh 2 model
- Các cột: Tính năng, iPhone 15, iPhone 16
- Border, zebra stripes, hover effect

**KHÔNG được thấy:**
- ❌ Text thô markdown table

---

## 📋 Test Case 3: LaTeX + Table (Combo)

### Bước 1: Chat Mode
- Vào Chat mode

### Bước 2: Nhập câu hỏi
```
Tạo bảng so sánh công thức toán: phương trình bậc 2 và bậc 3
```

### Bước 3: Kiểm tra kết quả

**Kỳ vọng thấy:**
- Bảng HTML với:
  - Cột 1: Loại phương trình
  - Cột 2: Công thức (LaTeX render đúng)
  - VD: $ax^2 + bx + c = 0$
- LaTeX không flicker
- Bảng không hiển thị ký tự thô

---

## 🐛 Lỗi thường gặp & Cách fix

### Lỗi 1: Vẫn thấy `| --- |` thô

**Nguyên nhân:** Browser cache
**Cách fix:**
1. Hard refresh: `Ctrl + Shift + R` (Chrome)
2. Hoặc: `Ctrl + F5`
3. Hoặc: Clear cache + reload

### Lỗi 2: Citation vẫn hiển thị list card

**Nguyên nhân:** Dùng fallback client-side (server không trả citationsHtml)
**Cách fix:**
1. Check console log: `result.citationsHtml` có giá trị không?
2. Nếu không → Check server response
3. Restart server: `Ctrl + C` → `node server.js`

### Lỗi 3: CSS không apply cho `.citation-btn`

**Nguyên nhân:** CSS chưa load
**Cách fix:**
1. Check `<style>` trong `<head>` có `.citation-btn` không?
2. Hard refresh
3. Kiểm tra DevTools → Elements → Computed styles

### Lỗi 4: Click citation button không mở tab mới

**Nguyên nhân:** Browser block popup
**Cách fix:**
1. Allow popups cho localhost:3000
2. Hoặc: Right click → "Open in new tab"

---

## 📊 Checklist nhanh

Đánh dấu ✅ nếu pass:

### Diagnose Mode
- [ ] Bảng chẩn đoán phân biệt render đúng (không có `| --- |`)
- [ ] Citation render thành button (không phải list)
- [ ] Citation button có hover effect
- [ ] Click citation button → mở tab mới

### Chat Mode
- [ ] Bảng markdown render đúng
- [ ] LaTeX + Table combo hoạt động
- [ ] Không có flicker khi render LaTeX

### Performance
- [ ] Response time < 60s (Diagnose)
- [ ] Response time < 10s (Chat)
- [ ] Không crash server

---

## 🎯 Kết quả mong đợi

### ✅ PASS nếu:
1. **Markdown table** → Bảng HTML đẹp (100%)
2. **Citation** → Nút button, không phải list (100%)
3. **LaTeX** → Render đúng, không flicker (100%)
4. **Hover effect** → Button có animation (100%)

### ❌ FAIL nếu:
1. Vẫn thấy `| --- |` text thô
2. Vẫn thấy list card citation
3. LaTeX flicker hoặc không render
4. Button không có hover effect

---

## 📞 Debug Commands

### Kiểm tra server log
```powershell
# Nếu server đang chạy trong terminal
# Xem output để tìm errors
```

### Test API trực tiếp (Optional)
```powershell
curl http://localhost:3000/api/diagnose -X POST -H "Content-Type: application/json" -d '{"symptoms":"đau đầu, sốt"}'
```

### Check browser console
1. `F12` → Console tab
2. Tìm errors (màu đỏ)
3. Kiểm tra warnings (màu vàng)

---

## ✅ Kết luận

Nếu tất cả test cases pass → **Hệ thống hoạt động hoàn hảo!** 🎉

Nếu có lỗi → Xem phần "Lỗi thường gặp & Cách fix" phía trên.

---

**Happy Testing!** 🧪
