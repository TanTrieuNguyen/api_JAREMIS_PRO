# 🧪 HƯỚNG DẪN TEST JAREMIS AI

## 🚀 KHỞI ĐỘNG SERVER

```bash
cd "d:\Ant's Folder\Code\JAREMIS\api_JAREMIS_PRO-main"
node server.js
```

Sau đó truy cập: **http://localhost:3000**

---

## 🧮 TEST LATEX RENDERING

### Câu hỏi test đề xuất:

#### 1️⃣ **Phương trình bậc 2 đơn giản**
```
Giải phương trình x^2 = 5
```
**Kỳ vọng:** AI trả về công thức với căn bậc hai đẹp: x = √5

#### 2️⃣ **Phương trình bậc 2 phức tạp**
```
Giải phương trình 2x^2 + 3x - 5 = 0
```
**Kỳ vọng:** Công thức nghiệm với phân số và căn thức

#### 3️⃣ **Hệ phương trình**
```
Giải hệ phương trình:
x + y = 10
2x - y = 5
```
**Kỳ vọng:** Các bước giải với công thức đẹp

#### 4️⃣ **Vi phân**
```
Tính đạo hàm của f(x) = x^3 + 2x^2 - 5x + 1
```
**Kỳ vọng:** Công thức đạo hàm render đúng

#### 5️⃣ **Tích phân**
```
Tính tích phân của x^2 từ 0 đến 5
```
**Kỳ vọng:** Công thức tích phân với giới hạn

---

## 📊 TEST MARKDOWN TABLES

### Câu hỏi test:

#### 1️⃣ **Lịch học**
```
Lập lịch học tuần này với 5 môn
```
**Kỳ vọng:** Bảng nhiều cột (Thứ, Tiết, Môn, Phòng, Giáo viên)

#### 2️⃣ **Thời tiết**
```
Thời tiết Hà Nội hôm nay
```
**Kỳ vọng:** Bảng thời tiết nhiều dòng (mỗi khung giờ 1 dòng)

#### 3️⃣ **So sánh sản phẩm**
```
So sánh iPhone 17 Pro vs Samsung S25 Ultra
```
**Kỳ vọng:** Bảng so sánh chi tiết nhiều tiêu chí

---

## 🎨 TEST MARKDOWN FORMATTING

### Câu hỏi test:

#### 1️⃣ **Hướng dẫn từng bước**
```
Cách làm bánh mì nướng
```
**Kỳ vọng:** Headings + numbered list + emoji

#### 2️⃣ **Gợi ý điểm du lịch**
```
Top 10 địa điểm du lịch Việt Nam
```
**Kỳ vọng:** Headings đẹp, bullet list, mô tả ngắn gọn

#### 3️⃣ **Kế hoạch học tập**
```
Lập kế hoạch học tiếng Anh trong 3 tháng
```
**Kỳ vọng:** Headings theo tuần, bullet points từng task

---

## 🧪 TEST EDGE CASES

### 1️⃣ **Code + Math cùng lúc**
```
Viết code Python tính x^2 + 5
```
**Kỳ vọng:** Code block không bị sửa, math render đúng

### 2️⃣ **URL với `/`**
```
Giải thích trang web http://example.com/3/4/test
```
**Kỳ vọng:** URL không bị convert thành phân số

### 3️⃣ **Unicode superscripts**
```
Giải x² = 25
```
**Kỳ vọng:** x² được convert thành $x^2$ và render đẹp

---

## ✅ CHECKLIST VALIDATION

Sau khi test, kiểm tra:

- [ ] **LaTeX inline:** Công thức trong câu render đẹp (không nhấp nháy)
- [ ] **LaTeX display:** Công thức độc lập căn giữa, to hơn
- [ ] **Tables:** Cột đều nhau, center-align, alternating colors
- [ ] **Headings:** Màu xanh pastel dễ nhìn (H1-H4)
- [ ] **Bullets:** Spacing đẹp, không sát nhau
- [ ] **Animation:** Fade-in mượt, không delay
- [ ] **Scrollbar:** Gradient xanh, hover smooth
- [ ] **No flicker:** LaTeX render trước khi hiện
- [ ] **Code blocks:** Không bị auto-wrap math
- [ ] **URLs:** Không bị convert `/` thành phân số

---

## 🐛 XỬ LÝ LỖI

### Nếu LaTeX không render:
1. Mở Developer Console (F12)
2. Kiểm tra lỗi KaTeX
3. Xem log: `console.log` trong `autoWrapMathExpressions()`

### Nếu table không đẹp:
1. Kiểm tra CSS: `.bot-bubble table`
2. Đảm bảo `marked.js` loaded
3. Xem table HTML output

### Nếu animation giật:
1. Kiểm tra `renderBotReplyAnimated()`
2. Đảm bảo `renderMathInElement` chạy trước fade-in
3. Check browser performance

---

## 📞 SUPPORT

Nếu gặp vấn đề, check:
1. `LATEX_RENDERING_FIXED.md` - Chi tiết LaTeX
2. `FINAL_OPTIMIZATION_REPORT.md` - Tổng quan tối ưu
3. Console logs trong browser (F12)

---

**🎉 Chúc test vui vẻ!**
