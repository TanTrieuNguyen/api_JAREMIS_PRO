/**
 * Test Professional Mode - Fix pendingSubmitData null issue
 * Run: node test-professional-fix.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Testing Professional Mode pendingSubmitData Fix...\n');

const htmlPath = path.join(__dirname, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition) {
    if (condition) {
        console.log(`✅ ${name}`);
        passed++;
    } else {
        console.log(`❌ ${name}`);
        failed++;
    }
}

// Kiểm thử 1: Nút send không có onclick trùng lặp
check('Send button has no onclick attribute', 
    html.includes('id="send-btn" class="action-btn" title="Gửi (Enter)"') &&
    !html.match(/id="send-btn"[^>]*onclick="submitData\(\)"/));

// Kiểm thử 2: Modal CSS có .show class
check('CSS .modal-backdrop.show exists', 
    html.includes('.modal-backdrop.show'));

check('CSS .modal-backdrop.show has display:flex', 
    html.match(/\.modal-backdrop\.show\s*{[^}]*display:\s*flex/s));

// Kiểm thử 3: submitData lưu pendingSubmitData
check('submitData saves pendingSubmitData', 
    html.includes('pendingSubmitData = { message, allImages };'));

check('submitData logs saved pendingSubmitData', 
    html.includes("console.log('💾 Saved pendingSubmitData:', pendingSubmitData);"));

// Kiểm thử 4: openPatientInfoModal logs pendingSubmitData
check('openPatientInfoModal logs pendingSubmitData', 
    html.includes("console.log('📂 Opening patient modal, pendingSubmitData:', pendingSubmitData);"));

// Kiểm thử 5: submitProfessionalWithPatientInfo có debug logs
check('submitProfessionalWithPatientInfo logs current pendingSubmitData', 
    html.includes("console.log('🔍 submitProfessionalWithPatientInfo called');"));

check('submitProfessionalWithPatientInfo logs pendingSubmitData value', 
    html.includes("console.log('📦 Current pendingSubmitData:', pendingSubmitData);"));

check('submitProfessionalWithPatientInfo logs patient info', 
    html.includes("console.log('👤 Patient info:', patientInfo);"));

// Kiểm thử 6: QUAN TRỌNG - Lưu pendingSubmitData TRƯỚC KHI đóng modal
check('Save pendingSubmitData to temp variable before closing modal', 
    html.includes('const savedData = pendingSubmitData;'));

const submitFunc = html.match(/async function submitProfessionalWithPatientInfo\(\) {[\s\S]*?^        }/m);
if (submitFunc) {
    const funcBody = submitFunc[0];
    const savedDataIndex = funcBody.indexOf('const savedData = pendingSubmitData;');
    const closeModalIndex = funcBody.indexOf('closePatientInfoModal();');
    
    check('savedData is assigned BEFORE closePatientInfoModal', 
        savedDataIndex > 0 && closeModalIndex > 0 && savedDataIndex < closeModalIndex);
} else {
    console.log('❌ Cannot find submitProfessionalWithPatientInfo function');
    failed++;
}

// Kiểm thử 7: Sử dụng savedData thay vì pendingSubmitData sau khi đóng
check('performSubmit uses savedData.message', 
    html.includes('await performSubmit(savedData.message, savedData.allImages, patientInfo);'));

check('Check savedData instead of pendingSubmitData', 
    html.includes('if (savedData && savedData.message !== undefined)'));

// Kiểm thử 8: Xử lý lỗi khi savedData null
check('Show error when savedData is null', 
    html.includes("flashNotice('Lỗi: Không tìm thấy dữ liệu tin nhắn. Vui lòng thử lại.', 'error');"));

// Kiểm thử 9: closePatientInfoModal vẫn reset pendingSubmitData
check('closePatientInfoModal resets pendingSubmitData', 
    html.includes('pendingSubmitData = null;') &&
    html.match(/function closePatientInfoModal[\s\S]*?pendingSubmitData = null;/));

// Kiểm thử 10: Event listener cho nút submit tồn tại
check('Event listener for send-btn exists', 
    html.includes("sendBtn.addEventListener('click',"));

check('Event listener calls submitData', 
    html.match(/sendBtn\.addEventListener\('click'[\s\S]*?submitData\(\)/));

// Kiểm thử 11: Event listener cho nút submit bệnh nhân
check('Event listener for submit-patient-info-btn exists', 
    html.includes("submitPatientBtn.addEventListener('click',"));

check('Event listener calls submitProfessionalWithPatientInfo', 
    html.match(/submitPatientBtn\.addEventListener\('click'[\s\S]*?submitProfessionalWithPatientInfo\(\)/));

// Kiểm thử 12: Không có else blocks trùng lặp
const elseBlocks = (html.match(/} else {[\s\S]*?flashNotice\('Lỗi: Không tìm thấy dữ liệu/g) || []).length;
check('No duplicate error handling blocks', elseBlocks <= 1);

console.log('\n========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('========================================');

if (failed === 0) {
    console.log('🎉 All tests passed! pendingSubmitData fix is complete.');
    console.log('📌 Next: Hard refresh browser (Ctrl+Shift+R) and test manually.');
} else {
    console.log('⚠️  Some tests failed. Please review the code.');
    process.exit(1);
}
