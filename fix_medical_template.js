// Script to fix medical report template to match images 3,4 and add notes field
const fs = require('fs');

const serverPath = 'server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find and replace the medical report endpoint
const startPattern = "app.get('/api/patient-records/:patientId/medical-report'";
const startIndex = content.indexOf(startPattern);
const endPattern = "\napp.";
const endIndex = content.indexOf(endPattern, startIndex + 100);

if (startIndex === -1 || endIndex === -1) {
  console.error('❌ Could not find endpoint');
  process.exit(1);
}

console.log('✅ Found endpoint, updating...');

const newEndpoint = `app.get('/api/patient-records/:patientId/medical-report', (req, res) => {
  try {
    const { patientId } = req.params;
    const doctor = req.query.doctor;
    
    if (!doctor) return res.status(400).json({ error: 'Thiếu tham số doctor' });
    
    const data = fs.readFileSync(patientRecordsPath, 'utf8');
    const allRecords = JSON.parse(data);
    
    const patientRecords = allRecords.filter(r => 
      r.patientId === patientId && r.doctorUsername === doctor
    );
    
    if (patientRecords.length === 0) {
      return res.status(404).send(\`
        <!DOCTYPE html>
        <html>
        <head><title>Không tìm thấy</title></head>
        <body style="font-family: Arial; padding: 40px; text-align: center;">
          <h2>Không tìm thấy hồ sơ bệnh án</h2>
          <p>PatientID: \${patientId}</p>
        </body>
        </html>
      \`);
    }
    
    patientRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const latestRecord = patientRecords[patientRecords.length - 1];
    const patientInfo = latestRecord.patientInfo || {};
    
    let visitSections = '';
    let notesSections = '';
    
    patientRecords.forEach((record, index) => {
      const visitNum = index + 1;
      
      visitSections += \`
        <div class="section">
          <h2 style="color: #333; font-size: 12pt; font-weight: bold; margin: 15px 0 10px 0; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px;">III. LÝ DO ĐẾN KHÁM BỆNH LẦN \${visitNum}</h2>
          <p><strong>Ngày xuất hiện triệu chứng đầu tiên:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".............................">\${record.patientInfo?.symptomsStartDate || '...........................'}</span></p>
          <p><strong>Triệu chứng:</strong></p>
          <div contenteditable="true" class="placeholder-field" style="border: 1px solid #ddd; padding: 10px; min-height: 60px; border-radius: 4px;" data-placeholder="Mô tả triệu chứng...">
            \${record.symptoms || 'Không có'}
          </div>
          <p><strong>Chỉ số sinh tường cho lần tái khám \${visitNum}:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".............................">............................</span></p>
          <p><strong>Triệu chứng khi lần tái khám \${visitNum}:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".............................">............................</span></p>
          <p><strong>Thuốc uống cho lần tái khám \${visitNum}:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".............................">............................</span></p>
        </div>
      \`;
      
      notesSections += \`
        <div class="section notes-section">
          <h3 style="color: #333; font-weight: bold; text-transform: uppercase; margin: 10px 0 8px 0; border-bottom: 1px solid #999; padding-bottom: 5px;">Chỉ định và dặn dò lần khám \${visitNum}</h3>
          <div contenteditable="true" class="placeholder-field" style="border: 1px solid #999; padding: 10px; min-height: 80px; border-radius: 4px; background: #fff;" data-placeholder="Ghi chú dặn dò...">
            \${record.consultation || ''}
          </div>
        </div>
      \`;
    });
    
    const html = \`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Giấy khám bệnh - \${patientInfo.name || patientId}</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js"></script>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Times New Roman', Times, serif;
            background: #f5f5f5;
            padding: 20px;
          }
          .container {
            max-width: 210mm;
            margin: 0 auto;
            background: white;
            padding: 20mm;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
            min-height: 297mm;
            line-height: 1.5;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid #000;
            padding-bottom: 10px;
            margin-bottom: 15px;
          }
          .header-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
          }
          .header-left {
            text-align: left;
            font-weight: 500;
          }
          .header-right {
            text-align: right;
            font-weight: 500;
          }
          h1 {
            font-size: 16pt;
            font-weight: bold;
            margin: 15px 0 10px 0;
            text-align: center;
            text-transform: uppercase;
            color: #333;
          }
          h2 {
            font-size: 12pt;
            font-weight: bold;
            margin: 15px 0 10px 0;
            text-transform: uppercase;
            color: #333;
          }
          h3 {
            font-size: 11pt;
            font-weight: bold;
            margin: 10px 0 5px 0;
            color: #333;
          }
          .section {
            margin: 15px 0;
            page-break-inside: avoid;
          }
          .row {
            margin: 6px 0;
            line-height: 1.4;
          }
          [contenteditable="true"] {
            border-bottom: 1px dotted #999;
            padding: 2px 5px;
            min-width: 50px;
            display: inline-block;
            outline: none;
            background: transparent;
          }
          [contenteditable="true"]:focus {
            background: #fffacd;
            border-bottom: 1px solid #333;
          }
          .placeholder-field:empty:before {
            content: attr(data-placeholder);
            color: #ccc;
          }
          .photo-box {
            width: 3.5cm;
            height: 4.5cm;
            border: 2px solid #000;
            float: right;
            margin: 0 0 10px 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10pt;
            color: #999;
            background: #f9f9f9;
          }
          .checkbox-group {
            margin: 5px 0;
          }
          .checkbox-group label {
            margin-right: 15px;
            cursor: pointer;
          }
          .signature-section {
            margin-top: 40px;
            text-align: right;
          }
          .signature-box {
            display: inline-block;
            text-align: center;
            margin: 0 20px 0 0;
            width: 45%;
          }
          .signature-box p {
            margin: 3px 0;
            font-size: 11pt;
          }
          .notes-section {
            border: 1px solid #999;
            padding: 10px;
            background: #fff;
            margin: 10px 0;
          }
          .toolbar {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 1000;
          }
          .toolbar button {
            display: block;
            width: 100%;
            margin: 5px 0;
            padding: 8px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            transition: all 0.3s;
          }
          .btn-pdf { background: #f44336; color: white; }
          .btn-docx { background: #2196F3; color: white; }
          .btn-txt { background: #4CAF50; color: white; }
          .btn-print { background: #FF9800; color: white; }
          .btn-edit { background: #9C27B0; color: white; }
          .toolbar button:hover { opacity: 0.85; }
          @media print {
            body { background: white; padding: 0; }
            .toolbar { display: none; }
            .container { box-shadow: none; margin: 0; }
            .notes-section { display: none !important; }
          }
          @page {
            size: A4;
            margin: 15mm;
          }
        </style>
      </head>
      <body>
        <div class="toolbar">
          <button class="btn-edit" onclick="toggleEdit()">Chỉnh sửa</button>
          <button class="btn-pdf" onclick="exportPDF()">Xuất PDF</button>
          <button class="btn-docx" onclick="exportDOCX()">Xuất DOCX</button>
          <button class="btn-txt" onclick="exportTXT()">Xuất TXT</button>
          <button class="btn-print" onclick="window.print()">In</button>
        </div>

        <div class="container" id="medical-record">
          <div class="header">
            <div class="header-row">
              <div class="header-left">
                <strong>BỘ Y TẾ</strong><br>
                Số Y Tế: <span contenteditable="true" class="placeholder-field" data-placeholder=".....">..........................</span><br>
                Bệnh viện: <span contenteditable="true" class="placeholder-field" data-placeholder=".....">..........................</span><br>
                SĐT: <span contenteditable="true" class="placeholder-field" data-placeholder=".....">..........................</span>
              </div>
              <div class="header-right">
                <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br>
                <strong>Độc lập – Tự do – Hạnh phúc</strong><br>
                <div style="border-top: 1px solid #000; margin: 5px 0;"></div>
                Địa chỉ: <span contenteditable="true" class="placeholder-field" data-placeholder=".....">..........................</span>
              </div>
            </div>
          </div>
          
          <h1>GIẤY KHÁM BỆNH</h1>
          
          <div class="section">
            <div class="photo-box" contenteditable="false">Ảnh 3x4</div>
            <div class="row">
              <strong>Họ và tên:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="...">\${patientInfo.name || '.............................'}</span>
            </div>
            <div class="row">
              <strong>Tuổi:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="...">\${patientInfo.age || '..'}</span>
              <span style="margin-left: 30px;"><strong>Giới tính:</strong> <label><input type="checkbox" \${patientInfo.gender === 'Nam' ? 'checked' : ''}> Nam</label> <label><input type="checkbox" \${patientInfo.gender === 'Nữ' ? 'checked' : ''}> Nữ</label></span>
            </div>
            <div class="row">
              <strong>Số CCCD/Hộ Chiếu:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span>
            </div>
            <div class="row">
              <strong>Ngày cấp:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".../.../...">...../.../.....</span>
              <span style="margin-left: 30px;"><strong>Nơi cấp:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................</span></span>
            </div>
            <div class="row">
              <strong>Địa chỉ:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span>
            </div>
            <div class="row">
              <strong>Số thẻ BHYT:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................</span>
              <span style="margin-left: 30px;"><strong>Giá trị đến:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".../.../...">...../.../.....</span></span>
            </div>
            <div class="row">
              <strong>Ngày khám:</strong> <span contenteditable="true" class="placeholder-field" data-placeholder=".../.../...">\${new Date(latestRecord.timestamp).toLocaleDateString('vi-VN')}</span>
            </div>
          </div>

          <div class="section">
            <h2>I. TIỀN SỬ BỆNH TẬT</h2>
            
            <h3>1. Tiền sử gia đình</h3>
            <p>Có ai trong gia đình mắc bệnh: truyền nhiễm, tim mạch, đái tháo đường, lao, hen, ung thư, động kinh, tâm thần, bệnh khác:</p>
            <div class="checkbox-group">
              <label><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="margin-top: 5px;">Nếu "có", đã nghĩ ghi cụ thể tên bệnh: <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span></p>
            
            <h3>2. Tiền sử bệnh bản thân</h3>
            <p>Tiền sử bản thân: Bệnh đã/đang mắc: truyền nhiễm, tim mạch, đái tháo đường, lao, hen, ung thư, động kinh, tâm thần, bệnh khác:</p>
            <div class="checkbox-group">
              <label><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="margin-top: 5px;">Nếu "có", đã nghĩ ghi cụ thể tên bệnh: <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span></p>
            
            <h3>3. Câu hỏi khác (nếu có)</h3>
            <p>a) Ông (bà) đang điều trị bệnh gì không? Nếu có, xin hãy kê các thuốc đang dùng và liều lượng: <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span></p>
            <p>b) Tiền sử thai sản (Đối với phụ nữ): <span contenteditable="true" class="placeholder-field" data-placeholder="............">................................................................</span></p>
          </div>

          <div class="section">
            <h2>II. KHÁM BỆNH</h2>
            \${visitSections}
          </div>

          <div class="section">
            <h2>IV. GHI CHÚ - DẶN DÒ CỦA BÁC SĨ</h2>
            \${notesSections}
          </div>

          <div class="signature-section">
            <div class="signature-box">
              <p>........... ngày ...... tháng ...... năm ........</p>
              <p style="font-weight: bold; margin-top: 10px;">NGƯỜI ĐỨNG ĐẦU CƠ SỞ Y TẾ</p>
              <p style="font-size: 9pt;">(Ký và ghi rõ họ tên)</p>
              <br><br><br>
              <p contenteditable="true" class="placeholder-field" data-placeholder="................................................">................................................</p>
            </div>
            <div class="signature-box">
              <p style="font-weight: bold; margin-top: 10px;">BÁC SĨ KHÁM BỆNH</p>
              <p style="font-size: 9pt;">(Ký và ghi rõ họ tên)</p>
              <br><br><br>
              <p contenteditable="true" class="placeholder-field" data-placeholder="...">\${doctor}</p>
            </div>
          </div>
        </div>

        <script>
          let editMode = false;
          
          function toggleEdit() {
            editMode = !editMode;
            const editables = document.querySelectorAll('[contenteditable]');
            editables.forEach(el => {
              if (el.classList.contains('placeholder-field')) {
                el.style.background = editMode ? '#fffacd' : 'transparent';
              }
            });
            alert(editMode ? 'Chế độ chỉnh sửa: BẬT' : 'Chế độ chỉnh sửa: TẮT');
          }

          function exportPDF() {
            const element = document.getElementById('medical-record');
            const opt = {
              margin: 10,
              filename: 'giay-kham-benh-\${patientId}.pdf',
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true },
              jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };
            html2pdf().set(opt).from(element).save();
          }

          function exportDOCX() {
            const element = document.getElementById('medical-record');
            let html = element.innerHTML.replace(/<div class="notes-section">.*?<\\/div>/gs, '');
            const converted = htmlDocx.asBlob(html);
            saveAs(converted, 'giay-kham-benh-\${patientId}.docx');
          }

          function exportTXT() {
            const element = document.getElementById('medical-record');
            let text = element.innerText.replace(/Ảnh 3x4/g, '[Ảnh]').replace(/\\n\\n\\n+/g, '\\n\\n');
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            saveAs(blob, 'giay-kham-benh-\${patientId}.txt');
          }

          document.querySelectorAll('.placeholder-field').forEach(el => {
            el.addEventListener('focus', function() {
              if (this.innerText.match(/^\\.*$/)) {
                this.innerText = '';
              }
            });
          });
        </script>
      </body>
      </html>
    \`;
    
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('Get medical report error:', e);
    res.status(500).send(\`
      <!DOCTYPE html>
      <html>
      <head><title>Lỗi</title></head>
      <body style="font-family: Arial; padding: 40px; text-align: center;">
        <h2>Lỗi server</h2>
        <p>\${e.message}</p>
      </body>
      </html>
    \`);
  }
});
`;

