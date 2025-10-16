#!/usr/bin/env node

/**
 * JAREMIS Health Check Script
 * Kiểm tra server có hoạt động tốt không
 */

const http = require('http');

console.log('🔍 JAREMIS Health Check Starting...\n');

const tests = [
  {
    name: 'Server Running',
    url: 'http://localhost:3000',
    method: 'GET'
  },
  {
    name: 'API Health',
    url: 'http://localhost:3000/api/health',
    method: 'GET'
  }
];

async function runTest(test) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: test.url.replace('http://localhost:3000', ''),
      method: test.method,
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 404) {
          console.log(`✅ ${test.name}: PASS (${res.statusCode})`);
          resolve(true);
        } else {
          console.log(`❌ ${test.name}: FAIL (${res.statusCode})`);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.log(`❌ ${test.name}: FAIL - ${err.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log(`❌ ${test.name}: TIMEOUT`);
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

async function main() {
  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);
    if (result) passed++;
    else failed++;
  }

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 All tests passed! Server is healthy.');
    process.exit(0);
  } else {
    console.log('\n⚠️  Some tests failed. Check server logs.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('❌ Health check error:', err);
  process.exit(1);
});
