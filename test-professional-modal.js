// ========================================
// KIỂM THỚ NHANH: Hiển thị Modal chế độ Professional
// ========================================

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'public', 'index.html');

console.log('🔍 Testing Professional Mode Modal Display Fix...\n');

let passed = 0;
let failed = 0;

function test(name, condition) {
    if (condition) {
        console.log(`✅ ${name}`);
        passed++;
    } else {
        console.log(`❌ ${name}`);
        failed++;
    }
}

// Đọc nội dung file
const content = fs.readFileSync(indexPath, 'utf8');

// Kiểm thử 1: Kiểm tra CSS .modal-backdrop.show tồn tại
test(
    'CSS .modal-backdrop.show exists',
    content.includes('.modal-backdrop.show')
);

// Kiểm thử 2: Kiểm tra .modal-backdrop.show có display:flex
test(
    'CSS .modal-backdrop.show has display:flex',
    content.includes('.modal-backdrop.show') && 
    content.match(/\.modal-backdrop\.show\s*\{[^}]*display:\s*flex/s)
);

// Kiểm thử 3: Kiểm tra modal backdrop element tồn tại
test(
    'Modal backdrop element exists',
    content.includes('id="patient-info-modal-backdrop"')
);

// Kiểm thử 4: Kiểm tra nút submit không có onclick trùng lặp
test(
    'Submit button has no onclick duplicate',
    !content.match(/<button[^>]+id="submit-patient-info-btn"[^>]+onclick=/i)
);

// Kiểm thử 5: Kiểm tra hàm submitData tồn tại
test(
    'submitData function exists',
    content.includes('async function submitData()')
);

// Kiểm thử 6: Kiểm tra kiểm tra chế độ Professional trong submitData
test(
    'Professional mode check in submitData',
    content.includes("if (currentMode === 'professional')") &&
    content.includes('openPatientInfoModal()')
);

// Kiểm thử 7: Kiểm tra biến pendingSubmitData được khai báo
test(
    'pendingSubmitData variable declared',
    content.includes('let pendingSubmitData = null')
);

// Kiểm thử 8: Kiểm tra openPatientInfoModal thêm .show class
test(
    'openPatientInfoModal adds .show class',
    content.includes("backdrop.classList.add('show')")
);

// Kiểm thử 9: Kiểm tra closePatientInfoModal xóa .show class
test(
    'closePatientInfoModal removes .show class',
    content.includes("backdrop.classList.remove('show')")
);

// Kiểm thử 10: Kiểm tra submitProfessionalWithPatientInfo xác thực tên bệnh nhân
test(
    'submitProfessionalWithPatientInfo validates patient name',
    content.includes('if (!patientName)') &&
    content.includes('flashNotice')
);

// Kiểm thử 11: Kiểm tra event listener cho submit-patient-info-btn
test(
    'Event listener for submit-patient-info-btn exists',
    content.includes('getElementById(\'submit-patient-info-btn\')') &&
    content.includes('addEventListener(\'click\'')
);

// Kiểm thử 12: Kiểm tra kiểm tra an toàn pendingSubmitData
test(
    'pendingSubmitData safe check before performSubmit',
    content.includes('if (pendingSubmitData && pendingSubmitData.message !== undefined)')
);

// Kiểm thử 13: Kiểm tra reset pendingSubmitData sau khi submit
test(
    'pendingSubmitData reset after submit',
    content.includes('pendingSubmitData = null')
);

// Kiểm thử 14: Kiểm tra phím Enter gọi submitData
test(
    'Enter key listener calls submitData',
    content.includes("if (e.key === 'Enter'") &&
    content.includes('submitData()')
);

// Kiểm thử 15: Kiểm tra nút send gọi submitData
test(
    'Send button listener calls submitData',
    content.includes("getElementById('send-btn')") &&
    content.includes('addEventListener(\'click\'') &&
    content.includes('submitData()')
);

console.log('\n========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log('========================================\n');

if (failed === 0) {
    console.log('🎉 All tests passed! Professional mode modal should work correctly.');
    console.log('📌 Next: Hard refresh browser (Ctrl+Shift+R) and test manually.');
    process.exit(0);
} else {
    console.log('⚠️  Some tests failed. Please check the fixes.');
    process.exit(1);
}
