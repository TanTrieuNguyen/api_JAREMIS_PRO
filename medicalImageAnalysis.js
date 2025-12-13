/**
 * MEDICAL IMAGE ANALYSIS MODULE
 * Phân tích ảnh y khoa chuyên sâu (X-ray, MRI, CT, PET, Ultrasound, ECG)
 * 
 * Author: TT1403, ANT
 * Date: 2025
 */

/**
 * Tự động phát hiện loại ảnh y khoa từ tên file và nội dung
 */
function detectImageType(filename) {
  const fn = filename.toLowerCase();
  
  // X-ray patterns
  if (/(xray|x-ray|x_ray|cxr|chest\s?x|thorax|skull|bone|fracture|spine|pelvis)/i.test(fn)) {
    if (/(chest|thorax|lung|cxr)/i.test(fn)) return 'xray-chest';
    if (/(skull|head|brain|cranium)/i.test(fn)) return 'xray-skull';
    if (/(spine|vertebra|back)/i.test(fn)) return 'xray-spine';
    if (/(pelvis|hip)/i.test(fn)) return 'xray-pelvis';
    if (/(bone|fracture|arm|leg|hand|foot)/i.test(fn)) return 'xray-bone';
    return 'xray-general';
  }
  
  // CT scan patterns
  if (/(ct|cat\s?scan|computed\s?tomography)/i.test(fn)) {
    if (/(brain|head|cranial)/i.test(fn)) return 'ct-brain';
    if (/(chest|thorax|lung)/i.test(fn)) return 'ct-chest';
    if (/(abdomen|abdominal|liver|kidney)/i.test(fn)) return 'ct-abdomen';
    if (/(spine|vertebra)/i.test(fn)) return 'ct-spine';
    return 'ct-general';
  }
  
  // MRI patterns
  if (/(mri|magnetic\s?resonance)/i.test(fn)) {
    if (/(brain|head|cranial|neuro)/i.test(fn)) return 'mri-brain';
    if (/(spine|spinal|vertebra)/i.test(fn)) return 'mri-spine';
    if (/(knee|shoulder|joint|musculoskeletal)/i.test(fn)) return 'mri-musculoskeletal';
    if (/(abdomen|liver|kidney)/i.test(fn)) return 'mri-abdomen';
    return 'mri-general';
  }
  
  // PET scan patterns
  if (/(pet|positron\s?emission)/i.test(fn)) {
    return 'pet-scan';
  }
  
  // Ultrasound patterns
  if (/(ultrasound|sonogram|echo|us\s)/i.test(fn)) {
    if (/(abdomen|liver|kidney|gallbladder)/i.test(fn)) return 'ultrasound-abdomen';
    if (/(heart|cardiac|echo)/i.test(fn)) return 'ultrasound-cardiac';
    if (/(obstetric|fetal|pregnancy)/i.test(fn)) return 'ultrasound-obstetric';
    if (/(thyroid|neck)/i.test(fn)) return 'ultrasound-thyroid';
    return 'ultrasound-general';
  }
  
  // ECG/EKG patterns
  if (/(ecg|ekg|electrocardiogram|heart\s?rhythm)/i.test(fn)) {
    return 'ecg';
  }
  
  // Mammogram patterns
  if (/(mammogram|mammo|breast)/i.test(fn)) {
    return 'mammogram';
  }
  
  // Dermatology patterns
  if (/(skin|derma|rash|lesion|mole)/i.test(fn)) {
    return 'dermatology';
  }
  
  // Endoscopy patterns
  if (/(endoscopy|scope|gastro|colonoscopy)/i.test(fn)) {
    return 'endoscopy';
  }
  
  // Default fallback
  return 'medical-image';
}

/**
 * Lấy prompt phân tích chuyên biệt cho từng loại ảnh
 */
