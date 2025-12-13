/**
 * JAREMIS - Medical Record Template Generator
 * Tạo Giấy khám bệnh theo mẫu Bộ Y Tế
 */

const fs = require('fs');
const path = require('path');

/**
 * Generate official medical examination certificate (Giấy khám bệnh)
 */
function generateMedicalRecordHTML(patientRecord) {
  const { patientId, patientName, createdBy, createdAt, totalVisits, consultations } = patientRecord;
  
  // Sort consultations by date (oldest first for medical record)
  const sortedConsultations = [...consultations].sort((a, b) => 
    new Date(a.consultationDate) - new Date(b.consultationDate)
  );
  
  const firstVisit = sortedConsultations[0];
  const latestVisit = sortedConsultations[sortedConsultations.length - 1];
  
  let html = `
<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Giấy khám bệnh - ${patientName || patientId}</title>
  
  <!-- Font Awesome for icons -->
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  
  <!-- html2pdf library for PDF export -->
  <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
  
  <style>
    @page {
      size: A4;
      margin: 1.5cm;
    }
    
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 13pt;
      line-height: 1.5;
      max-width: 21cm;
      margin: 0 auto;
      padding: 20px;
      background: #f5f5f5;
    }
    
    .medical-certificate {
      background: white;
      padding: 30px 40px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      min-height: 29.7cm;
    }
    
    /* Header - Using table for Word compatibility */
    .header-table {
      width: 100%;
      border: none;
      margin-bottom: 10px;
      border-collapse: collapse;
    }
    
    .header-table td {
      border: none;
      padding: 2px;
      vertical-align: top;
    }
    
    .header-left {
      text-align: left;
      font-weight: bold;
      width: 50%;
    }
    
    .header-right {
      text-align: right;
      font-weight: bold;
      width: 50%;
      white-space: nowrap;
    }
    
    .header-center {
      text-align: center;
      font-size: 12pt;
      white-space: nowrap;
    }
    
    .header-underline {
      text-decoration: underline;
      font-style: italic;
    }
    
    .title {
      text-align: center;
      font-size: 18pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 30px 0 25px 0;
      letter-spacing: 1px;
    }
    
    /* Patient info section - simple table with photo */
    .patient-info-container {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    
    .patient-info-container td {
      border: none;
    }
    
    .photo-box {
      width: 90px;
      height: 120px;
      border: 2px solid #000;
      text-align: center;
      vertical-align: middle;
      font-size: 11pt;
      font-style: italic;
      padding: 10px;
    }
    
    .patient-info {
      padding-left: 20px;
      vertical-align: top;
    }
    
    .info-row {
      margin-bottom: 8px;
      display: flex;
      word-wrap: break-word;
    }
    
    .info-label {
      min-width: 180px;
      display: inline-block;
      flex-shrink: 0;
    }
    
    .info-value {
      flex: 1;
      word-wrap: break-word;
      overflow-wrap: break-word;
      max-width: 100%;
    }
    
    .info-value {
      flex: 1;
      border-bottom: 1px dotted #333;
      padding-left: 5px;
    }
    
    .checkbox-group {
      display: inline-block;
      margin-left: 20px;
    }
    
    .checkbox {
      display: inline-block;
      width: 18px;
      height: 18px;
      border: 2px solid #333;
      margin: 0 5px;
      vertical-align: middle;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .checkbox.checked {
      background: #333;
      position: relative;
    }
    
    .checkbox.checked::after {
      content: '✓';
      color: white;
      position: absolute;
      top: -3px;
      left: 3px;
      font-size: 14pt;
      font-weight: bold;
    }
    
    .checkbox:hover {
      border-color: #666;
      background: #f0f0f0;
    }
    
    .checkbox.checked:hover {
      background: #555;
    }
    
    .editable-field {
      padding: 2px 4px;
      border-radius: 3px;
      transition: background 0.2s;
    }
    
    .editable-field[contenteditable="true"] {
      background: #fffacd;
      border: 1px dashed #999;
      outline: none;
    }
    
    /* Section title */
    .section-title {
      font-weight: bold;
      text-transform: uppercase;
      text-align: center;
      font-size: 14pt;
      margin: 25px 0 15px 0;
      letter-spacing: 0.5px;
    }
    
    .section-number {
      font-weight: bold;
      margin: 15px 0 8px 0;
    }
    
    .subsection {
      margin-left: 20px;
      margin-bottom: 10px;
    }
    
    /* Examination visits */
    .visit-section {
      margin-bottom: 20px;
      page-break-inside: avoid;
    }
    
    .visit-title {
      font-weight: bold;
      margin: 15px 0 10px 0;
    }
    
    .bullet-list {
      margin-left: 30px;
    }
    
    .bullet-item {
      margin-bottom: 8px;
      text-indent: -15px;
      margin-left: 15px;
    }
    
    .bullet-item::before {
      content: '• ';
      font-weight: bold;
    }
    
    /* Footer - Using table for Word compatibility */
    .footer-table {
      width: 100%;
      border: none;
      margin-top: 50px;
      border-collapse: collapse;
    }
    
    .footer-table td {
      border: none;
      padding: 5px;
      vertical-align: top;
      text-align: center;
    }
    
    .signature-box {
      text-align: center;
      width: 50%;
    }
    
    .signature-date {
      font-style: italic;
      margin-bottom: 10px;
    }
    
    .signature-title {
      font-weight: bold;
      margin-bottom: 60px;
    }
    
    .signature-name {
      font-style: italic;
    }
    
    @media print {
      body {
        background: white;
        padding: 0;
        margin: 0;
      }
      .medical-certificate {
        box-shadow: none;
        padding: 30px 40px;
        margin: 0;
      }
      button, [onclick*="print"], [onclick*="download"], [onclick*="edit"], [style*="position: fixed"] {
        display: none !important;
      }
    }
    
    /* Ensure consistent rendering for PDF export */
    * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
  </style>
</head>
<body>
  <div class="medical-certificate">
    <!-- HEADER - Using table for Word compatibility -->
    <table class="header-table">
      <tr>
        <td class="header-left">
          <strong>BỘ Y TẾ</strong><br>
          <span style="font-size: 11pt;">Sở Y tế: <span class="header-underline editable-field">Hệ thống JAREMIS</span></span><br>
          <span style="font-size: 11pt;">Bệnh viện <span class="header-underline editable-field">AI Medical Center</span></span><br>
          <span style="font-size: 11pt;">SĐT: <span class="header-underline editable-field">1900-xxxx</span></span>
        </td>
        <td class="header-right">
          <strong>CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</strong><br>
          <span class="header-underline" style="font-size:12pt; font-style:italic;">Độc lập - Tự do - Hạnh phúc</span>
        </td>
      </tr>
    </table>
    
    <!-- TITLE -->
    <div class="title">GIẤY KHÁM BỆNH</div>
    
    <!-- PATIENT INFORMATION WITH PHOTO -->
    <table class="patient-info-container" style="width:100%; border-collapse:collapse; margin-bottom:20px;">
      <tr>
        <td class="photo-box" style="width:90px; height:120px; border:2px solid #000; text-align:center; vertical-align:middle; font-size:11pt; font-style:italic; padding:10px;">
          Ảnh 3x4
        </td>
        
        <td class="patient-info" style="padding-left:20px; vertical-align:top; border:none;">
          <div class="info-row">
            <span class="info-label">Họ và tên:</span>
            <span class="info-value">${patientName || patientId}</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Giới tính:</span>
            <span style="margin-left: 20px;">
              <span class="checkbox ${latestVisit.patientInfo?.gender === 'Nam' ? 'checked' : ''}" data-group="gender" data-value="Nam"></span> Nam
              <span class="checkbox ${latestVisit.patientInfo?.gender === 'Nữ' ? 'checked' : ''}" data-group="gender" data-value="Nữ" style="margin-left: 50px;"></span> Nữ
            </span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Tuổi:</span>
            <span class="info-value">${latestVisit.patientInfo?.age || '.....................'}</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Số CCCD/Hộ Chiếu:</span>
            <span class="info-value">${patientId}</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Ngày cấp:</span>
            <span class="info-value">${formatDate(createdAt)} tại .....................</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Địa chỉ:</span>
            <span class="info-value">${latestVisit.patientInfo?.address || '.....................................................................................'}</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Số thẻ BHYT:</span>
            <span class="info-value">...........................................................................................</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Giá trị từ ngày:</span>
            <span class="info-value">..................... đến ngày .....................</span>
          </div>
          
          <div class="info-row">
            <span class="info-label">Ngày đến khám:</span>
            <span class="info-value">${formatDate(firstVisit.consultationDate)}</span>
          </div>
        </td>
      </tr>
    </table>
    
    <!-- MEDICAL HISTORY SECTION - Below patient info -->
    <div class="section-title" style="text-align:center; font-weight:bold; font-size:14pt; margin:25px 0 15px 0; text-transform:uppercase;">TIỀN SỬ BỆNH TẬT</div>
    
    <div class="section-number" style="font-weight:bold; margin:15px 0 8px 0;">1. Tiền sử gia đình</div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      Có ai trong gia đình ông (bà) mắc một trong các bệnh: truyền nhiễm, tim mạch, đái tháo đường, lao, hen phế quản, ung thư, động kinh, rối loạn tâm thần, bệnh khác:
    </div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      <span class="checkbox" data-group="family-history" data-value="Không"></span> Không
      <span class="checkbox" data-group="family-history" data-value="Có" style="margin-left: 30px;"></span> Có
    </div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      Nếu "có", đề nghị ghi cụ thể tên bệnh: ${latestVisit.patientInfo?.familyHistory || '........................................................'}
    </div>
    
    <div class="section-number" style="font-weight:bold; margin:15px 0 8px 0;">2. Tiền sử bản thân</div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      Tiền sử bản thân: Ông (bà) đã/đang mắc bệnh, tình trạng bệnh nào sau đây không: Bệnh truyền nhiễm, bệnh tim mạch, đái tháo đường, lao, hen phế quản, ung thư, động kinh, rối loạn tâm thần, bệnh khác:
    </div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      <span class="checkbox ${!latestVisit.patientInfo?.medicalHistory ? 'checked' : ''}" data-group="medical-history" data-value="Không"></span> Không
      <span class="checkbox ${latestVisit.patientInfo?.medicalHistory ? 'checked' : ''}" data-group="medical-history" data-value="Có" style="margin-left: 30px;"></span> Có
    </div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      Nếu "có", đề nghị ghi cụ thể tên bệnh: ${latestVisit.patientInfo?.medicalHistory || '........................................................'}
    </div>
    
    <div class="section-number" style="font-weight:bold; margin:15px 0 8px 0;">3. Câu hỏi khác (nếu có)</div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      a) Ông (bà) đang điều trị bệnh gì không? Nếu có, xin hãy liệt kê các thuốc đang dùng và liều lượng:<br>
      <span style="margin-left: 20px;">${latestVisit.patientInfo?.currentMedications ? latestVisit.patientInfo.currentMedications.join(', ') : '........................................................'}</span>
    </div>
    <div class="subsection" style="margin-left:20px; margin-bottom:10px;">
      b) Tiền sử thai sản (Đối với phụ nữ): ${latestVisit.patientInfo?.pregnancyHistory || '........................................................'}
    </div>
    
    <!-- EXAMINATION VISITS -->
    ${generateExaminationVisits(sortedConsultations)}
    
    <!-- FOOTER - Using table for Word compatibility -->
    <table class="footer-table">
      <tr>
        <td class="signature-box">
          <div class="signature-title">Người đứng đầu cơ sở y tế</div>
          <div class="signature-name" style="margin-top: 80px;">(Ký và ghi rõ họ tên)</div>
        </td>
        
        <td class="signature-box">
          <div class="signature-date editable-field">........... ngày ..... tháng ..... năm ........</div>
          <div class="signature-title">Bác sĩ khám sức khỏe</div>
          <div class="signature-name" style="margin-top: 80px;">(Ký và ghi rõ họ tên)</div>
          <div style="margin-top: 10px; font-style: italic;">BS. ${createdBy}</div>
        </td>
      </tr>
    </table>
    
  </div>
  
  <script>
    // Add checkbox toggle functionality in edit mode
    document.addEventListener('DOMContentLoaded', function() {
      const checkboxes = document.querySelectorAll('.checkbox');
      
      checkboxes.forEach(checkbox => {
        checkbox.addEventListener('click', function(e) {
          // Only work if parent element is editable
          const isEditable = this.isContentEditable || 
                            this.closest('[contenteditable="true"]') ||
                            document.querySelector('[contenteditable="true"]');
          
          if (!isEditable) return;
          
          e.preventDefault();
          e.stopPropagation();
          
          const group = this.getAttribute('data-group');
          
          if (group) {
            // For grouped checkboxes, uncheck all in group first
            const groupCheckboxes = document.querySelectorAll('.checkbox[data-group="' + group + '"]');
            groupCheckboxes.forEach(cb => cb.classList.remove('checked'));
            
            // Then check this one
            this.classList.add('checked');
          } else {
            // For standalone checkboxes, just toggle
            this.classList.toggle('checked');
          }
        });
      });
      
      // Make editable fields work in edit mode
      window.enableEditMode = function() {
        const editableFields = document.querySelectorAll('.editable-field');
        editableFields.forEach(field => {
          field.contentEditable = true;
        });
      };
      
      window.disableEditMode = function() {
        const editableFields = document.querySelectorAll('.editable-field');
        editableFields.forEach(field => {
          field.contentEditable = false;
        });
      };
    });
  </script>
</body>
</html>
  `;
  
  return html;
}

