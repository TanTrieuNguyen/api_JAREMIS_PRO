/**
 * JAREMIS Server Monitor
 * Giám sát server liên tục, ghi log mọi request và lỗi
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'http://localhost:3000';
const LOG_FILE = path.join(__dirname, 'server-monitor.log');
const CHECK_INTERVAL = 5000; // 5 giây

let checkCount = 0;
let failCount = 0;
let lastStatus = 'UNKNOWN';

// Ghi log
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  console.log(logMessage.trim());
  fs.appendFileSync(LOG_FILE, logMessage);
}

// Check server health
async function checkServer() {
  checkCount++;
  
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const req = http.get(SERVER_URL, (res) => {
      const responseTime = Date.now() - startTime;
      
      if (res.statusCode === 200) {
        if (lastStatus !== 'UP') {
          log(`✅ SERVER UP - Response: ${res.statusCode} (${responseTime}ms)`);
          lastStatus = 'UP';
        }
        resolve({ status: 'UP', code: res.statusCode, time: responseTime });
      } else {
        log(`⚠️ SERVER WARNING - Response: ${res.statusCode} (${responseTime}ms)`);
        resolve({ status: 'WARNING', code: res.statusCode, time: responseTime });
      }
    });
    
    req.on('error', (err) => {
      failCount++;
      if (lastStatus !== 'DOWN') {
        log(`❌ SERVER DOWN - Error: ${err.message}`);
        log(`   Failed after ${checkCount} checks (${failCount} total failures)`);
        lastStatus = 'DOWN';
      }
      resolve({ status: 'DOWN', error: err.message });
    });
    
    req.setTimeout(3000, () => {
      req.destroy();
      log(`⏱️ SERVER TIMEOUT - No response within 3s`);
      resolve({ status: 'TIMEOUT' });
    });
  });
}

// Main monitor loop
async function monitor() {
  log('🔍 JAREMIS Server Monitor Started');
  log(`   Target: ${SERVER_URL}`);
  log(`   Check Interval: ${CHECK_INTERVAL}ms`);
  log(`   Log File: ${LOG_FILE}`);
  log('----------------------------------------');
  
  while (true) {
    await checkServer();
    await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
  }
}

// Start monitoring
monitor().catch(err => {
  log(`💥 Monitor crashed: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('----------------------------------------');
  log(`📊 Monitor Statistics:`);
  log(`   Total Checks: ${checkCount}`);
  log(`   Total Failures: ${failCount}`);
  log(`   Success Rate: ${((checkCount - failCount) / checkCount * 100).toFixed(2)}%`);
  log('🛑 Monitor stopped by user');
  process.exit(0);
});
