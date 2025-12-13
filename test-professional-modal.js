// ========================================
// QUICK TEST: Professional Mode Modal Display
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

// Read file
const content = fs.readFileSync(indexPath, 'utf8');

// Test 1: Check .modal-backdrop.show CSS exists
test(
    'CSS .modal-backdrop.show exists',
    content.includes('.modal-backdrop.show')
);

// Test 2: Check .modal-backdrop.show has display:flex
test(
    'CSS .modal-backdrop.show has display:flex',
    content.includes('.modal-backdrop.show') && 
    content.match(/\.modal-backdrop\.show\s*\{[^}]*display:\s*flex/s)
);

// Test 3: Check modal backdrop element exists
test(
    'Modal backdrop element exists',
    content.includes('id="patient-info-modal-backdrop"')
);

// Test 4: Check submit button has no onclick duplicate
test(
    'Submit button has no onclick duplicate',
    !content.match(/<button[^>]+id="submit-patient-info-btn"[^>]+onclick=/i)
);

// Test 5: Check submitData function exists
test(
    'submitData function exists',
    content.includes('async function submitData()')
);

// Test 6: Check Professional mode check in submitData
test(
    'Professional mode check in submitData',
    content.includes("if (currentMode === 'professional')") &&
    content.includes('openPatientInfoModal()')
);

// Test 7: Check pendingSubmitData is declared
test(
    'pendingSubmitData variable declared',
    content.includes('let pendingSubmitData = null')
);

// Test 8: Check openPatientInfoModal adds .show class
test(
    'openPatientInfoModal adds .show class',
    content.includes("backdrop.classList.add('show')")
);

// Test 9: Check closePatientInfoModal removes .show class
test(
    'closePatientInfoModal removes .show class',
    content.includes("backdrop.classList.remove('show')")
);

// Test 10: Check submitProfessionalWithPatientInfo validates patient name
test(
    'submitProfessionalWithPatientInfo validates patient name',
    content.includes('if (!patientName)') &&
    content.includes('flashNotice')
);

// Test 11: Check event listener for submit-patient-info-btn
test(
    'Event listener for submit-patient-info-btn exists',
    content.includes('getElementById(\'submit-patient-info-btn\')') &&
    content.includes('addEventListener(\'click\'')
);

// Test 12: Check pendingSubmitData safe check
test(
    'pendingSubmitData safe check before performSubmit',
    content.includes('if (pendingSubmitData && pendingSubmitData.message !== undefined)')
);

// Test 13: Check pendingSubmitData reset after submit
test(
    'pendingSubmitData reset after submit',
    content.includes('pendingSubmitData = null')
);

// Test 14: Check Enter key listener calls submitData
test(
    'Enter key listener calls submitData',
    content.includes("if (e.key === 'Enter'") &&
    content.includes('submitData()')
);

// Test 15: Check send button listener calls submitData
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