/**
 * Generate examination visits section
 */
function generateExaminationVisits(consultations) {
  return consultations.map((visit, index) => {
    const visitNumber = index + 1;
    const isFirstVisit = index === 0;
    
    return `
    <div class="visit-section">
      <div class="visit-title">${visitNumber}. Khám bệnh lần ${visitNumber}</div>
      <div class="subsection" style="margin-left: 30px; margin-bottom: 10px; font-style: italic;">
        Ngày đến khám: <strong>${formatDate(visit.consultationDate)}</strong>
      </div>
      
      <div class="bullet-list">
        <div class="bullet-item">
          <strong>Lý do đến khám lần ${visitNumber}:</strong> ${visit.chiefComplaint || visit.symptoms || 'Không có thông tin'}
        </div>
        
        <div class="bullet-item">
          Triệu chứng khi đến khám lần ${visitNumber}: ${visit.chiefComplaint || visit.symptoms || 'Không có thông tin'}
        </div>
        
        ${visit.analysis ? `
        <div class="bullet-item">
          Chẩn đoán lâm sàng lần ${visitNumber}: ${extractDiagnosis(visit.analysis)}
        </div>
        ` : ''}
        
        ${visit.prescribedMedications && visit.prescribedMedications.length > 0 ? `
        <div class="bullet-item">
          Thuốc uống vào lần khám ${visitNumber}:<br>
          ${visit.prescribedMedications.map(med => 
            `<span style="margin-left: 20px;">- ${med.name}: ${med.dosage || ''} - ${med.instructions || ''} (${med.duration || ''})</span>`
          ).join('<br>')}
        </div>
        ` : `
        <div class="bullet-item">
          Thuốc uống vào lần khám ${visitNumber}: Không kê đơn
        </div>
        `}
        
        <div class="bullet-item">
          Chế độ dinh dưỡng ở lần khám ${visitNumber}: ${extractDietRecommendation(visit.analysis) || 'Chế độ ăn cân đối, đầy đủ dinh dưỡng'}
        </div>
        
        <div class="bullet-item">
          Đặc điểm cơ thể, sức khỏe tổng quát lần khám ${visitNumber}: ${getVitalSignsSummary(visit.patientInfo)}
        </div>
        
        ${visit.notes ? `
        <div class="bullet-item">
          Ghi chú của bác sĩ: ${visit.notes}
        </div>
        ` : ''}
      </div>
      
      ${index < consultations.length - 1 ? generateFollowUpVisits(consultations, index) : ''}
    </div>
    `;
  }).join('');
}