content = content.substring(0, startIndex) + newEndpoint + content.substring(endIndex);
fs.writeFileSync(serverPath, content, 'utf8');
console.log('✅ Medical report template updated!');

// Now update patient info modal in index.html to add notes field
const indexPath = 'public/index.html';
let indexContent = fs.readFileSync(indexPath, 'utf8');

// Find and add notes field to modal
const notesFieldHTML = `
        <div class="form-row">
          <label style="color:var(--text-secondary-color);font-size:13px;">Ghi chú/Mô tả thêm</label>
          <textarea id="patient-notes" placeholder="Ghi chú ngắn gọn về tình trạng bệnh nhân, không lặp lại toàn bộ lời dặn dò..." style="background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);padding:8px 10px;border-radius:6px;min-height:60px;resize:vertical;"></textarea>
        </div>`;

// Find the pregnancy history field and add notes after it
const pregnancyIndex = indexContent.indexOf('id="patient-pregnancy-history"');
if (pregnancyIndex !== -1) {
  const closeDiv = indexContent.indexOf('</div>', pregnancyIndex);
  if (closeDiv !== -1) {
    const insertPoint = closeDiv + 6;
    indexContent = indexContent.substring(0, insertPoint) + notesFieldHTML + indexContent.substring(insertPoint);
    console.log('✅ Added notes field to patient info modal');
  }
}

