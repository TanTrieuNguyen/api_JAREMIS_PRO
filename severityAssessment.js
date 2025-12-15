/**
 * SEVERITY ASSESSMENT & EMERGENCY GUIDANCE MODULE
 * Đánh giá mức độ nguy hiểm và hướng dẫn xử trí khẩn cấp
 */

// ========================================
// Cơ sở dữ liệu BỆNH NGUY HIỂM (HIGH SEVERITY)
// ========================================
const CRITICAL_CONDITIONS = {
  // Bệnh tim mạch cấp tính
  'I21': { name: 'Nhồi máu cơ tim cấp', mortality: 15, emergency: true, category: 'cardiac' },
  'I20.0': { name: 'Đau thắt ngực không ổn định', mortality: 12, emergency: true, category: 'cardiac' },
  'I26': { name: 'Th栓 tắc phổi', mortality: 30, emergency: true, category: 'pulmonary' },
  'I60': { name: 'Xuất huyết dưới nhện', mortality: 45, emergency: true, category: 'neurological' },
  'I61': { name: 'Xuất huyết não', mortality: 40, emergency: true, category: 'neurological' },
  'I63': { name: 'Nhồi máu não', mortality: 20, emergency: true, category: 'neurological' },
  
  // Nhiễm trùng nặng
  'A41': { name: 'Nhiễm khuẩn huyết', mortality: 25, emergency: true, category: 'infectious' },
  'J18': { name: 'Viêm phổi nặng', mortality: 15, emergency: true, category: 'pulmonary' },
  'K65': { name: 'Viêm phúc mạc', mortality: 20, emergency: true, category: 'abdominal' },
  'N17': { name: 'Suy thận cấp', mortality: 18, emergency: true, category: 'renal' },
  
  // Chấn thương nặng
  'S06': { name: 'Chấn thương sọ não', mortality: 30, emergency: true, category: 'trauma' },
  'S27': { name: 'Chấn thương ngực', mortality: 25, emergency: true, category: 'trauma' },
  'T79.4': { name: 'Sốc chấn thương', mortality: 35, emergency: true, category: 'trauma' },
  
  // Rối loạn chuyển hóa cấp
  'E10.1': { name: 'Nhiễm toan ceton đái tháo đường', mortality: 12, emergency: true, category: 'metabolic' },
  'E87.2': { name: 'Nhiễm toan chuyển hóa', mortality: 15, emergency: true, category: 'metabolic' },
  
  // Ung thư giai đoạn muộn
  'C78': { name: 'Ung thư di căn', mortality: 60, emergency: false, category: 'oncology' },
  'C80': { name: 'Ung thư giai đoạn cuối', mortality: 70, emergency: false, category: 'oncology' },
};

// ========================================
// Cơ sở dữ liệu BỆNH TRUNG BÌNH (MODERATE SEVERITY)
// ========================================
const MODERATE_CONDITIONS = {
  'J44': { name: 'Bệnh phổi tắc nghẽn mạn tính (COPD)', mortality: 8, emergency: false, category: 'pulmonary' },
  'I25': { name: 'Bệnh tim mạch vành mạn tính', mortality: 6, emergency: false, category: 'cardiac' },
  'I50': { name: 'Suy tim', mortality: 9, emergency: false, category: 'cardiac' },
  'E11': { name: 'Đái tháo đường type 2', mortality: 5, emergency: false, category: 'metabolic' },
  'N18': { name: 'Bệnh thận mạn tính', mortality: 7, emergency: false, category: 'renal' },
  'K29': { name: 'Viêm dạ dày', mortality: 1, emergency: false, category: 'gastrointestinal' },
  'A09': { name: 'Nhiễm trùng tiêu hóa', mortality: 2, emergency: false, category: 'infectious' },
};