/**
 * Generate follow-up visits (tái khám)
 */
function generateFollowUpVisits(consultations, currentIndex) {
  const followUps = [];
  const currentVisit = consultations[currentIndex];
  const nextVisit = consultations[currentIndex + 1];
  
  if (nextVisit) {
    const visitNumber = currentIndex + 1;
    followUps.push(`
      <div class="subsection" style="margin-left: 30px; margin-top: 15px; margin-bottom: 10px; font-style: italic;">
        <strong>Tái khám lần ${visitNumber}:</strong> Ngày ${formatDate(nextVisit.consultationDate)}
      </div>
      <div class="bullet-list" style="margin-top: 5px;">
        <div class="bullet-item">
          Triệu chứng lần tái khám ${visitNumber}: ${nextVisit.chiefComplaint || nextVisit.symptoms || 'Theo dõi tiến triển'}
        </div>
        
        ${nextVisit.prescribedMedications && nextVisit.prescribedMedications.length > 0 ? `
        <div class="bullet-item">
          Thuốc uống vào lần tái khám ${visitNumber}:<br>
          ${nextVisit.prescribedMedications.map(med => 
            `<span style="margin-left: 20px;">- ${med.name}: ${med.dosage || ''} - ${med.instructions || ''}</span>`
          ).join('<br>')}
        </div>
        ` : ''}
        
        <div class="bullet-item">
          Chế độ dinh dưỡng vào lần tái khám ${visitNumber}: ${extractDietRecommendation(nextVisit.analysis) || 'Tiếp tục chế độ ăn đã chỉ định'}
        </div>
        
        <div class="bullet-item">
          Đặc điểm cơ thể, sức khỏe tổng quát lần tái khám ${visitNumber}: ${getVitalSignsSummary(nextVisit.patientInfo)}
        </div>
      </div>
    `);
  }
  
  return followUps.join('');
}