function getImageAnalysisPrompt(imageType, patientContext = '') {
  const prompts = {
    'xray-chest': `Phân tích X-quang ngực (CXR) theo chuẩn WHO & Radiology guidelines:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Kỹ thuật chụp:** Tư thế (PA/AP/Lateral), độ phơi sáng, vị trí tim, cột sống
2. **Tim & Mạch máu:**
   - Cardiothoracic ratio (CTR) - bình thường <0.5
   - Đường viền tim (clear/blurred/enlarged)
   - Động mạch chủ (aortic knuckle/widening)
3. **Phổi:**
   - Rốn phổi (hilum) - kích thước, mật độ
   - Thâm nhiễm phổi (infiltration/consolidation/opacity)
   - Dấu hiệu tràn khí màng phổi (pneumothorax)
   - Dấu hiệu tràn dịch màng phổi (pleural effusion)
   - Nốt phổi (nodules/masses)
4. **Xương & Mô mềm:**
   - Xương sườn (fractures)
   - Cột sống ngực
   - Mô mềm thành ngực
5. **KẾT LUẬN:** 
   - Bình thường / Bất thường
   - ICD-10 codes (nếu có)
   - Khuyến nghị (CT ngực, siêu âm tim, v.v.)

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}

**ĐỊNH DẠNG:** Markdown có cấu trúc rõ ràng.`,

    'xray-skull': `Phân tích X-quang sọ não theo chuẩn Neuroradiology:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Kỹ thuật:** Tư thế (AP/Lateral/Towne's), độ sáng
2. **Xương sọ:**
   - Gãy xương sọ (fracture lines)
   - Dịch chuyển xương (displacement)
   - Tăng áp lực nội sọ (suture widening)
3. **Mô mềm:**
   - Phù nề da đầu
   - Khí trong nhu mô não (pneumocephalus)
4. **Sinus:**
   - Viêm xoang (sinusitis)
   - Tích dịch
5. **KẾT LUẬN & Khuyến nghị CT/MRI não nếu cần**

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'ct-brain': `Phân tích CT não theo chuẩn ACR (American College of Radiology):

**YÊU CẦU ĐÁNH GIÁ:**
1. **Chảy máu não (Hemorrhage):**
   - Xuất huyết nội sọ (ICH) - vị trí, thể tích
   - Xuất huyết dưới màng cứng (SDH)
   - Xuất huyết ngoài màng cứng (EDH)
   - Xuất huyết dưới nhện (SAH)
2. **Nhồi máu não (Ischemic stroke):**
   - Vùng thiếu máu cục bộ (hypodensity)
   - ASPECTS score (0-10)
   - Midline shift
3. **Khối u (Tumors):**
   - Vị trí, kích thước, ranh giới
   - Phù não xung quanh (edema)
   - Tăng sinh mạch máu
4. **Não thất (Ventricles):**
   - Giãn não thất (hydrocephalus)
   - Dịch chuyển đường giữa (midline shift)
5. **KẾT LUẬN:** Cấp cứu / Không cấp cứu, ICD-10, khuyến nghị MRI

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'ct-chest': `Phân tích CT ngực theo chuẩn HRCT (High-Resolution CT):

**YÊU CẦU ĐÁNH GIÁ:**
1. **Phổi:**
   - Ground-glass opacity (GGO) - COVID-19, viêm phổi kẽ
   - Consolidation - viêm phổi thùy
   - Nodules/Masses - ung thư phổi, lao
   - Cavity - lao, áp xe
   - Bronchiectasis - giãn phế quản
2. **Tim & Mạch máu:**
   - Xơ vữa động mạch vành (coronary calcification)
   - Phình động mạch chủ (aortic aneurysm)
   - Thuyên tắc phổi (PE) - nếu có contrast
3. **Màng phổi:**
   - Tràn dịch (pleural effusion)
   - Dày màng phổi (pleural thickening)
4. **Trung thất:**
   - Hạch to (lymphadenopathy)
   - Khối u trung thất
5. **KẾT LUẬN & Gợi ý sinh thiết/PET-CT nếu nghi ung thư**

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'mri-brain': `Phân tích MRI não theo chuẩn ACR & RSNA:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Sequences:** T1, T2, FLAIR, DWI, SWI, Post-contrast
2. **Chảy máu não (Hemorrhage):**
   - Cấp tính (hyperintense T1, hypointense T2)
   - Mạn tính (hemosiderin deposition)
3. **Nhồi máu não (Ischemic stroke):**
   - DWI restriction (sáng trên DWI, tối trên ADC)
   - Phù não (FLAIR hyperintensity)
4. **Khối u (Tumors):**
   - Vị trí (intra-axial/extra-axial)
   - Tăng sinh mạch (contrast enhancement)
   - Necrosis, cyst
   - Glioma, meningioma, metastasis
5. **Thoái hóa não (Atrophy):**
   - Alzheimer (hippocampal atrophy)
   - Vascular dementia (white matter lesions)
6. **Đa xơ cứng (MS):**
   - Plaques trong chất trắng
   - Dawson's fingers
7. **KẾT LUẬN:** Chẩn đoán, ICD-10, khuyến nghị PET/biopsy

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'mri-spine': `Phân tích MRI cột sống theo chuẩn ACR:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Đĩa đệm (Intervertebral discs):**
   - Thoát vị đĩa đệm (disc herniation) - vị trí, mức độ
   - Thoái hóa đĩa đệm (disc degeneration)
   - Ép tủy sống (spinal cord compression)
2. **Tủy sống (Spinal cord):**
   - Tín hiệu bất thường (T2 hyperintensity) - viêm, chấn thương
   - Khối u tủy sống (intramedullary tumors)
3. **Thân đốt sống (Vertebral bodies):**
   - Gãy nén (compression fracture)
   - Thoái hóa (spondylosis)
   - U di căn (metastasis)
4. **Rễ thần kinh:**
   - Chèn ép rễ thần kinh (nerve root compression)
   - Hẹp ống sống (spinal stenosis)
5. **KẾT LUẬN:** Chẩn đoán, mức độ nghiêm trọng, phẫu thuật/không

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'ultrasound-abdomen': `Phân tích siêu âm bụng theo chuẩn AIUM:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Gan (Liver):**
   - Kích thước, cấu trúc mô (homogeneous/heterogeneous)
   - Xơ gan (cirrhosis) - bề mặt ngoằn ngoèo, tăng âm
   - U gan (liver masses) - cyst, hemangioma, HCC
   - Mạch máu gan (portal vein flow)
2. **Túi mật (Gallbladder):**
   - Sỏi mật (gallstones) - acoustic shadow
   - Viêm túi mật (cholecystitis) - dày thành, Murphy sign
   - Polyp túi mật
3. **Lách (Spleen):**
   - Kích thước (splenomegaly >12cm)
   - Cấu trúc mô
4. **Thận (Kidneys):**
   - Kích thước, độ dày nhu mô thận
   - Sỏi thận (kidney stones) - acoustic shadow
   - Giãn đài bể thận (hydronephrosis)
   - U thận (renal masses)
5. **Tụy (Pancreas):**
   - Kích thước, đường viền
   - Viêm tụy (pancreatitis)
   - U tụy
6. **KẾT LUẬN & Khuyến nghị CT/MRI nếu phát hiện khối bất thường**

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'ultrasound-cardiac': `Phân tích siêu âm tim (Echocardiography) theo chuẩn ASE/EAE:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Chức năng tâm thất trái:**
   - Phân suất tống máu (LVEF) - bình thường ≥55%
   - Vận động thành tim (wall motion) - hypokinesis, akinesis
   - Kích thước buồng tim (LV dimensions)
2. **Van tim:**
   - Hở van hai lá (mitral regurgitation)
   - Hẹp van hai lá (mitral stenosis)
   - Hở van động mạch chủ (aortic regurgitation)
   - Hẹp van động mạch chủ (aortic stenosis)
3. **Dịch màng ngoài tim:**
   - Tràn dịch màng ngoài tim (pericardial effusion)
   - Chèn ép tim (cardiac tamponade)
4. **Áp lực phổi:**
   - Tăng áp động mạch phổi (pulmonary hypertension)
   - RVSP estimation
5. **KẾT LUẬN:** Chức năng tim (normal/abnormal), khuyến nghị can thiệp

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'ecg': `Phân tích điện tâm đồ (ECG) theo chuẩn AHA/ACC:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Nhịp tim (Heart Rate & Rhythm):**
   - Tần số: Bradycardia (<60), Normal (60-100), Tachycardia (>100)
   - Nhịp: Sinus, AFib, AFlutter, SVT, VT, VFib
2. **Khoảng thời gian:**
   - PR interval (bình thường 120-200ms) - block nhĩ thất
   - QRS duration (<120ms) - block nhánh
   - QT interval - nguy cơ Torsades de Pointes
3. **Trục tim (Axis):**
   - Normal (-30° to +90°)
   - Left axis deviation / Right axis deviation
4. **Sóng P:**
   - P mitrale (P wave notched) - bệnh van hai lá
   - P pulmonale (P wave tall) - bệnh phổi
5. **QRS complex:**
   - Phì đại thất trái (LVH) - Sokolow-Lyon criteria
   - Phì đại thất phải (RVH)
   - Block nhánh trái (LBBB) / Block nhánh phải (RBBB)
6. **Segment ST & sóng T:**
   - ST elevation (STEMI) - nhồi máu cơ tim cấp
   - ST depression - thiếu máu cơ tim
   - T wave inversion - thiếu máu cơ tim cũ
7. **Sóng Q:**
   - Pathological Q waves - nhồi máu cơ tim cũ
8. **KẾT LUẬN:**
   - Bình thường / Bất thường
   - Chẩn đoán: STEMI, NSTEMI, AFib, VT, etc.
   - ICD-10 codes
   - Khuyến nghị CẤP CỨU nếu STEMI/VT/VFib

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'pet-scan': `Phân tích PET/CT (FDG-PET) theo chuẩn SNMMI:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Tích tụ FDG (SUV - Standardized Uptake Value):**
   - SUV <2.5: Tổn thương lành tính (benign)
   - SUV 2.5-5: Không chắc chắn (indeterminate)
   - SUV >5: Nghi ngờ ác tính (malignant)
2. **Ung thư nguyên phát:**
   - Vị trí khối u
   - Kích thước, SUVmax
   - Ranh giới (clear/infiltrative)
3. **Hạch lympho:**
   - Hạch di căn (metastatic lymph nodes)
   - Vị trí, số lượng, SUVmax
4. **Di căn xa (Distant metastasis):**
   - Phổi, gan, xương, não
   - Số lượng, vị trí, SUVmax
5. **Đáp ứng điều trị:**
   - So sánh SUVmax trước/sau điều trị
   - Complete response, partial response, stable disease, progressive disease
6. **KẾT LUẬN:**
   - Staging (TNM classification)
   - Khuyến nghị: Phẫu thuật, hóa trị, xạ trị, miễn dịch liệu pháp

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'mammogram': `Phân tích chụp X-quang tuyến vú (Mammography) theo BI-RADS:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Mật độ mô vú (Breast Density):**
   - Type A: Mostly fatty (gần như chỉ có mô mỡ)
   - Type B: Scattered fibroglandular (rải rác mô tuyến)
   - Type C: Heterogeneously dense (dày đặc không đồng nhất)
   - Type D: Extremely dense (rất dày đặc)
2. **Khối u (Masses):**
   - Vị trí (quadrant, clock position)
   - Kích thước, hình dạng (round/oval/irregular)
   - Ranh giới (circumscribed/indistinct/spiculated)
   - Mật độ (fat/low/isodense/high)
3. **Vôi hóa (Calcifications):**
   - Typically benign: Large rod-like, round, lucent-centered
   - Suspicious: Fine pleomorphic, fine linear/branching
4. **Bất đối xứng (Asymmetry):**
   - Global, focal, developing
5. **Biến dạng cấu trúc (Architectural distortion)**
6. **BI-RADS Category:**
   - 0: Incomplete - cần thêm ảnh
   - 1: Negative - bình thường
   - 2: Benign - lành tính
   - 3: Probably benign - theo dõi 6 tháng
   - 4: Suspicious - sinh thiết (4A: 2-10%, 4B: 10-50%, 4C: 50-95%)
   - 5: Highly suggestive of malignancy - sinh thiết (>95%)
   - 6: Known biopsy-proven malignancy
7. **KẾT LUẬN & Khuyến nghị:** Siêu âm vú, MRI vú, sinh thiết

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'dermatology': `Phân tích hình ảnh da liễu theo chuẩn AAD & Fitzpatrick:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Mô tả tổn thương da (Lesion Description):**
   - Loại: Macule, patch, papule, plaque, nodule, vesicle, bulla, pustule
   - Màu sắc: Erythematous, hyperpigmented, hypopigmented
   - Kích thước: mm/cm
   - Phân bố: Localized, generalized, symmetric, asymmetric
   - Ranh giới: Well-defined, ill-defined
2. **Chẩn đoán phân biệt:**
   - Nhiễm trùng: Cellulitis, impetigo, herpes, fungal
   - Viêm da: Eczema, psoriasis, dermatitis
   - U da: Basal cell carcinoma, squamous cell carcinoma, melanoma
   - Dị ứng: Urticaria, drug eruption, contact dermatitis
3. **ABCDE Rule cho nốt ruồi (Melanoma screening):**
   - A: Asymmetry (bất đối xứng)
   - B: Border irregularity (ranh giới không đều)
   - C: Color variation (màu sắc không đồng nhất)
   - D: Diameter >6mm
   - E: Evolving (thay đổi theo thời gian)
4. **Ugly Duckling Sign:** Nốt ruồi khác biệt so với các nốt khác
5. **KẾT LUẬN:**
   - Lành tính / Nghi ngờ / Ác tính
   - ICD-10 codes
   - Khuyến nghị: Dermoscopy, biopsy, điều trị

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,

    'endoscopy': `Phân tích hình ảnh nội soi tiêu hóa theo chuẩn ASGE:

**YÊU CẦU ĐÁNH GIÁ:**
1. **Thực quản (Esophagus):**
   - Viêm thực quản (esophagitis) - Los Angeles grade A-D
   - Trào ngược dạ dày (GERD)
   - Barrett's esophagus (biến sản)
   - U thực quản
2. **Dạ dày (Stomach):**
   - Viêm dạ dày (gastritis) - H. pylori
   - Loét dạ dày (gastric ulcer) - Forrest classification
   - Polyp dạ dày
   - U dạ dày (gastric cancer)
3. **Tá tràng (Duodenum):**
   - Loét tá tràng (duodenal ulcer)
   - Viêm tá tràng (duodenitis)
4. **Đại tràng (Colon - nếu là colonoscopy):**
   - Polyp đại tràng - size, morphology (pedunculated/sessile)
   - Viêm loét đại tràng (ulcerative colitis)
   - Bệnh Crohn
   - U đại tràng (colorectal cancer)
5. **Boston Bowel Preparation Scale (BBPS):** 0-3 cho mỗi đoạn
6. **KẾT LUẬN:**
   - Bình thường / Bất thường
   - ICD-10 codes
   - Khuyến nghị: Sinh thiết, cắt polyp, điều trị H. pylori

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}`,
  };

  return prompts[imageType] || `Phân tích hình ảnh y tế này theo chuẩn Evidence-Based Medicine:

**YÊU CẦU:**
1. Mô tả chi tiết những gì quan sát được
2. Phát hiện bất thường (nếu có)
3. Chẩn đoán phân biệt
4. Mức độ nghiêm trọng
5. Khuyến nghị xét nghiệm/điều trị tiếp theo

${patientContext ? `\n**THÔNG TIN BỆNH NHÂN:**\n${patientContext}\n` : ''}

**ĐỊNH DẠNG:** Markdown có cấu trúc.`;
}

/**
 * Phân tích ảnh y khoa với AI (Gemini Vision)
 */
async function analyzeImage(imageBase64, mimeType, imageType, genAI, patientContext = '') {
  try {
    // Use stable Gemini model for production (not -latest suffix)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro-latest' });
    
    const prompt = getImageAnalysisPrompt(imageType, patientContext);
    
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    };
    
    console.log(`🔬 [IMAGE ANALYSIS] Analyzing ${imageType}...`);
    
    const result = await Promise.race([
      model.generateContent([prompt, imagePart]),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Image analysis timeout')), 30000)
      )
    ]);
    
    const response = await result.response;
    const analysis = response.text();
    
    console.log(`✅ [IMAGE ANALYSIS] ${imageType} analyzed successfully`);
    return {
      imageType,
      analysis,
      success: true
    };
    
  } catch (error) {
    console.error(`❌ [IMAGE ANALYSIS] Failed for ${imageType}:`, error.message);
    return {
      imageType,
      analysis: `⚠️ Không thể phân tích ảnh: ${error.message}. Vui lòng thử lại hoặc sử dụng ảnh chất lượng tốt hơn.`,
      success: false,
      error: error.message
    };
  }
}

/**
 * Phân tích nhiều ảnh y khoa song song
 */
async function analyzeMedicalImages(files, genAI, patientContext = '') {
  const analyses = [];
  
  for (const file of files) {
    try {
      const imageType = detectImageType(file.originalname || file.filename || '');
      const imageBase64 = file.base64 || require('fs').readFileSync(file.path).toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      
      const result = await analyzeImage(imageBase64, mimeType, imageType, genAI, patientContext);
      
      analyses.push({
        filename: file.originalname || file.filename,
        ...result
      });
      
    } catch (error) {
      console.error(`❌ [IMAGE] Error processing ${file.originalname}:`, error);
      analyses.push({
        filename: file.originalname || file.filename,
        imageType: 'unknown',
        analysis: `⚠️ Lỗi xử lý ảnh: ${error.message}`,
        success: false,
        error: error.message
      });
    }
  }
  
  return analyses;
}

/**
 * Format kết quả phân tích ảnh thành markdown
 */
function formatImageAnalysisReport(analyses) {
  if (!analyses || analyses.length === 0) {
    return '';
  }
  
  let report = '\n\n## 🔬 PHÂN TÍCH HÌNH ẢNH Y TẾ\n\n';
  
  analyses.forEach((img, index) => {
    const icon = getImageIcon(img.imageType);
    report += `### ${icon} ${index + 1}. ${img.filename}\n`;
    report += `**Loại:** ${getImageTypeLabel(img.imageType)}\n\n`;
    
    if (img.success) {
      report += img.analysis + '\n\n';
    } else {
      report += `⚠️ **Lỗi phân tích:** ${img.error || 'Không xác định'}\n\n`;
    }
    
    report += '---\n\n';
  });
  
  return report;
}