// ========================================
// Cơ sở dữ liệu BỆNH NHẸ (LOW SEVERITY)
// ========================================
const MILD_CONDITIONS = {
  'J00': { name: 'Cảm lạnh thông thường', mortality: 0.01, emergency: false, category: 'respiratory' },
  'J06': { name: 'Nhiễm trùng đường hô hấp trên cấp', mortality: 0.1, emergency: false, category: 'respiratory' },
  'J11': { name: 'Cúm mùa', mortality: 0.5, emergency: false, category: 'respiratory' },
  'R51': { name: 'Đau đầu', mortality: 0.01, emergency: false, category: 'neurological' },
  'R50': { name: 'Sốt nhẹ', mortality: 0.1, emergency: false, category: 'general' },
  'M79': { name: 'Đau cơ', mortality: 0.01, emergency: false, category: 'musculoskeletal' },
  'K30': { name: 'Khó tiêu', mortality: 0.01, emergency: false, category: 'gastrointestinal' },
  'R10': { name: 'Đau bụng nhẹ', mortality: 0.1, emergency: false, category: 'gastrointestinal' },
  'H10': { name: 'Viêm kết mạc', mortality: 0.01, emergency: false, category: 'ophthalmology' },
  'J02': { name: 'Viêm họng cấp', mortality: 0.05, emergency: false, category: 'respiratory' },
  'G43': { name: 'Đau nửa đầu (migraine)', mortality: 0.01, emergency: false, category: 'neurological' },
  'R53': { name: 'Mệt mỏi', mortality: 0.01, emergency: false, category: 'general' },
  'F43': { name: 'Stress, lo âu', mortality: 0.5, emergency: false, category: 'mental' },
};

// ========================================
// RED FLAGS - DẤU HIỆU NGUY HIỂM CẦN CẤP CỨU NGAY
// ========================================
const RED_FLAGS = [
  { symptom: 'đau ngực dữ dội', risk: 'Nhồi máu cơ tim, Thuyên tắc phổi', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'khó thở nặng', risk: 'Suy hô hấp, Hen nặng, COVID-19 nặng', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'liệt nửa người', risk: 'Đột quỵ não', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'nói ngọng đột ngột', risk: 'Đột quỵ não', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'mất ý thức', risk: 'Nguy cơ tử vong cao', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'co giật', risk: 'Động kinh, Nhiễm trùng não', action: '🚨 Gọi 115 NGAY' },
  { symptom: 'xuất huyết nặng', risk: 'Sốc mất máu', action: '🚨 Gọi 115 + Ép vết thương NGAY' },
  { symptom: 'đau bụng dữ dội', risk: 'Viêm ruột thừa, Thủng tạng', action: '🚨 Đến ER ngay' },
  { symptom: 'sốt trên 40°C', risk: 'Nhiễm trùng nặng', action: '🚨 Đến ER ngay' },
  { symptom: 'SpO2 < 90%', risk: 'Suy hô hấp', action: '🚨 Gọi 115 + Thở oxy NGAY' },
  { symptom: 'nhịp tim > 140 hoặc < 40', risk: 'Rối loạn nhịp tim nguy hiểm', action: '🚨 Gọi 115 NGAY' },
];

// ========================================
// YELLOW FLAGS - DẤU HIỆU CẦN KHÁM BÁC SĨ TRONG 24H
// ========================================
const YELLOW_FLAGS = [
  { symptom: 'sốt kéo dài > 3 ngày', risk: 'Nhiễm trùng vi khuẩn', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'đau đầu dữ dội dai dẳng', risk: 'Áp lực nội sọ tăng', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'ho ra máu', risk: 'Lao phổi, Ung thư phổi', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'nôn ra máu', risk: 'Xuất huyết tiêu hóa', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'tiểu ra máu', risk: 'Nhiễm trùng tiết niệu, Sỏi thận', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'đái tháo đường mất kiểm soát', risk: 'Biến chứng cấp tính', action: '⚠️ Khám bác sĩ trong 24h' },
  { symptom: 'khó thở nhẹ kéo dài', risk: 'Hen, COPD cấp', action: '⚠️ Khám bác sĩ trong 24h' },
];

// ========================================
// CÁC HÀM ĐÁNH GIÁ
// ========================================

/**
 * Đánh giá mức độ nguy hiểm dựa trên ICD-10 codes
 */