// Update the patientInfo object collection to include notes
const submitProfessionalIndex = indexContent.indexOf('const patientInfo = {');
if (submitProfessionalIndex !== -1) {
  const endBracket = indexContent.indexOf('};', submitProfessionalIndex);
  if (endBracket !== -1) {
    // Check if we need to add notes to the first occurrence
    const snippet = indexContent.substring(submitProfessionalIndex, endBracket + 2);
    if (!snippet.includes('notes:')) {
      // Find the pregnancyHistory line and add notes after it
      const pregnancyLine = snippet.indexOf('pregnancyHistory:');
      if (pregnancyLine !== -1) {
        const endOfLine = snippet.indexOf('\\n', pregnancyLine);
        const newSnippet = snippet.substring(0, endOfLine + 1) + 
          "                notes: document.getElementById('patient-notes').value.trim() || '',\\n" +
          snippet.substring(endOfLine + 1);
        indexContent = indexContent.substring(0, submitProfessionalIndex) + 
          newSnippet + indexContent.substring(endBracket + 2);
        console.log('✅ Updated patientInfo object to include notes');
      }
    }
  }
}

// Reset notes field in openPatientInfoModal
const openPatientIndex = indexContent.indexOf('function openPatientInfoModal()');
if (openPatientIndex !== -1) {
  const endFunction = indexContent.indexOf('}', openPatientIndex + 500);
  if (endFunction !== -1) {
    const beforeEnd = indexContent.lastIndexOf('document.getElementById', endFunction);
    if (beforeEnd !== -1) {
      const resetLine = "document.getElementById('patient-notes').value = '';\\n                ";
      const insertIdx = indexContent.indexOf(';', beforeEnd) + 1;
      indexContent = indexContent.substring(0, insertIdx) + '\\n                ' + resetLine + indexContent.substring(insertIdx);
      console.log('✅ Added notes reset to openPatientInfoModal');
    }
  }
}

fs.writeFileSync(indexPath, indexContent, 'utf8');
console.log('✅ Updated index.html with notes field');

// Update all patient records to include notes field
const patientRecordsPath = 'patientRecords.json';
if (fs.existsSync(patientRecordsPath)) {
  try {
    const records = JSON.parse(fs.readFileSync(patientRecordsPath, 'utf8'));
    records.forEach(record => {
      if (record.patientInfo && !record.patientInfo.notes) {
        record.patientInfo.notes = '';
      }
    });
    fs.writeFileSync(patientRecordsPath, JSON.stringify(records, null, 2), 'utf8');
    console.log('✅ Updated all patient records to include notes field');
  } catch (e) {
    console.warn('⚠️ Could not update patientRecords.json:', e.message);
  }
}

console.log('\\n✅ All updates completed successfully!');