/**
 * Extract diagnosis from analysis text
 */
function extractDiagnosis(analysis) {
  if (!analysis) return 'Đang theo dõi';
  
  // Try to extract diagnosis section
  const diagnosisMatch = analysis.match(/chẩn đoán[:\s]*(.*?)(?:\n|$)/i);
  if (diagnosisMatch) {
    return diagnosisMatch[1].trim().substring(0, 200);
  }
  
  // Return first 200 characters if no specific diagnosis found
  return analysis.substring(0, 200) + (analysis.length > 200 ? '...' : '');
}

/**
 * Extract diet recommendation from analysis
 */
function extractDietRecommendation(analysis) {
  if (!analysis) return null;
  
  const dietMatch = analysis.match(/chế độ ăn[:\s]*(.*?)(?:\n|$)/i) ||
                     analysis.match(/dinh dưỡng[:\s]*(.*?)(?:\n|$)/i);
  
  if (dietMatch) {
    return dietMatch[1].trim().substring(0, 150);
  }
  
  return null;
}

/**
 * Get vital signs summary
 */
function getVitalSignsSummary(patientInfo) {
  if (!patientInfo) return 'Không có thông tin';
  
  const parts = [];
  
  if (patientInfo.weight) parts.push(`Cân nặng: ${patientInfo.weight} kg`);
  if (patientInfo.height) parts.push(`Chiều cao: ${patientInfo.height} cm`);
  if (patientInfo.bloodPressure) parts.push(`Huyết áp: ${patientInfo.bloodPressure}`);
  if (patientInfo.temperature) parts.push(`Nhiệt độ: ${patientInfo.temperature}°C`);
  if (patientInfo.heartRate) parts.push(`Nhịp tim: ${patientInfo.heartRate} bpm`);
  
  return parts.length > 0 ? parts.join(', ') : 'Tình trạng ổn định';
}

/**
 * Format date time
 */
function formatDateTime(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  return d.toLocaleString('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format date only
 */
function formatDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = {
  generateMedicalRecordHTML
};