function assessSeverity(icdCodes) {
  let maxMortality = 0;
  let isEmergency = false;
  let criticalConditions = [];
  let moderateConditions = [];
  let mildConditions = [];
  
  icdCodes.forEach(code => {
    // Kiểm tra từng level
    if (CRITICAL_CONDITIONS[code]) {
      const condition = CRITICAL_CONDITIONS[code];
      criticalConditions.push(condition);
      maxMortality = Math.max(maxMortality, condition.mortality);
      isEmergency = isEmergency || condition.emergency;
    } else if (MODERATE_CONDITIONS[code]) {
      const condition = MODERATE_CONDITIONS[code];
      moderateConditions.push(condition);
      maxMortality = Math.max(maxMortality, condition.mortality);
    } else if (MILD_CONDITIONS[code]) {
      const condition = MILD_CONDITIONS[code];
      mildConditions.push(condition);
      maxMortality = Math.max(maxMortality, condition.mortality);
    }
  });
  
  // Xác định severity level
  let severityLevel = 'MILD';
  if (maxMortality >= 10 || isEmergency) {
    severityLevel = 'CRITICAL';
  } else if (maxMortality >= 5 || moderateConditions.length > 0) {
    severityLevel = 'MODERATE';
  }
  
  return {
    level: severityLevel,
    mortality: maxMortality,
    isEmergency,
    criticalConditions,
    moderateConditions,
    mildConditions
  };
}

/**
 * Kiểm tra red flags trong triệu chứng
 */
function checkRedFlags(symptoms) {
  const detectedFlags = [];
  const symptomsLower = symptoms.toLowerCase();
  
  RED_FLAGS.forEach(flag => {
    if (symptomsLower.includes(flag.symptom)) {
      detectedFlags.push(flag);
    }
  });
  
  return detectedFlags;
}

/**
 * Kiểm tra yellow flags trong triệu chứng
 */
function checkYellowFlags(symptoms) {
  const detectedFlags = [];
  const symptomsLower = symptoms.toLowerCase();
  
  YELLOW_FLAGS.forEach(flag => {
    if (symptomsLower.includes(flag.symptom)) {
      detectedFlags.push(flag);
    }
  });
  
  return detectedFlags;
}

/**
 * Tạo hướng dẫn xử trí khẩn cấp cho bệnh nguy hiểm
 */
