const fs = require('fs');

// Read server.js
const serverPath = 'server.js';
let content = fs.readFileSync(serverPath, 'utf8');

// Find and replace the header section in medical report
const oldHeader = `          <div class="header">
            <div class="header-left">
              BỘ Y TẾ<br>
              Số Y Tế: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span><br>
              Bệnh viện: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span><br>
              SĐT: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span>
            </div>
            <div class="header-right">
              CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM<br>
              Độc lập – Tự do – Hạnh phúc<br>
              <div style="border-top: 1px solid #000; margin: 5px 0;"></div>
              Địa chỉ: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span>
            </div>
          </div>`;

const newHeader = `          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 15px; align-items: start;">
            <div style="text-align: left; font-size: 11pt; line-height: 1.3;">
              <strong>BỘ Y TẾ</strong><br>
              Số Y Tế: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span><br>
              Bệnh viện: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span><br>
              SĐT: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span>
            </div>
            <div style="text-align: right; font-size: 11pt; line-height: 1.3;">
              <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br>
              Độc lập – Tự do – Hạnh phúc<br>
              <div style="border-top: 1px solid #000; margin: 5px 0;"></div>
              Địa chỉ: <span contenteditable="true" class="placeholder-field" data-placeholder=".......................">............................</span>
            </div>
          </div>`;

content = content.replace(oldHeader, newHeader);

// Update TIỀN SỬ BỆNH TẬT section to match figure 3,4
const oldTienSu = `          <div class="section">
            <h2>I. TIỀN SỬ BỆNH TẬT</h2>
            
            <h3>1. Tiền sử gia đình</h3>
            <p>Có ai trong gia đình mắc bệnh: truyền nhiễm, tim mạch, đái tháo đường, lao, hen, ung thư, động kinh, tâm thần, bệnh khác:</p>
            <div class="checkbox-group">
              <label><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="margin-top: 5px;">Ghi cụ thể: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            
            <h3>2. Tiền sử bệnh bản thân</h3>
            <p>Bệnh đã/đang mắc: truyền nhiễm, tim mạch, đái tháo đường, lao, hen, ung thư, động kinh, tâm thần, bệnh khác:</p>
            <div class="checkbox-group">
              <label><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="margin-top: 5px;">Ghi cụ thể: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            
            <h3>3. Câu hỏi khác</h3>
            <p>a) Bệnh đang điều trị và thuốc đang dùng: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            <p>b) Tiền sử thai sản (nếu là nữ): <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
          </div>`;

const newTienSu = `          <div class="section">
            <h2 style="margin: 15px 0 10px 0; font-size: 12pt; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 5px;">TIỀN SỬ BỆNH TẬT</h2>
            
            <h3 style="margin-top: 12px; margin-bottom: 8px; font-size: 11pt;">1. Tiền sử gia đình</h3>
            <p style="line-height: 1.4; margin: 6px 0;">Có ai trong gia đình (ba) mắc một trong các bệnh: truyền nhiễm, tim mạch, đái tháo đường, lao, hen phổi quản, ung thư, động kinh, rối loạn tâm thần, bệnh khác:</p>
            <div class="checkbox-group" style="margin: 4px 0;">
              <label style="margin-right: 20px;"><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="line-height: 1.4; margin: 6px 0;">Nếu "có", đã nghĩ ghi cụ thể tên bệnh: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            
            <h3 style="margin-top: 12px; margin-bottom: 8px; font-size: 11pt;">2. Tiền sử bệnh bản thân</h3>
            <p style="line-height: 1.4; margin: 6px 0;">Tiền sử bản thân: Ông (bà) đã/đang mắc bệnh, tình trạng bệnh nào sau đây không: Bệnh truyền nhiễm, tim mạch, đái tháo đường, lao, hen phổi quản, ung thư, động kinh, rối loạn tâm thần, bệnh khác:</p>
            <div class="checkbox-group" style="margin: 4px 0;">
              <label style="margin-right: 20px;"><input type="checkbox"> Không</label>
              <label><input type="checkbox"> Có</label>
            </div>
            <p style="line-height: 1.4; margin: 6px 0;">Nếu "có", đã nghĩ ghi cụ thể tên bệnh: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            
            <h3 style="margin-top: 12px; margin-bottom: 8px; font-size: 11pt;">3. Câu hỏi khác (nếu có)</h3>
            <p style="line-height: 1.4; margin: 6px 0;">a) Ông (bà) đang điều trị bệnh gì không? Nếu có, xin hãy kê các thuốc đang dùng và liều lượng: <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
            <p style="line-height: 1.4; margin: 6px 0;">b) Tiền sử thai sản (Đối với phụ nữ): <span contenteditable="true" class="placeholder-field" data-placeholder="................................................................">................................................................</span></p>
          </div>`;

content = content.replace(oldTienSu, newTienSu);

// Write back
fs.writeFileSync(serverPath, content, 'utf8');
console.log('✅ Template updated successfully!');
