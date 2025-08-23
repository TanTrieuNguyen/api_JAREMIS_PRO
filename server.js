require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcryptjs');

const app = express();
const upload = multer({ dest: 'uploads/' });

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) console.warn('Cảnh báo: GOOGLE_API_KEY chưa được đặt.');
const genAI = new GoogleGenerativeAI(API_KEY || '');

app.use(express.static('public'));
app.use(express.json({ limit: '2mb' }));

const whoICDPath = path.join(__dirname, 'who_guidelines.json');
const usersPath = path.join(__dirname, 'users.json');

let icdData = {};
try { icdData = JSON.parse(fs.readFileSync(whoICDPath, 'utf8')); } catch(e){ console.warn('who_guidelines.json không tồn tại hoặc không hợp lệ'); }

// ===== Các hàm tiện ích người dùng =====
function ensureUsersFile() {
  if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, JSON.stringify([], null, 2), 'utf8');
}
ensureUsersFile();

function readUsers() {
  ensureUsersFile();
  try { const raw = fs.readFileSync(usersPath,'utf8'); return JSON.parse(raw || '[]'); } catch(e){ console.error('Lỗi đọc users.json', e); return []; }
}
function saveUsers(users) { fs.writeFileSync(usersPath, JSON.stringify(users, null, 2), 'utf8'); }
function findUserByUsername(username) { if (!username) return null; const users = readUsers(); return users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase()) || null; }
function pushUserHistory(username, historyEntry, maxItems = 500) {
  try {
    const users = readUsers();
    const idx = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return false;
    if (!Array.isArray(users[idx].history)) users[idx].history = [];
    users[idx].history.unshift(historyEntry);
    if (users[idx].history.length > maxItems) users[idx].history = users[idx].history.slice(0, maxItems);
    saveUsers(users);
    return true;
  } catch (e) {
    console.error('Lỗi khi lưu lịch sử người dùng', e);
    return false;
  }
}

// ===== Các hàm y tế =====
async function searchMedicalGuidelines(query) {
  try {
    const [clinicalResponse, pubmedResponse] = await Promise.allSettled([
      axios.get('https://clinicaltrials.gov/api/query/study_fields', {
        params: { expr: query, fields: 'NCTId,BriefTitle,Condition', fmt: 'json', max_rnk: 3 }, timeout: 5000
      }),
      axios.get('https://api.ncbi.nlm.nih.gov/lit/ctx/v1/pubmed/', {
        params: { q: query, format: 'json', retmax: 2 }, timeout: 5000
      })
    ]);

    const references = [];
    if (clinicalResponse.status === 'fulfilled') {
      const trials = clinicalResponse.value.data?.StudyFieldsResponse?.StudyFields || [];
      trials.forEach(trial => references.push({ title: trial.BriefTitle?.[0] || 'Nghiên cứu lâm sàng', url: trial.NCTId?.[0] ? `https://clinicaltrials.gov/ct2/show/${trial.NCTId?.[0]}` : 'https://clinicaltrials.gov', source: 'ClinicalTrials.gov' }));
    }
    if (pubmedResponse.status === 'fulfilled') {
      const articles = pubmedResponse.value.data?.articles || [];
      articles.forEach(article => references.push({ title: article.title || 'Bài báo y khoa', url: article.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${article.pmid}/` : 'https://pubmed.ncbi.nlm.nih.gov/', source: 'PubMed' }));
    }
    return references.slice(0,4);
  } catch (err) { console.error('Lỗi tìm kiếm tài liệu:', err); return []; }
}

function parseDiagnosisResponse(text) {
  const result = { differentialDiagnosis: [], diseases: [], confidence: 0, whoGuideline: '' };
  const diffRegex = /## Chẩn đoán phân biệt(?: \(WHO\))?\n([\s\S]*?)(?:\n##|$)/m;
  const diffMatch = diffRegex.exec(text);
  if (diffMatch) {
    result.differentialDiagnosis = diffMatch[1].split('\n').filter(line => line.trim().startsWith('-') || line.trim().startsWith('•')).map(line => line.replace(/^[-•]\s*/, '').trim());
  }
  const diseaseRegex = /•\s*(.+?)\s*\(Xác suất:\s*(\d+)%\)/g;
  let m;
  while ((m = diseaseRegex.exec(text)) !== null) result.diseases.push({ name: m[1].trim(), probability: parseInt(m[2]) });
  const confidenceMatch = text.match(/Độ tin cậy:\s*(\d+)%/);
  if (confidenceMatch) result.confidence = parseInt(confidenceMatch[1]);
  const whoMatch = text.match(/Hướng dẫn WHO:\s*\[?([^\]\n]+)\]?/i);
  if (whoMatch) result.whoGuideline = whoMatch[1].trim();
  return result;
}

function enrichWithICDDescriptions(diagnoses) {
  return diagnoses.map(entry => {
    const icdCodeMatch = entry.match(/\((.*?)\)$/);
    const icdCode = icdCodeMatch ? icdCodeMatch[1] : null;
    const description = icdCode && icdData[icdCode] ? icdData[icdCode].name : null;
    return { label: entry, icdCode, description: description || 'Không tìm thấy trong dữ liệu ICD' };
  });
}

// ===== Các endpoint Auth, Chat, Diagnose giữ nguyên =====
// ... (các phần code endpoint như bạn đã có)

// ===== Khởi động server + bộ đếm =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server đang chạy trên cổng ${PORT}`);

  // Đếm từ 1 đến vô hạn
  let counter = 1;
  setInterval(() => {
    console.log(counter++);
  }, 1000);
});