function generateEmergencyGuidance(condition, symptoms) {
  const guidance = {
    alert: '🚨 CẢNH BÁO: BỆNH NGUY HIỂM',
    mortality: `Tỷ lệ tử vong: ${condition.mortality}%`,
    immediateActions: [],
    homeCareSurvival: [],
    whenToER: [],
    emergencyNumber: '☎️ Gọi cấp cứu: 115 (Việt Nam)',
  };
  
  // Hướng dẫn theo từng loại bệnh
  switch(condition.category) {
    case 'cardiac':
      guidance.immediateActions = [
        '✅ Gọi 115 NGAY LẬP TỨC',
        '✅ Cho bệnh nhân nằm nghỉ, đầu cao 30°',
        '✅ Nếu có thuốc chống đau ngực (Nitroglycerin): đặt dưới lưỡi',
        '✅ Nếu có Aspirin: nhai 300mg (không nuốt nguyên viên)',
        '✅ Theo dõi nhịp thở, mạch',
        '❌ KHÔNG tự lái xe đến bệnh viện'
      ];
      guidance.homeCareSurvival = [
        '⏰ 12-48 giờ đầu là QUAN TRỌNG NHẤT',
        '🏥 Phải đến bệnh viện có khoa Cấp cứu Tim mạch',
        '💊 Không tự ý dùng thuốc giảm đau thông thường',
        '🚭 Tuyệt đối không hút thuốc, tránh stress',
        '📊 Theo dõi: Đau ngực tăng? Khó thở? Vã mồ hôi?'
      ];
      guidance.whenToER = [
        '🚨 Đau ngực lan ra tay, hàm, lưng',
        '🚨 Khó thở, thở nhanh',
        '🚨 Buồn nôn, nôn mửa',
        '🚨 Choáng váng, mất ý thức',
        '🚨 Nhịp tim không đều'
      ];
      break;
      
    case 'neurological':
      guidance.immediateActions = [
        '✅ Gọi 115 NGAY LẬP TỨC',
        '✅ Nhận diện đột quỵ: F.A.S.T (Face-Arms-Speech-Time)',
        '✅ Cho bệnh nhân nằm nghiêng (tránh sặc)',
        '✅ KHÔNG cho ăn uống gì',
        '✅ Ghi nhớ thời điểm bắt đầu triệu chứng (quan trọng!)',
        '❌ KHÔNG tự lái xe'
      ];
      guidance.homeCareSurvival = [
        '⏰ 4.5 giờ đầu là "GOLDEN HOUR" - quyết định sống còn',
        '🏥 Phải đến bệnh viện có khoa Đột quỵ (Stroke Unit)',
        '💊 KHÔNG tự ý dùng thuốc',
        '📊 Theo dõi: Liệt tăng? Nói khó hơn? Ý thức giảm?'
      ];
      guidance.whenToER = [
        '🚨 Liệt nửa người (tay, chân, mặt)',
        '🚨 Nói khó, nói lắp',
        '🚨 Mắt nhìn mờ đột ngột',
        '🚨 Đau đầu dữ dội chưa từng có',
        '🚨 Mất thăng bằng, chóng mặt nặng'
      ];
      break;
      
    case 'pulmonary':
      guidance.immediateActions = [
        '✅ Gọi 115 NGAY',
        '✅ Cho bệnh nhân ngồi dậy (dễ thở hơn)',
        '✅ Nếu có oxy: 4-6L/phút qua mask',
        '✅ Nếu có thuốc hen (Ventolin): 2-4 nhát',
        '✅ Mở cửa sổ, thông gió',
        '❌ KHÔNG cho nằm ngửa hoàn toàn'
      ];
      guidance.homeCareSurvival = [
        '⏰ 6-24 giờ đầu theo dõi sát',
        '🏥 Phải có máy đo SpO2 tại nhà (nếu < 90% → đi ER ngay)',
        '💊 Dùng thuốc giãn phế quản theo chỉ định',
        '📊 Theo dõi: Tần số thở, màu da, môi tím?'
      ];
      guidance.whenToER = [
        '🚨 SpO2 < 90%',
        '🚨 Thở nhanh > 30 lần/phút',
        '🚨 Môi, móng tay tím',
        '🚨 Nói không thành câu',
        '🚨 Choáng váng, lơ mơ'
      ];
      break;
      
    case 'infectious':
      guidance.immediateActions = [
        '✅ Gọi 115 hoặc đến ER ngay',
        '✅ Hạ sốt: chườm nước ấm, uống Paracetamol',
        '✅ Uống nhiều nước (2-3L/ngày)',
        '✅ Cách ly nếu nghi nhiễm trùng lây',
        '✅ Theo dõi nhiệt độ mỗi 2-4 giờ'
      ];
      guidance.homeCareSurvival = [
        '⏰ 12-24 giờ đầu cực kỳ quan trọng',
        '🏥 Cần kháng sinh tĩnh mạch sớm (không tự mua)',
        '💊 Hạ sốt < 38.5°C để tránh co giật',
        '📊 Theo dõi: Sốt giảm chưa? Tỉnh táo? Nước tiểu đủ?'
      ];
      guidance.whenToER = [
        '🚨 Sốt > 39.5°C không hạ',
        '🚨 Xuất huyết dưới da (chấm tím)',
        '🚨 Lơ mơ, mê sảng',
        '🚨 Nôn mửa liên tục',
        '🚨 Tiểu ít hoặc không tiểu'
      ];
      break;
      
    default:
      guidance.immediateActions = [
        '✅ Gọi 115 để được tư vấn',
        '✅ Theo dõi triệu chứng chặt chẽ',
        '✅ Chuẩn bị đến bệnh viện nếu xấu đi',
        '✅ Ghi chép triệu chứng, thời gian'
      ];
      guidance.whenToER = [
        '🚨 Triệu chứng xấu đi nhanh',
        '🚨 Đau tăng không kiểm soát',
        '🚨 Xuất huyết bất thường',
        '🚨 Ý thức giảm'
      ];
  }
  
  return guidance;
}

/**
 * Tạo hướng dẫn điều trị tại nhà cho bệnh nhẹ/trung bình
 */