/**
 * Helper: Lấy icon cho từng loại ảnh
 */
function getImageIcon(imageType) {
  const icons = {
    'xray-chest': '🫁',
    'xray-skull': '💀',
    'xray-spine': '🦴',
    'xray-bone': '🦴',
    'ct-brain': '🧠',
    'ct-chest': '🫁',
    'mri-brain': '🧠',
    'mri-spine': '🦴',
    'ultrasound-abdomen': '🏥',
    'ultrasound-cardiac': '❤️',
    'ecg': '📈',
    'pet-scan': '☢️',
    'mammogram': '🎀',
    'dermatology': '🔬',
    'endoscopy': '🔬'
  };
  return icons[imageType] || '🏥';
}

/**
 * Helper: Lấy tên tiếng Việt cho loại ảnh
 */
function getImageTypeLabel(imageType) {
  const labels = {
    'xray-chest': 'X-quang ngực',
    'xray-skull': 'X-quang sọ',
    'xray-spine': 'X-quang cột sống',
    'xray-bone': 'X-quang xương',
    'xray-general': 'X-quang',
    'ct-brain': 'CT não',
    'ct-chest': 'CT ngực',
    'ct-abdomen': 'CT bụng',
    'ct-general': 'CT scan',
    'mri-brain': 'MRI não',
    'mri-spine': 'MRI cột sống',
    'mri-musculoskeletal': 'MRI cơ xương khớp',
    'mri-general': 'MRI',
    'ultrasound-abdomen': 'Siêu âm bụng',
    'ultrasound-cardiac': 'Siêu âm tim',
    'ultrasound-obstetric': 'Siêu âm sản',
    'ultrasound-general': 'Siêu âm',
    'ecg': 'Điện tâm đồ (ECG)',
    'pet-scan': 'PET/CT scan',
    'mammogram': 'Chụp X-quang tuyến vú',
    'dermatology': 'Ảnh da liễu',
    'endoscopy': 'Nội soi tiêu hóa',
    'medical-image': 'Hình ảnh y tế'
  };
  return labels[imageType] || 'Hình ảnh y tế';
}

module.exports = {
  detectImageType,
  analyzeImage,
  analyzeMedicalImages,
  formatImageAnalysisReport,
  getImageAnalysisPrompt,
  getImageTypeLabel
};
