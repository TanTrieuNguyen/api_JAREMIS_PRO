/**
 * TEST SCRIPT - Smart Symptom Search
 * Kiểm tra các test cases chính
 */

const { smartSymptomSearch } = require('./smartSymptomSearch');

// ANSI colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

async function runTests() {
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}🧪 SMART SYMPTOM SEARCH - TEST SUITE${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}\n`);

  const testCases = [
    {
      name: 'Test 1: Tiếng Việt - Thần Kinh',
      input: 'Tôi bị đau đầu dữ dội từ sáng nay',
      expectedKeyword: 'đau đầu',
      expectedCategory: 'neuro'
    },
    {
      name: 'Test 2: Tiếng Anh - Hô Hấp',
      input: 'My child has a high fever and cough for 3 days',
      expectedKeyword: 'high fever cough',
      expectedCategory: ['respiratory', 'infectious']
    },
    {
      name: 'Test 3: Tiếng Trung - Da Liễu',
      input: '我的皮肤很痒还有红疹',
      expectedKeyword: '皮肤痒 红疹',
      expectedCategory: 'dermatology'
    },
    {
      name: 'Test 4: Cấp Cứu',
      input: 'Đau ngực dữ dội và khó thở',
      expectedKeyword: 'đau ngực',
      expectedCategory: 'emergency'
    },
    {
      name: 'Test 5: Tâm Lý',
      input: 'Tôi cảm thấy trầm cảm và lo âu suốt',
      expectedKeyword: 'trầm cảm lo âu',
      expectedCategory: 'mental-health'
    },
    {
      name: 'Test 6: Tiêu Hóa',
      input: 'Đau bụng dưới bên phải kéo dài 2 ngày',
      expectedKeyword: 'đau bụng dưới bên phải',
      expectedCategory: 'gastro'
    },
    {
      name: 'Test 7: Nhiều Triệu Chứng',
      input: 'Con tôi sốt cao 39 độ, ho khan, chảy nước mũi',
      expectedKeyword: 'sốt cao ho khan chảy nước mũi',
      expectedCategory: 'infectious'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const test = testCases[i];
    console.log(`${colors.yellow}📝 ${test.name}${colors.reset}`);
    console.log(`   Input: "${test.input}"`);

    try {
      const result = await smartSymptomSearch(test.input);

      console.log(`   ✓ Extracted: "${result.extractedKeyword}"`);
      console.log(`   ✓ Category: ${result.category}`);
      console.log(`   ✓ Sources: ${result.sources.length} items`);
      
      if (result.sources.length > 0) {
        result.sources.forEach((source, idx) => {
          console.log(`     ${idx + 1}. ${source.source} - ${source.title}`);
        });
      }

      // Check if category matches
      const categoryMatch = Array.isArray(test.expectedCategory)
        ? test.expectedCategory.includes(result.category)
        : result.category === test.expectedCategory;

      if (categoryMatch && result.sources.length >= 3) {
        console.log(`${colors.green}   ✅ PASS${colors.reset}\n`);
        passed++;
      } else {
        console.log(`${colors.red}   ❌ FAIL - Expected category: ${test.expectedCategory}, got: ${result.category}${colors.reset}\n`);
        failed++;
      }

    } catch (error) {
      console.log(`${colors.red}   ❌ ERROR: ${error.message}${colors.reset}\n`);
      failed++;
    }
  }

  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.cyan}📊 TEST RESULTS${colors.reset}`);
  console.log(`${colors.cyan}========================================${colors.reset}`);
  console.log(`${colors.green}✅ Passed: ${passed}/${testCases.length}${colors.reset}`);
  console.log(`${colors.red}❌ Failed: ${failed}/${testCases.length}${colors.reset}`);
  
  const successRate = ((passed / testCases.length) * 100).toFixed(1);
  console.log(`${colors.blue}📈 Success Rate: ${successRate}%${colors.reset}\n`);

  if (failed === 0) {
    console.log(`${colors.green}🎉 ALL TESTS PASSED!${colors.reset}\n`);
  } else {
    console.log(`${colors.yellow}⚠️  Some tests failed. Review the output above.${colors.reset}\n`);
  }
}

// Run tests
runTests().catch(err => {
  console.error(`${colors.red}❌ Test suite crashed: ${err.message}${colors.reset}`);
  process.exit(1);
});