function generateHomeCarGuidance(condition, symptoms) {
  const guidance = {
    alert: condition.mortality >= 5 ? '⚠️ BỆNH TRUNG BÌNH - Cần theo dõi' : '✅ BỆNH NHẸ - Có thể điều trị tại nhà',
    homeCare: [],
    medications: [],
    followUp: [],
    whenToSeeDoctor: []
  };
  
  // Hướng dẫn theo category
  switch(condition.category) {
    case 'respiratory':
      guidance.homeCare = [
        '🏠 Nghỉ ngơi đầy đủ, tránh mệt mỏi',
        '💧 Uống nhiều nước ấm (2-3L/ngày)',
        '🌡️ Hạ sốt nếu > 38.5°C',
        '😷 Đeo khẩu trang khi tiếp xúc người khác',
        '🪟 Giữ phòng thông thoáng'
      ];
      guidance.medications = [
        '💊 Paracetamol 500mg: Uống khi sốt > 38.5°C (3-4 lần/ngày)',
        '💊 Vitamin C 1000mg: 1 viên/ngày',
        '🍯 Mật ong + chanh ấm: Giảm ho',
        '💊 Xịt mũi nước muối sinh lý: 3-4 lần/ngày'
      ];
      guidance.followUp = [
        '📅 Theo dõi: 3-5 ngày thường khỏi',
        '📊 Nếu sau 5 ngày không khỏi → Khám bác sĩ',
        '🌡️ Đo nhiệt độ 2 lần/ngày (sáng, tối)'
      ];
      guidance.whenToSeeDoctor = [
        '⚠️ Sốt > 3 ngày',
        '⚠️ Khó thở, thở nhanh',
        '⚠️ Đau ngực khi thở',
        '⚠️ Ho ra đờm mủ, máu',
        '⚠️ Triệu chứng không giảm sau 5 ngày'
      ];
      break;
      
    case 'gastrointestinal':
      guidance.homeCare = [
        '🍚 Ăn nhạt, dễ tiêu (cháo, súp)',
        '💧 Bù nước điện giải (Oresol)',
        '🚫 Tránh: Cay, dầu mỡ, cà phê, rượu',
        '🍵 Uống trà gừng, trà bạc hà',
        '😴 Ngủ đủ giấc'
      ];
      guidance.medications = [
        '💊 Smecta: 1 gói x 3 lần/ngày (tiêu chảy)',
        '💊 Omeprazole 20mg: 1 viên buổi sáng đói (viêm dạ dày)',
        '💊 Men tiêu hóa: Theo hướng dẫn',
        '⚠️ Không dùng kháng sinh tự ý'
      ];
      guidance.followUp = [
        '📅 Thường khỏi trong 2-3 ngày',
        '📊 Nếu sau 3 ngày không khỏi → Khám bác sĩ'
      ];
      guidance.whenToSeeDoctor = [
        '⚠️ Tiêu chảy > 3 ngày',
        '⚠️ Nôn ra máu, đi cầu phân đen',
        '⚠️ Đau bụng dữ dội',
        '⚠️ Sốt cao kèm tiêu chảy',
        '⚠️ Dấu hiệu mất nước: Khát nước, tiểu ít, mệt lả'
      ];
      break;
      
    case 'neurological':
      if (condition.name.includes('đau đầu') || condition.name.includes('migraine')) {
        guidance.homeCare = [
          '😴 Nghỉ ngơi trong phòng tối, yên tĩnh',
          '❄️ Chườm lạnh trán, gáy',
          '☕ Uống cà phê (migraine)',
          '🧘 Thư giãn, tránh stress',
          '💤 Ngủ đủ 7-8 giờ/đêm'
        ];
        guidance.medications = [
          '💊 Paracetamol 500mg: 1-2 viên khi đau',
          '💊 Ibuprofen 400mg: 1 viên khi đau (nếu Paracetamol không đủ)',
          '⚠️ Không dùng > 3 ngày liên tục'
        ];
        guidance.whenToSeeDoctor = [
          '⚠️ Đau đầu dữ dội nhất đời (thunderclap headache)',
          '⚠️ Đau đầu kèm sốt, cứng gáy',
          '⚠️ Đau đầu kèm nôn ói phun',
          '⚠️ Đau đầu kèm nhìn mờ, liệt',
          '⚠️ Đau đầu mới xuất hiện sau 50 tuổi'
        ];
      }
      break;
      
    default:
      guidance.homeCare = [
        '🏠 Nghỉ ngơi đầy đủ',
        '💧 Uống nhiều nước',
        '🍎 Ăn uống dinh dưỡng',
        '😴 Ngủ đủ giấc',
        '📊 Theo dõi triệu chứng'
      ];
      guidance.whenToSeeDoctor = [
        '⚠️ Triệu chứng không giảm sau 3-5 ngày',
        '⚠️ Xuất hiện triệu chứng mới',
        '⚠️ Triệu chứng xấu đi'
      ];
  }
  
  return guidance;
}

module.exports = {
  assessSeverity,
  checkRedFlags,
  checkYellowFlags,
  generateEmergencyGuidance,
  generateHomeCarGuidance,
  CRITICAL_CONDITIONS,
  MODERATE_CONDITIONS,
  MILD_CONDITIONS,
  RED_FLAGS,
  YELLOW_FLAGS
};
