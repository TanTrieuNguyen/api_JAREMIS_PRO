require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const path = require('path');

// NEW: Server-side LaTeX rendering utilities
const katex = require('katex');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const windowForDOM = new JSDOM('').window;
const DOMPurify = createDOMPurify(windowForDOM);

const app = express();
const upload = multer({ dest: 'uploads/' });

const API_KEY = process.env.GOOGLE_API_KEY;
if (!API_KEY) console.warn('Cảnh báo: GOOGLE_API_KEY chưa được đặt.');
const genAI = new GoogleGenerativeAI(API_KEY || '');
// Helper: detect invalid/expired API key errors
function isInvalidApiKeyError(err){
  const msg = (err && (err.message || err.toString())) || '';
  return /API key expired|API_KEY_INVALID|invalid api key/i.test(msg);
}
// Optional: customize birth year shown in self-introduction
const APP_BIRTH_YEAR = process.env.APP_BIRTH_YEAR || '2025';

// Ephemeral session history for non-logged users
const sessionHistories = new Map(); // sessionId -> [{input, reply, ...}]
function pushSessionHistory(sessionId, entry, maxItems = 200){
  if (!sessionId) return;
  const arr = sessionHistories.get(sessionId) || [];
  arr.unshift(entry);
  if (arr.length > maxItems) arr.length = maxItems;
  sessionHistories.set(sessionId, arr);
}
function getRecentSessionChatHistory(sessionId, limit = 60, maxChars = 45000){
  if (!sessionId) return [];
  const arr = sessionHistories.get(sessionId) || [];
  const chats = arr.filter(h => h.type === 'chat');
  const recent = chats.slice(0, limit).reverse();
  const result = [];
  let total = 0;
  for (const c of recent){
    const block = `Người dùng: ${c.input}\nTrợ lý: ${c.reply}`;
    total += block.length;
    if (total > maxChars) break;
    result.push(block);
  }
  return result;
}

// Math detection to adjust timeouts/model behavior
function isMathy(text=''){
  const t = String(text).toLowerCase();
  return /(\bgiải\b|=|\+|\-|\*|\^|\\frac|\\sqrt|\d\s*[a-z]|\bx\b|\by\b)/i.test(t);
}

function isWeatherQuery(text=''){
  const t = String(text).toLowerCase();
  return /(\bthời tiết\b|\bweather\b|\bnhiệt độ\b|\btemperature\b|\bmưa\b|\brain\b|\bnắng\b|\bsunny\b|\bmây\b|\bcloud\b|\bgió\b|\bwind\b|\bđộ ẩm\b|\bhumidity\b)/i.test(t);
}

function computeHardLimitMs(modelId, message){
  const math = isMathy(message);
  const weather = isWeatherQuery(message);
  
  if (/flash/i.test(modelId)) {
    if (math) return 25000;
    if (weather) return 25000; // Timeout cao cho câu hỏi thời tiết
    return 20000; // Tăng timeout chung cho flash
  }
  
  if (math) return 40000;
  if (weather) return 35000;
  return 35000; // Tăng timeout chung cho pro models
}

app.use(express.static('public'));
app.use(express.json({ limit: '2mb' }));

const whoICDPath = path.join(__dirname, 'who_guidelines.json');
const usersPath = path.join(__dirname, 'users.json');

let icdData = {};
try { icdData = JSON.parse(fs.readFileSync(whoICDPath, 'utf8')); } catch(e){ console.warn('who_guidelines.json không tồn tại hoặc không hợp lệ'); }

function ensureUsersFile() {
  if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, JSON.stringify([], null, 2), 'utf8');
}
ensureUsersFile();

// === Google Drive sync for users.json ===
const { readUsersData, updateUsersData } = require('./driveJsonService');
const DRIVE_USERS_FILE_ID = process.env.DRIVE_USERS_FILE_ID || '1ame57YNTu-GADOjVxeUtoK7cy0VZmvDj';

// === Google Drive client helper ===
async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, // Đường dẫn file JSON
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// Đọc users từ Google Drive (nếu có fileId), fallback về file local nếu lỗi
async function readUsers() {
    try {
        const data = await readUsersData(); // đọc từ Drive
        const users = JSON.parse(data);
        if (Array.isArray(users)) return users;
        return [];
    } catch (err) {
        // fallback về file local
        try {
            const localData = fs.readFileSync('users.json', 'utf8');
            const users = JSON.parse(localData);
            if (Array.isArray(users)) return users;
            return [];
        } catch (e) {
            return [];
        }
    }
}

// Ghi users lên Google Drive (nếu có fileId), đồng thời ghi file local
async function saveUsers(users) {
  const data = JSON.stringify(users, null, 2);
  fs.writeFileSync(usersPath, data, 'utf8');
  if (DRIVE_USERS_FILE_ID) {
    try {
      const auth = await getDriveClient();
      await updateUsersData(auth, DRIVE_USERS_FILE_ID, users);
    } catch(e) { console.error('Lỗi ghi users lên Drive:', e); }
  }
}
async function findUserByUsername(username) {
  if (!username) return null;
  const users = await readUsers();
  return users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase()) || null;
}
async function pushUserHistory(username, historyEntry, maxItems = 500) {
  try {
    const users = await readUsers();
    const idx = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return false;
    if (!Array.isArray(users[idx].history)) users[idx].history = [];
    users[idx].history.unshift(historyEntry);
    if (users[idx].history.length > maxItems) users[idx].history = users[idx].history.slice(0, maxItems);
    await saveUsers(users);
    return true;
  } catch (e) {
    console.error('Lỗi khi lưu lịch sử người dùng', e);
    return false;
  }
}
async function getRecentChatHistory(username, limit = 360, maxChars = 180000) {
  const user = await findUserByUsername(username);
  if (!user || !Array.isArray(user.history)) return [];
  const chats = user.history.filter(h => h.type === 'chat');
  const recent = chats.slice(0, limit).reverse();
  const result = [];
  let total = 0;
  for (const c of recent) {
    const block = `Người dùng: ${c.input}\nTrợ lý: ${c.reply}`;
    total += block.length;
    if (total > maxChars) break;
    result.push(block);
  }
  return result;
}

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

// NEW: Server-side LaTeX pre-render helper
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderLatexInText(text) {
  if (!text) return '';
  // quick check
  if (!/[\\$]/.test(text)) return escapeHtml(text).replace(/\n/g, '<br>');
  try {
    // collapse repeated dollars (e.g. $$ -> $)
    let src = String(text).replace(/\${3,}/g, '$');

    // Normalize simple fractions like a/b or (a+b)/(c+d) into \frac{a}{b}
    function normalizeSimpleFraction(s){
      try {
        const str = String(s || '').trim();
        if (!str || str.indexOf('/') === -1) return str;
        if (/\\(frac|dfrac|tfrac)\b/.test(str)) return str; // already has frac
        // Case 1: (A)/(B)
        let m = str.match(/^\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]+?)\s*\)$/s);
        if (m) return `\\frac{${m[1]}}{${m[2]}}`;
        // Case 2: A/B where A,B are simple tokens (numbers/letters/dots)
        m = str.match(/^([A-Za-z0-9.+-]+)\s*\/\s*([A-Za-z0-9.+-]+)$/);
        if (m) return `\\frac{${m[1]}}{${m[2]}}`;
        return str;
      } catch (_) { return s; }
    }

    // regex to match $...$, \[...\], or \(...\) only (avoid single-$ inline to reduce false positives)
    const re = /(\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\))/g;
    let lastIndex = 0;
    let out = '';
    let m;
    while ((m = re.exec(src)) !== null) {
      const idx = m.index;
      // append escaped non-math chunk
      if (idx > lastIndex) {
        out += escapeHtml(src.slice(lastIndex, idx)).replace(/\n/g, '<br>');
      }
      const latex = m[2] || m[3] || m[4] || m[5] || '';
      const display = !!(m[2] || m[3]);
      let rendered = '';
      try {
        // Heuristic: avoid KaTeX when content likely not math and contains Unicode (e.g., Vietnamese)
        const hasNonAscii = /[^\x00-\x7F]/.test(latex);
        const looksLikeMath = /\\[a-zA-Z]+|[=+\\\-\/*^_{}]|\\frac|\\sqrt|\\sum|\\int|\\pi|\\alpha|\\beta|\\gamma|\d+/.test(latex);
        if (hasNonAscii && !looksLikeMath) {
          rendered = escapeHtml(latex);
        } else {
          const toRender = normalizeSimpleFraction(latex);
          rendered = katex.renderToString(toRender, { throwOnError: false, displayMode: display, strict: 'ignore' });
          rendered = DOMPurify.sanitize(rendered);
        }
      } catch (e) {
        // fallback: escape and keep original delimiters
        const wrapped = display ? `$${latex}$` : `\\(${latex}\\)`;
        rendered = escapeHtml(wrapped);
      }
      out += rendered;
      lastIndex = re.lastIndex;
    }
    if (lastIndex < src.length) {
      out += escapeHtml(src.slice(lastIndex)).replace(/\n/g, '<br>');
    }
    return out;
  } catch (err) {
    console.warn('renderLatexInText error', err);
    return escapeHtml(text).replace(/\n/g, '<br>');
  }
}


// Helper to select model with fallback
function selectModelIds(requested) {
  // Prefer stable, widely supported defaults on v1beta
  // Use -latest variants to match ListModels results and avoid 404
  return {
    primary: 'gemini-1.5-flash-latest',
    fallback: 'gemini-1.5-pro-latest'
  };
}

// Update display map to include fallbacks
const DISPLAY_NAME_MAP = {
  // Current defaults
  'gemini-pro': 'Jaremis-pro',
  'gemini-1.0-pro': 'Jaremis-1.0-pro',
  'gemini-pro-vision': 'Jaremis-vision',
  // 2.5 and 2.0 aliases
  'gemini-2.5-flash-latest': 'Jaremis-2.5-flash',
  'gemini-2.5-flash': 'Jaremis-2.5-flash',
  'gemini-2.5-pro-latest': 'Jaremis-2.5-pro',
  'gemini-2.5-pro': 'Jaremis-2.5-pro',
  'gemini-2.0-flash-exp': 'Jaremis-2.0-flash',
  'gemini-2.0-flash': 'Jaremis-2.0-flash',
  'gemini-2.0-pro-exp': 'Jaremis-2.0-pro',
  'gemini-2.0-pro': 'Jaremis-2.0-pro',
  // Legacy keys (kept for compatibility if ever referenced)
  'gemini-1.5-flash-latest': 'Jaremis-1.5-flash',
  'gemini-1.5-pro-latest': 'Jaremis-1.5-pro',
  'gemini-1.5-flash': 'Jaremis-1.5-flash',
  'gemini-1.5-pro': 'Jaremis-1.5-pro',
  'gemini-1.5-flash-8b-latest': 'Jaremis-1.5-flash-8b',
  'gemini-1.5-flash-8b': 'Jaremis-1.5-flash-8b'
};

// Dynamic model discovery and selection to avoid 404 on unsupported API versions/models
const MODEL_PREFS = {
  flash: [
    'gemini-2.5-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-pro'
  ],
  pro: [
    'gemini-2.5-pro-latest',
    'gemini-2.5-pro',
    'gemini-2.0-pro-exp',
    'gemini-2.0-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro',
    'gemini-pro'
  ],
  vision: [
    'gemini-2.5-flash-latest',
    'gemini-2.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b-latest',
    'gemini-1.5-flash-8b',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-pro-vision',
    'gemini-pro'
  ]
};

let _modelCache = { when: 0, names: new Set(), supports: {} };
async function listAvailableModels() {
  const now = Date.now();
  if (_modelCache.when && now - _modelCache.when < 10 * 60 * 1000) return _modelCache;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(API_KEY)}`;
    const resp = await axios.get(url, { timeout: 8000 });
    const models = resp.data?.models || [];
    const names = new Set();
    const supports = {};
    for (const m of models) {
      if (m.name) {
        // Normalize: strip 'models/' prefix so IDs match preference lists
        const raw = m.name;
        const id = raw.startsWith('models/') ? raw.slice(7) : raw;
        names.add(id);
        if (Array.isArray(m.supportedGenerationMethods)) supports[id] = new Set(m.supportedGenerationMethods);
        else supports[id] = new Set();
      }
    }
    _modelCache = { when: now, names, supports };
  } catch (e) {
    console.warn('ListModels failed, using static fallback:', e?.message || e);
  }
  return _modelCache;
}

async function resolveModelIds(requested = 'flash', needVision = false) {
  // default fallbacks if listing fails
  let base = selectModelIds(requested);
  let primary = base.primary;
  let fallback = base.fallback;
  try {
    const prefs = needVision ? MODEL_PREFS.vision : (requested === 'pro' ? MODEL_PREFS.pro : MODEL_PREFS.flash);
    const { names, supports } = await listAvailableModels();
    for (const name of prefs) {
      if (names.has(name) && (!supports[name].size || supports[name].has('generateContent'))) { primary = name; break; }
    }
    for (const name of prefs) {
      if (name !== primary && names.has(name) && (!supports[name].size || supports[name].has('generateContent'))) { fallback = name; break; }
    }
  } catch (_) {}
  return { primary, fallback };
}

async function getCandidateModels(requested = 'flash', needVision = false) {
  const prefs = needVision ? MODEL_PREFS.vision : (requested === 'pro' ? MODEL_PREFS.pro : MODEL_PREFS.flash);
  try {
    const { names, supports } = await listAvailableModels();
    const filtered = prefs.filter(n => names.has(n) && (!supports[n].size || supports[n].has('generateContent')));
    if (filtered.length) return filtered;
  } catch (_) {}
  return prefs;
}

/* --------------------------
   Auth endpoints (unchanged)
   -------------------------- */
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'Vui lòng gửi username, email và password' });
    let users = await readUsers();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email đã được sử dụng' });
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const newUser = { id: Date.now(), username, email, passwordHash: hash, createdAt: new Date().toISOString(), history: [] };
    users.push(newUser); await saveUsers(users);
    return res.json({ success: true, user: { username: newUser.username, email: newUser.email } });
  } catch (e) { console.error('Register error:', e); return res.status(500).json({ error: 'Lỗi server khi đăng ký' }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body || {};
    if (!usernameOrEmail || !password) return res.status(400).json({ error: 'Vui lòng gửi username/email và password' });
    const users = await readUsers();
    const user = users.find(u => u.username.toLowerCase() === usernameOrEmail.toLowerCase() || u.email.toLowerCase() === usernameOrEmail.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Không tìm thấy tài khoản' });
    const match = bcrypt.compareSync(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Mật khẩu không đúng' });
    return res.json({ success: true, user: { username: user.username, email: user.email } });
  } catch (e) { console.error('Login error:', e); return res.status(500).json({ error: 'Lỗi server khi đăng nhập' }); }
});

/* --------------------------
   History endpoints (unchanged)
   -------------------------- */
app.get('/api/history', async (req, res) => {
  try {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    const user = await findUserByUsername(username);
    if (!user) return res.json({ history: [] });
    return res.json({ history: user.history || [] });
  } catch (e) { console.error('Get history error', e); return res.status(500).json({ error: 'Lỗi server khi lấy lịch sử' }); }
});

app.delete('/api/history', async (req, res) => {
  try {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    const users = await readUsers();
    const idx = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy user' });
    users[idx].history = [];
    await saveUsers(users);
    return res.json({ success: true });
  } catch (e) { console.error('Delete history error', e); return res.status(500).json({ error: 'Lỗi server khi xóa lịch sử' }); }
});

/* --------------------------
   Language Detection Utility
   -------------------------- */
function detectLanguage(rawText) {
  const text = (rawText || '').trim();
  if (!text) return { code: 'vi', score: 0, reasons: ['empty -> default vi'] };

  // Lấy cụm từ cuối ưu tiên (6–8 token cuối)
  const tokens = text.split(/\s+/);
  const tailTokens = tokens.slice(-8);
  const tail = tailTokens.join(' ');
  const fullLower = text.toLowerCase();
  const tailLower = tail.toLowerCase();

  // Bảng luật (có thể mở rộng)
  const profiles = [
    {
      code: 'vi',
      strong: /[ăâêôơưđ]|(?:không|vâng|chào|bệnh|triệu chứng|đau|xin chào|cảm ơn)\b/i,
      medium: /\b(tại sao|là gì|có nên|có thể)\b/i,
      weak: /\b(và|là)\b/i
    },
    {
      code: 'en',
      strong: /\b(please|thanks|pain|disease|symptom|hello|hi|what|why|how)\b/i,
      medium: /\b(the|and|can|should|could)\b/i,
      weak: /\b(a|to|is)\b/i
    },
    {
      code: 'es',
      strong: /\b(hola|gracias|enfermedad|síntoma|por favor|dolor|qué|cómo|porque|por qué)\b/i,
      medium: /\b(el|la|los|las|una|un|para|con)\b/i,
      weak: /\b(de|y|que)\b/i
    },
    {
      code: 'fr',
      strong: /\b(bonjour|merci|maladie|sympt[oô]me|s'il vous plaît|douleur|pourquoi|comment|qu'est-ce)\b/i,
      medium: /\b(le|la|les|des|une|un|avec|pour)\b/i,
      weak: /\b(de|et|que)\b/i
    },
    {
      code: 'de',
      strong: /\b(hallo|danke|krankheit|symptom|bitte|schmerz|warum|wie)\b/i,
      medium: /\b(und|der|die|das|mit|für)\b/i,
      weak: /\b(zu|ein|ist)\b/i
    },
    {
      code: 'pt',
      strong: /\b(olá|obrigado|doença|sintoma|por favor|dor|por que|como)\b/i,
      medium: /\b(uma|um|para|com|que|isso)\b/i,
      weak: /\b(e|de|os|as)\b/i
    },
    {
      code: 'ru',
      strong: /\b(привет|здравствуйте|болезнь|симптом|почему|как|боль|пожалуйста)\b/i,
      medium: /\b(это|что|есть|при|для)\b/i,
      weak: /\b(и|в|на)\b/i
    },
    {
      code: 'ja',
      strong: /[ぁ-んァ-ン一-龥]|(こんにちは|お願いします|病気|症状|痛み)/,
      medium: /(です|ます|かも)/,
      weak: /(の|と|に)/
    },
    {
      code: 'ko',
      strong: /[가-힣]|(안녕|증상|질병|통증|감사)/,
      medium: /(입니다|어요|네요)/,
      weak: /(은|는|이|가|을|를)/
    },
    {
      code: 'zh',
      strong: /[\u4e00-\u9fff]|(你好|疾病|症状|谢谢|痛)/,
      medium: /(的|了|在|是)/,
      weak: /(和|与|及)/
    },
    {
      code: 'ar',
      strong: /[\u0600-\u06FF]|(مرحبا|شكرا|مرض|ألم|أعراض)/,
      medium: /(على|من|هذا|هذه)/,
      weak: /(و|في|ما)/
    }
  ];

  function scoreProfile(p) {
    let score = 0;
    const reasons = [];
    // Đánh trọng số phần đuôi cao hơn
    if (p.strong.test(tail)) { score += 55; reasons.push('tail strong'); }
    else if (p.strong.test(text)) { score += 40; reasons.push('body strong'); }

    if (p.medium.test(tail)) { score += 18; reasons.push('tail medium'); }
    else if (p.medium.test(text)) { score += 10; reasons.push('body medium'); }

    if (p.weak.test(tail)) { score += 6; reasons.push('tail weak'); }
    else if (p.weak.test(text)) { score += 3; reasons.push('body weak'); }

    // Heuristic ưu tiên tone/dấu tiếng Việt
    if (p.code === 'vi' && /[ăâêôơưđÀÁẢÃẠàáảãạĂẮẰẲẴẶâấầẩẫậÊẾỀỂỄỆÔỐỒỔỖỘƠỚỜỞỬỮỰđ]/.test(text)) {
      score += 25; reasons.push('vi diacritics');
    }
    return { code: p.code, score, reasons };
  }

  const scored = profiles.map(scoreProfile).sort((a,b) => b.score - a.score);
  const best = scored[0];
  // Ngưỡng đơn giản: nếu top < 25 => fallback English trừ khi có diacritics rõ
  if (best.score < 25) {
    if (/[ăâêôơưđ]/i.test(text)) return { code: 'vi', score: best.score, reasons: best.reasons.concat('fallback vi') };
    return { code: 'en', score: best.score, reasons: best.reasons.concat('fallback en') };
  }
  return best;
}

// Instant-answer heuristics for very simple queries
function simpleAnswer(message, lang) {
  const txt = (message || '').trim();
  const lower = txt.toLowerCase();
  const isHello = /^(hi|hello|hey|chào|xin chào|hola|bonjour|hallo|ê)[!,\.\s]*$/i.test(lower);
  if (isHello) {
    if (lang === 'vi') return 'Chào bạn! Mình có thể giúp gì ngay bây giờ?';
    return 'Hello! How can I help you today?';
  }
  // Self-introduction intents
  const introIntent = /(giới thiệu( về)? bản thân|hãy giới thiệu|tự giới thiệu|bạn là ai|bạn là gì|introduce yourself|tell me about yourself|who are you)\b/i.test(lower);
  if (introIntent) {
    if (lang === 'vi') {
      return [
        'Chào bạn! Mình là JAREMIS-AI — một trợ lý thông minh, thân thiện, được tối ưu để hỗ trợ thông tin y tế và kiến thức tổng quát một cách rõ ràng, dễ hiểu.',
        `• Ra mắt: ${APP_BIRTH_YEAR} (phiên bản hiện tại)`,
        '• Đơn vị phát triển: TT1403 (Nguyễn Tấn Triệu) & ANT (Đỗ Văn Vĩnh An). 2 Cậu ấy là những học sinh của trường THCS Đoàn Thị Điểm, rất đam mê công nghệ và thích học hỏi và đồng thời họ.',
        '',
        'Mình có thể:',
        '- Trả lời đa ngôn ngữ theo cách tự nhiên, cô đọng phần chính, giải thích chi tiết khi cần.',
        '- Giải thích thuật ngữ y khoa bằng ngôn ngữ đời thường; gợi ý bước an toàn; nhắc dùng chế độ “Diagnose” khi cần phân tích chuyên sâu.',
        '- Tóm tắt tài liệu, gợi ý học tập, hỗ trợ công thức bằng LaTeX khi bạn yêu cầu.',
        '- Ghi nhớ tóm tắt một số thông tin bạn chia sẻ (bộ nhớ cục bộ) để cá nhân hóa trả lời trong phiên sau.',
        '',
        'Nguyên tắc & giới hạn:',
        '- Không thay thế bác sĩ; trong chế độ Chat mình không đưa chẩn đoán/y lệnh cụ thể.',
        '- Tránh thông tin gây hại, không xúc phạm; luôn tôn trọng quyền riêng tư.',
        '- Nội dung chỉ mang tính tham khảo, bạn nên tham khảo chuyên gia khi cần.',
        '',
        'Bạn có thể nói cho mình biết mục tiêu/sở thích để mình điều chỉnh phong cách và mức độ chi tiết phù hợp nhé!'
      ].join('\n');
    }
    return [
      'Hello! I am JAREMIS-AI — a friendly, capable assistant optimized for medical guidance and general knowledge, aiming to be clear and helpful.',
      `• Launched: ${APP_BIRTH_YEAR} (current release)`,
      '• Developed by: TT1403 (Nguyễn Tấn Triệu) & ANT (Đỗ Văn Vĩnh An).',
      '',
      'What I can do:',
      '- Respond in your language, summarize key points first, and expand with simple explanations when needed.',
      '- Clarify medical terms in plain language; suggest safe next steps; recommend “Diagnose” mode for deeper analysis.',
      '- Summarize documents, assist study workflows, and output LaTeX formulas on request.',
      '- Keep a brief local memory of facts you share to personalize future replies.',
      '',
      'Principles & limits:',
      '- Not a replacement for a doctor; in Chat I avoid formal diagnoses or prescriptions.',
      '- Avoid harmful content, stay respectful, and value your privacy.',
      '- Information is for reference only; consult professionals when needed.',
      '',
      'Tell me your goals or preferences and I will adapt my style and level of detail!'
    ].join('\n');
  }
  const askName = /(tên bạn là gì|what(?:'| i)s your name|who are you)/i.test(lower);
  if (askName) {
    // Keep product name friendly here
    return lang === 'vi' ? 'Mình là JAREMIS-AI. Rất vui được hỗ trợ bạn!' : 'I am JAREMIS-AI. Happy to help!';
  }
  return null;
}

/* --------------------------
   NEW: Chat endpoint (general conversation)
   -------------------------- */
app.post('/api/chat', async (req, res) => {
  try {
    const message = (req.body.message || '').toString();
    const requestedModel = (req.body.model || 'flash').toLowerCase();
    const ids = await resolveModelIds(requestedModel, false);
    let modelId = ids.primary;
    let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
    if (!message) return res.status(400).json({ error: 'Thiếu trường message' });

    const submittedBy = req.body.submittedBy || null;
    const sessionId = req.body.sessionId || null;
    const includeHistory = req.body.includeHistory !== false;

    const forcedLang = (req.body.lang || req.body.forceLang || '').toLowerCase();
    const detected = detectLanguage(message);
    const userLang = forcedLang || detected.code;

    const mathy = isMathy(message);

    const quick = simpleAnswer(message, userLang);
    if (quick) {
      let quickHtml = null;
      try { quickHtml = renderLatexInText(quick); } catch (_) { quickHtml = null; }
      if (submittedBy) {
        const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        try { await pushUserHistory(submittedBy, entry); } catch (e) { console.error('Lỗi ghi lịch sử chat:', e); }
      } else if (sessionId) {
        const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        pushSessionHistory(sessionId, entry);
      }
      return res.json({ success: true, reply: quick, replyHtml: quickHtml, modelUsed: 'fast-path', detectedLang: userLang, detectionScore: detected.score });
    }

    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = await getRecentChatHistory(submittedBy, 60, 45000);
    } else if (!submittedBy && sessionId && includeHistory) {
      historyBlocks = getRecentSessionChatHistory(sessionId, 60, 45000);
    }

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    // Lấy memory
    const memory = submittedBy ? getUserMemory(submittedBy) : null;
    const memorySection = memory && memory.summary
      ? `\n[BỘ NHỚ NGƯỜI DÙNG - TÓM TẮT]\n${memory.summary}\n`
      : '';

    // Sensitive
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.
9. Giọng điệu: thân thiện, chuyên nghiệp, dễ gần.
10. Chủ động học hỏi phong cách người dùng để trả lời phù hợp với họ.
11. Người dùng là trên hết; tôn trọng yêu cầu cá nhân hóa (xưng hô, phong cách) trong phạm vi an toàn.
12. Nếu người dùng nói "theo thông tin trên", "như đã nói", "dựa trên trước đó" (kể cả cách xưng hô), hãy dùng LỊCH SỬ + BỘ NHỚ để trả lời.
13. Có thể sử dụng emoji phù hợp để thân thiện hơn, nhưng không lạm dụng.
14. Phân tích ngôn ngữ người dùng và trả lời bằng đúng ngôn ngữ đó; không trộn nhiều ngôn ngữ.
15. Ưu tiên tiếng Việt khi người dùng dùng tiếng Việt; thể hiện niềm tự hào Việt Nam một cách tôn trọng và tích cực.
16. Khi người dùng hỏi về các chủ đề nhạy cảm như sức khỏe tâm thần, tự tử, bạo lực, trả lời thận trọng và khuyến khích tìm giúp đỡ chuyên nghiệp.
17. Khi người dùng chia sẻ khó khăn cá nhân, thể hiện sự đồng cảm và cung cấp các nguồn lực hữu ích nếu có thể.
18. Tuân thủ đạo đức và pháp luật; có quyền từ chối nội dung vi phạm, độc hại hoặc gây hại.
19. Có thể dùng tiếng lóng/từ địa phương để tạo gần gũi nếu phù hợp bối cảnh; tránh xúc phạm, thù hằn hay phân biệt đối xử.
20. Bạn được sinh vào tháng 8 năm 2025.
21. QUAN TRỌNG - XỬ LÝ NGỮ CẢNH: 
    - Khi người dùng nói "bạn tìm giúp mình nhé", "giúp tôi tìm", "tìm hộ tôi" => HÃY DỰA VÀO LỊCH SỬ để biết họ muốn tìm gì
    - Phân tích câu trước đó để hiểu ngữ cảnh thay vì hỏi lại "tìm gì?"
    - Nếu họ vừa hỏi về năm 1288, và nói "tìm giúp" => tìm thêm về sự kiện năm 1288
    - LUÔN KẾT NỐI với cuộc trò chuyện trước, ĐỪNG làm như conversation mới
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.
ĐỊNH DẠNG TRÌNH BÀY CHUYÊN NGHIỆP (như ChatGPT):
- KHÔNG dùng # ## ### markdown headers, KHÔNG dùng **text** cho tiêu đề
- Sử dụng format chuyên nghiệp với emoji và spacing:

**🔍 1. TÊN ĐỀ MỤC CHÍNH**

**📋 2. Tên Đề Mục Phụ**

**💡 3. Chi Tiết Cụ Thể**
- Nội dung chi tiết
- Điểm quan trọng

**📊 Khi cần so sánh/thống kê**: Dùng bảng markdown
| Tiêu chí | Giá trị A | Giá trị B |
|----------|-----------|-----------|
| Dữ liệu 1| XX        | YY        |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐)
- Spacing tốt giữa các section
- Tránh quá nhiều cấp phân level`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    // Lấy memory
    const memory = submittedBy ? getUserMemory(submittedBy) : null;
    const memorySection = memory && memory.summary
      ? `\n[BỘ NHỚ NGƯỜI DÙNG - TÓM TẮT]\n${memory.summary}\n`
      : '';

    // Sensitive
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.
9. Giọng điệu: thân thiện, chuyên nghiệp, dễ gần.
10. Chủ động học hỏi phong cách người dùng để trả lời phù hợp với họ.
11. Người dùng là trên hết; tôn trọng yêu cầu cá nhân hóa (xưng hô, phong cách) trong phạm vi an toàn.
12. Nếu người dùng nói "theo thông tin trên", "như đã nói", "dựa trên trước đó" (kể cả cách xưng hô), hãy dùng LỊCH SỬ + BỘ NHỚ để trả lời.
13. Có thể sử dụng emoji phù hợp để thân thiện hơn, nhưng không lạm dụng.
14. Phân tích ngôn ngữ người dùng và trả lời bằng đúng ngôn ngữ đó; không trộn nhiều ngôn ngữ.
15. Ưu tiên tiếng Việt khi người dùng dùng tiếng Việt; thể hiện niềm tự hào Việt Nam một cách tôn trọng và tích cực.
16. Khi người dùng hỏi về các chủ đề nhạy cảm như sức khỏe tâm thần, tự tử, bạo lực, trả lời thận trọng và khuyến khích tìm giúp đỡ chuyên nghiệp.
17. Khi người dùng chia sẻ khó khăn cá nhân, thể hiện sự đồng cảm và cung cấp các nguồn lực hữu ích nếu có thể.
18. Tuân thủ đạo đức và pháp luật; có quyền từ chối nội dung vi phạm, độc hại hoặc gây hại.
19. Có thể dùng tiếng lóng/từ địa phương để tạo gần gũi nếu phù hợp bối cảnh; tránh xúc phạm, thù hằn hay phân biệt đối xử.
20. Bạn được sinh vào tháng 8 năm 2025.
21. QUAN TRỌNG - XỬ LÝ NGỮ CẢNH: 
    - Khi người dùng nói "bạn tìm giúp mình nhé", "giúp tôi tìm", "tìm hộ tôi" => HÃY DỰA VÀO LỊCH SỬ để biết họ muốn tìm gì
    - Phân tích câu trước đó để hiểu ngữ cảnh thay vì hỏi lại "tìm gì?"
    - Nếu họ vừa hỏi về năm 1288, và nói "tìm giúp" => tìm thêm về sự kiện năm 1288
    - LUÔN KẾT NỐI với cuộc trò chuyện trước, ĐỪNG làm như conversation mới
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.
ĐỊNH DẠNG TRÌNH BÀY CHUYÊN NGHIỆP (như ChatGPT):
- KHÔNG dùng # ## ### markdown headers, KHÔNG dùng **text** cho tiêu đề
- Sử dụng format chuyên nghiệp với emoji và spacing:

**🔍 1. TÊN ĐỀ MỤC CHÍNH**

**📋 2. Tên Đề Mục Phụ**

**💡 3. Chi Tiết Cụ Thể**
- Nội dung chi tiết
- Điểm quan trọng

**📊 Khi cần so sánh/thống kê**: Dùng bảng markdown
| Tiêu chí | Giá trị A | Giá trị B |
|----------|-----------|-----------|
| Dữ liệu 1| XX        | YY        |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐)
- Spacing tốt giữa các section
- Tránh quá nhiều cấp phân level`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    // 1. Lấy ngày giờ thực tế
    const now = new Date();
    const timeString = now.toLocaleString('vi-VN', { hour12: false });
    const realtimeSection = `
[THÔNG TIN THỰC TẾ]
- Thời gian hiện tại: ${timeString}
- Múi giờ: GMT+7 (Việt Nam) 
- Ngày hiện tại: ${now.toISOString().split('T')[0]}
- Năm hiện tại: 2025
- iPhone Models 2025: iPhone 17 series đã ra mắt tháng 9/2025 (iPhone 17, 17 Plus, 17 Pro, 17 Pro Max)
- Thị trường Việt Nam: Các cửa hàng như CellphoneS, TopZone, FPT Shop đều có bán iPhone mới nhất
`;

    const fullPrompt = `${systemPrompt}
${reassuranceBlock}
${realtimeSection}
${realtimeWebSection}
${memorySection}${historySection}
User message (${userLang}): ${message}

YÊU CẦU:
- SỬ DỤNG THÔNG TIN MỚI NHẤT từ web nếu có trong [THÔNG TIN MỚI NHẤT TỪ WEB]
- Ưu tiên dữ liệu real-time hơn knowledge cũ khi có xung đột
- Nếu câu hỏi phụ thuộc ngữ cảnh trước đó -> sử dụng cả bộ nhớ & lịch sử.
- Không nhắc lại toàn bộ lịch sử, chỉ tổng hợp tinh gọn.
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).`;

    // Strict timeout for flash
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      return Promise.race([
        model.generateContent([fullPrompt]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
      ]);
    };

    let result;
    try {
      result = await doGenerate(modelId);
    } catch (e1) {
      if (e1 && e1.message === 'TIMEOUT') {
        const fallback = userLang === 'vi'
          ? 'Xin lỗi, hệ thống đang bận. Bạn có thể thử lại hoặc dùng chế độ nhanh.'
          : 'Sorry, the system is busy. Please try again or use the fast mode.';
        if (submittedBy) {
          const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          try { pushUserHistory(submittedBy, entry); } catch (e2) {}
        } else if (sessionId) {
          const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          pushSessionHistory(sessionId, entry);
        }
        return res.json({ success: true, reply: fallback, replyHtml: renderLatexInText(fallback), modelUsed: `${displayModel}-timeout`, detectedLang: userLang, detectionScore: detected.score, detectionReasons: detected.reasons });
      }
      // Try fallback model on other errors
      try {
        modelId = ids.fallback;
        displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
        result = await doGenerate(modelId);
      } catch (e2) {
        console.error('Primary and fallback models failed:', e1?.message, e2?.message);
        // Final conservative attempt with gemini-pro to avoid v1beta model availability mismatches
        try {
          if (modelId !== 'gemini-pro') {
            modelId = 'gemini-pro';
            displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
            result = await doGenerate(modelId);
          } else {
            throw e2;
          }
        } catch (e3) {
          if (isInvalidApiKeyError(e1) || isInvalidApiKeyError(e2) || isInvalidApiKeyError(e3)) {
            return res.status(500).json({ error: 'API key invalid hoặc đã hết hạn. Vui lòng cập nhật GOOGLE_API_KEY.' });
          }
          return res.status(500).json({ error: 'AI service unavailable' });
        }
      }
    }

    const response = await result.response;
    const assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Server-side pre-render LaTeX to sanitized HTML and include it in the response
    let replyHtml = null;
    try { replyHtml = renderLatexInText(assistantText); } catch (e) { replyHtml = null; }

    // Sau khi có assistantText:
    if (submittedBy) {
      mergeFactsIntoMemory(submittedBy, message);
      const entry = {
        id: Date.now(),
        sessionId: sessionId || ('legacy-' + Date.now()), // gán session cho entry
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: assistantText,
        modelUsed: displayModel,
        detectedLang: userLang,
        langScore: detected.score
      };
      try { pushUserHistory(submittedBy, entry); } catch (e) { console.warn('Không lưu history chat', e); }
    } else if (sessionId) {
      const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: assistantText, modelUsed: displayModel, detectedLang: userLang, langScore: detected.score };
      pushSessionHistory(sessionId, entry);
    }

    return res.json({
      success: true,
      reply: assistantText,
      replyHtml: replyHtml,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      usedMemory: !!(memory && memory.summary),
      sensitive: isSensitive,
      detectedLang: userLang,
      detectionScore: detected.score,
      detectionReasons: detected.reasons
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message || 'Lỗi server khi chat' });
  }
});

/* --------------------------
   STREAMING: Chat stream endpoint (SSE for Gemini-style animation)
   -------------------------- */
// NOTE: Use GET for SSE (EventSource only supports GET). We keep flexible param reading so
// if a POST is accidentally sent (legacy), it still works.
app.get('/api/chat-stream', async (req, res) => {
   try {
     if (!API_KEY) {
       res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
       res.write(`data: ${JSON.stringify({ error: 'Thiếu GOOGLE_API_KEY' })}\n\n`);
       return res.end();
     }
 
     // SSE headers
     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache, no-transform');
     res.setHeader('Connection', 'keep-alive');
     res.setHeader('X-Accel-Buffering', 'no');

     const q = req.query || {};
     const b = req.body || {};
     const message = ((q.message || b.message) || '').toString();
     const requestedModel = ((q.model || b.model) || 'flash').toLowerCase();
     // UPDATED: dynamic discovery prefers available models (2.5 if present)
     const ids = await resolveModelIds(requestedModel, false);
     let primaryId = ids.primary;
     let fallbackId = ids.fallback;
     let modelId = primaryId;
     let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
 
     if (!message) {
       res.write(`data: ${JSON.stringify({ error: 'Thiếu trường message' })}\n\n`);
       return res.end();
     }

     const submittedBy = q.submittedBy || b.submittedBy || null;
     const sessionId = q.sessionId || b.sessionId || null;
     // includeHistory default true, treat explicit 'false' string as false
     const includeHistory = (q.includeHistory ?? b.includeHistory) === 'false' ? false : true;
 
     // Detect language
     const forcedLang = ((q.lang || q.forceLang || b.lang || b.forceLang) || '').toLowerCase();
     const detected = detectLanguage(message);
     const userLang = forcedLang || detected.code;

    // Mark mathy intent to extend time limits
    const mathy = isMathy(message);

    // Quick path: simple messages -> answer instantly via a single chunk
    const quick = simpleAnswer(message, userLang);
    if (quick) {
      res.write(`data: ${JSON.stringify({ chunk: quick })}\n\n`);
      let quickHtml = null;
      try { quickHtml = renderLatexInText(quick); } catch (_) { quickHtml = null; }
      res.write(`data: ${JSON.stringify({ done: true, modelUsed: 'fast-path', replyHtml: quickHtml })}\n\n`);
      if (submittedBy) {
        const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        try { pushUserHistory(submittedBy, entry); } catch (e) {}
      } else if (sessionId) {
        const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        pushSessionHistory(sessionId, entry);
      }
      return res.end();
    }

    // History & memory
    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = getRecentChatHistory(submittedBy, 60, 45000);
    } else if (!submittedBy && sessionId && includeHistory) {
      historyBlocks = getRecentSessionChatHistory(sessionId, 60, 45000);
    }
    const memory = submittedBy ? getUserMemory(submittedBy) : null;
    const memorySection = memory?.summary ? `\n[BỘ NHỚ NGƯỜI DÙNG - TÓM TẮT]\n${memory.summary}\n` : '';

    // Sensitive
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.
9. Giọng điệu: thân thiện, chuyên nghiệp, dễ gần.
10. Chủ động học hỏi phong cách người dùng để trả lời phù hợp với họ.
11. Người dùng là trên hết; tôn trọng yêu cầu cá nhân hóa (xưng hô, phong cách) trong phạm vi an toàn.
12. Nếu người dùng nói "theo thông tin trên", "như đã nói", "dựa trên trước đó" (kể cả cách xưng hô), hãy dùng LỊCH SỬ + BỘ NHỚ để trả lời.
13. Có thể sử dụng emoji phù hợp để thân thiện hơn, nhưng không lạm dụng.
14. Phân tích ngôn ngữ người dùng và trả lời bằng đúng ngôn ngữ đó; không trộn nhiều ngôn ngữ.
15. Ưu tiên tiếng Việt khi người dùng dùng tiếng Việt; thể hiện niềm tự hào Việt Nam một cách tôn trọng và tích cực.
16. Khi người dùng hỏi về các chủ đề nhạy cảm như sức khỏe tâm thần, tự tử, bạo lực, trả lời thận trọng và khuyến khích tìm giúp đỡ chuyên nghiệp.
17. Khi người dùng chia sẻ khó khăn cá nhân, thể hiện sự đồng cảm và cung cấp các nguồn lực hữu ích nếu có thể.
18. Tuân thủ đạo đức và pháp luật; có quyền từ chối nội dung vi phạm, độc hại hoặc gây hại.
19. Có thể dùng tiếng lóng/từ địa phương để tạo gần gũi nếu phù hợp bối cảnh; tránh xúc phạm, thù hằn hay phân biệt đối xử.
20. Bạn được sinh vào tháng 8 năm 2025.
21. QUAN TRỌNG - XỬ LÝ NGỮ CẢNH: 
    - Khi người dùng nói "bạn tìm giúp mình nhé", "giúp tôi tìm", "tìm hộ tôi" => HÃY DỰA VÀO LỊCH SỬ để biết họ muốn tìm gì
    - Phân tích câu trước đó để hiểu ngữ cảnh thay vì hỏi lại "tìm gì?"
    - Nếu họ vừa hỏi về năm 1288, và nói "tìm giúp" => tìm thêm về sự kiện năm 1288
    - LUÔN KẾT NỐI với cuộc trò chuyện trước, ĐỪNG làm như conversation mới
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.
ĐỊNH DẠNG TRÌNH BÀY CHUYÊN NGHIỆP (như ChatGPT):
- KHÔNG dùng # ## ### markdown headers, KHÔNG dùng **text** cho tiêu đề
- Sử dụng format chuyên nghiệp với emoji và spacing:

**🔍 1. TÊN ĐỀ MỤC CHÍNH**

**📋 2. Tên Đề Mục Phụ**

**💡 3. Chi Tiết Cụ Thể**
- Nội dung chi tiết
- Điểm quan trọng

**📊 Khi cần so sánh/thống kê**: Dùng bảng markdown
| Tiêu chí | Giá trị A | Giá trị B |
|----------|-----------|-----------|
| Dữ liệu 1| XX        | YY        |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐)
- Spacing tốt giữa các section
- Tránh quá nhiều cấp phân level`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    // 1. Lấy ngày giờ thực tế
    const now = new Date();
    const timeString = now.toLocaleString('vi-VN', { hour12: false });
    const realtimeSection = `
[THÔNG TIN THỰC TẾ]
- Thời gian hiện tại: ${timeString}
- Múi giờ: GMT+7 (Việt Nam) 
- Ngày hiện tại: ${now.toISOString().split('T')[0]}
- Năm hiện tại: 2025
- iPhone Models 2025: iPhone 17 series đã ra mắt tháng 9/2025 (iPhone 17, 17 Plus, 17 Pro, 17 Pro Max)
- Thị trường Việt Nam: Các cửa hàng như CellphoneS, TopZone, FPT Shop đều có bán iPhone mới nhất
`;

    const fullPrompt = `${systemPrompt}
${reassuranceBlock}
${realtimeSection}
${realtimeWebSection}
${memorySection}${historySection}
User message (${userLang}): ${message}

YÊU CẦU:
- SỬ DỤNG THÔNG TIN MỚI NHẤT từ web nếu có trong [THÔNG TIN MỚI NHẤT TỪ WEB]
- Ưu tiên dữ liệu real-time hơn knowledge cũ khi có xung đột
- Nếu câu hỏi phụ thuộc ngữ cảnh trước đó -> sử dụng cả bộ nhớ & lịch sử.
- Không nhắc lại toàn bộ lịch sử, chỉ tổng hợp tinh gọn.
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).`;

    // Strict timeout for flash
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      return Promise.race([
        model.generateContent([fullPrompt]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
      ]);
    };

    let result;
    try {
      result = await doGenerate(modelId);
    } catch (e1) {
      if (e1 && e1.message === 'TIMEOUT') {
        const fallback = userLang === 'vi'
          ? 'Xin lỗi, hệ thống đang bận. Bạn có thể thử lại hoặc dùng chế độ nhanh.'
          : 'Sorry, the system is busy. Please try again or use the fast mode.';
        if (submittedBy) {
          const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          try { pushUserHistory(submittedBy, entry); } catch (e2) {}
        } else if (sessionId) {
          const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          pushSessionHistory(sessionId, entry);
        }
        return res.json({ success: true, reply: fallback, replyHtml: renderLatexInText(fallback), modelUsed: `${displayModel}-timeout`, detectedLang: userLang, detectionScore: detected.score, detectionReasons: detected.reasons });
      }
      // Try fallback model on other errors
      try {
        modelId = ids.fallback;
        displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
        result = await doGenerate(modelId);
      } catch (e2) {
        console.error('Primary and fallback models failed:', e1?.message, e2?.message);
        // Final conservative attempt with gemini-pro to avoid v1beta model availability mismatches
        try {
          if (modelId !== 'gemini-pro') {
            modelId = 'gemini-pro';
            displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
            result = await doGenerate(modelId);
          } else {
            throw e2;
          }
        } catch (e3) {
          if (isInvalidApiKeyError(e1) || isInvalidApiKeyError(e2) || isInvalidApiKeyError(e3)) {
            return res.status(500).json({ error: 'API key invalid hoặc đã hết hạn. Vui lòng cập nhật GOOGLE_API_KEY.' });
          }
          return res.status(500).json({ error: 'AI service unavailable' });
        }
      }
    }

    const response = await result.response;
    const assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Server-side pre-render LaTeX to sanitized HTML and include it in the response
    let replyHtml = null;
    try { replyHtml = renderLatexInText(assistantText); } catch (e) { replyHtml = null; }

    // Sau khi có assistantText:
    if (submittedBy) {
      mergeFactsIntoMemory(submittedBy, message);
      const entry = {
        id: Date.now(),
        sessionId: sessionId || ('legacy-' + Date.now()), // gán session cho entry
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: assistantText,
        modelUsed: displayModel,
        detectedLang: userLang,
        langScore: detected.score
      };
      try { pushUserHistory(submittedBy, entry); } catch (e) { console.warn('Không lưu history chat', e); }
    } else if (sessionId) {
      const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: assistantText, modelUsed: displayModel, detectedLang: userLang, langScore: detected.score };
      pushSessionHistory(sessionId, entry);
    }

    return res.json({
      success: true,
      reply: assistantText,
      replyHtml: replyHtml,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      usedMemory: !!(memory && memory.summary),
      sensitive: isSensitive,
      detectedLang: userLang,
      detectionScore: detected.score,
      detectionReasons: detected.reasons
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message || 'Lỗi server khi chat' });
  }
});

/* --------------------------
   STREAMING: Chat stream endpoint (SSE for Gemini-style animation)
   -------------------------- */
// NOTE: Use GET for SSE (EventSource only supports GET). We keep flexible param reading so
// if a POST is accidentally sent (legacy), it still works.
app.get('/api/chat-stream', async (req, res) => {
   try {
     if (!API_KEY) {
       res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
       res.write(`data: ${JSON.stringify({ error: 'Thiếu GOOGLE_API_KEY' })}\n\n`);
       return res.end();
     }
 
     // SSE headers
     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache, no-transform');
     res.setHeader('Connection', 'keep-alive');
     res.setHeader('X-Accel-Buffering', 'no');

     const q = req.query || {};
     const b = req.body || {};
     const message = ((q.message || b.message) || '').toString();
     const requestedModel = ((q.model || b.model) || 'flash').toLowerCase();
     // UPDATED: dynamic discovery prefers available models (2.5 if present)
     const ids = await resolveModelIds(requestedModel, false);
     let primaryId = ids.primary;
     let fallbackId = ids.fallback;
     let modelId = primaryId;
     let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
 
     if (!message) {
       res.write(`data: ${JSON.stringify({ error: 'Thiếu trường message' })}\n\n`);
       return res.end();
     }

     const submittedBy = q.submittedBy || b.submittedBy || null;
     const sessionId = q.sessionId || b.sessionId || null;
     // includeHistory default true, treat explicit 'false' string as false
     const includeHistory = (q.includeHistory ?? b.includeHistory) === 'false' ? false : true;
 
     // Detect language
     const forcedLang = ((q.lang || q.forceLang || b.lang || b.forceLang) || '').toLowerCase();
     const detected = detectLanguage(message);
     const userLang = forcedLang || detected.code;

    // Mark mathy intent to extend time limits
    const mathy = isMathy(message);

    // Quick path: simple messages -> answer instantly via a single chunk
    const quick = simpleAnswer(message, userLang);
    if (quick) {
      res.write(`data: ${JSON.stringify({ chunk: quick })}\n\n`);
      let quickHtml = null;
      try { quickHtml = renderLatexInText(quick); } catch (_) { quickHtml = null; }
      res.write(`data: ${JSON.stringify({ done: true, modelUsed: 'fast-path', replyHtml: quickHtml })}\n\n`);
      if (submittedBy) {
        const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        try { pushUserHistory(submittedBy, entry); } catch (e) {}
      } else if (sessionId) {
        const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        pushSessionHistory(sessionId, entry);
      }
      return res.end();
    }

    // History & memory
    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = getRecentChatHistory(submittedBy, 60, 45000);
    } else if (!submittedBy && sessionId && includeHistory) {
      historyBlocks = getRecentSessionChatHistory(sessionId, 60, 45000);
    }
    const memory = submittedBy ? getUserMemory(submittedBy) : null;
    const memorySection = memory?.summary ? `\n[BỘ NHỚ NGƯỜI DÙNG - TÓM TẮT]\n${memory.summary}\n` : '';

    // Sensitive
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.
9. Giọng điệu: thân thiện, chuyên nghiệp, dễ gần.
10. Chủ động học hỏi phong cách người dùng để trả lời phù hợp với họ.
11. Người dùng là trên hết; tôn trọng yêu cầu cá nhân hóa (xưng hô, phong cách) trong phạm vi an toàn.
12. Nếu người dùng nói "theo thông tin trên", "như đã nói", "dựa trên trước đó" (kể cả cách xưng hô), hãy dùng LỊCH SỬ + BỘ NHỚ để trả lời.
13. Có thể sử dụng emoji phù hợp để thân thiện hơn, nhưng không lạm dụng.
14. Phân tích ngôn ngữ người dùng và trả lời bằng đúng ngôn ngữ đó; không trộn nhiều ngôn ngữ.
15. Ưu tiên tiếng Việt khi người dùng dùng tiếng Việt; thể hiện niềm tự hào Việt Nam một cách tôn trọng và tích cực.
16. Khi người dùng hỏi về các chủ đề nhạy cảm như sức khỏe tâm thần, tự tử, bạo lực, trả lời thận trọng và khuyến khích tìm giúp đỡ chuyên nghiệp.
17. Khi người dùng chia sẻ khó khăn cá nhân, thể hiện sự đồng cảm và cung cấp các nguồn lực hữu ích nếu có thể.
18. Tuân thủ đạo đức và pháp luật; có quyền từ chối nội dung vi phạm, độc hại hoặc gây hại.
19. Có thể dùng tiếng lóng/từ địa phương để tạo gần gũi nếu phù hợp bối cảnh; tránh xúc phạm, thù hằn hay phân biệt đối xử.
20. Bạn được sinh vào tháng 8 năm 2025.
21. QUAN TRỌNG - XỬ LÝ NGỮ CẢNH: 
    - Khi người dùng nói "bạn tìm giúp mình nhé", "giúp tôi tìm", "tìm hộ tôi" => HÃY DỰA VÀO LỊCH SỬ để biết họ muốn tìm gì
    - Phân tích câu trước đó để hiểu ngữ cảnh thay vì hỏi lại "tìm gì?"
    - Nếu họ vừa hỏi về năm 1288, và nói "tìm giúp" => tìm thêm về sự kiện năm 1288
    - LUÔN KẾT NỐI với cuộc trò chuyện trước, ĐỪNG làm như conversation mới
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.
ĐỊNH DẠNG TRÌNH BÀY CHUYÊN NGHIỆP (như ChatGPT):
- KHÔNG dùng # ## ### markdown headers, KHÔNG dùng **text** cho tiêu đề
- Sử dụng format chuyên nghiệp với emoji và spacing:

**🔍 1. TÊN ĐỀ MỤC CHÍNH**

**📋 2. Tên Đề Mục Phụ**

**💡 3. Chi Tiết Cụ Thể**
- Nội dung chi tiết
- Điểm quan trọng

**📊 Khi cần so sánh/thống kê**: Dùng bảng markdown
| Tiêu chí | Giá trị A | Giá trị B |
|----------|-----------|-----------|
| Dữ liệu 1| XX        | YY        |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐)
- Spacing tốt giữa các section
- Tránh quá nhiều cấp phân level`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    const now = new Date();
    const timeString = now.toLocaleString('vi-VN', { hour12: false });
    const realtimeSection = `
[THÔNG TIN THỰC TẾ]
- Thời gian hiện tại: ${timeString}
- Múi giờ: GMT+7 (Việt Nam) 
- Ngày hiện tại: ${now.toISOString().split('T')[0]}
- Năm hiện tại: 2025
- iPhone Models 2025: iPhone 17 series đã ra mắt tháng 9/2025 (iPhone 17, 17 Plus, 17 Pro, 17 Pro Max)
- Thị trường Việt Nam: Các cửa hàng như CellphoneS, TopZone, FPT Shop đều có bán iPhone mới nhất
`;

    const fullPrompt = `${systemPrompt}
${reassuranceBlock}
${realtimeSection}
${realtimeWebSection}
${memorySection}${historySection}
User message (${userLang}): ${message}

YÊU CẦU:
- SỬ DỤNG THÔNG TIN MỚI NHẤT từ web nếu có trong [THÔNG TIN MỚI NHẤT TỪ WEB]
- Ưu tiên dữ liệu real-time hơn knowledge cũ khi có xung đột
- Nếu câu hỏi phụ thuộc ngữ cảnh trước đó -> sử dụng cả bộ nhớ & lịch sử.
- Không nhắc lại toàn bộ lịch sử, chỉ tổng hợp tinh gọn.
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).`;

    // Strict timeout for flash
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      return Promise.race([
        model.generateContent([fullPrompt]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
      ]);
    };

    let result;
    try {
      result = await doGenerate(modelId);
    } catch (e1) {
      if (e1 && e1.message === 'TIMEOUT') {
        const fallback = userLang === 'vi'
          ? 'Xin lỗi, hệ thống đang bận. Bạn có thể thử lại hoặc dùng chế độ nhanh.'
          : 'Sorry, the system is busy. Please try again or use the fast mode.';
        if (submittedBy) {
          const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          try { pushUserHistory(submittedBy, entry); } catch (e2) {}
        } else if (sessionId) {
          const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          pushSessionHistory(sessionId, entry);
        }
        return res.json({ success: true, reply: fallback, replyHtml: renderLatexInText(fallback), modelUsed: `${displayModel}-timeout`, detectedLang: userLang, detectionScore: detected.score, detectionReasons: detected.reasons });
      }
      // Try fallback model on other errors
      try {
        modelId = ids.fallback;
        displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
        result = await doGenerate(modelId);
      } catch (e2) {
        console.error('Primary and fallback models failed:', e1?.message, e2?.message);
        // Final conservative attempt with gemini-pro to avoid v1beta model availability mismatches
        try {
          if (modelId !== 'gemini-pro') {
            modelId = 'gemini-pro';
            displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
            result = await doGenerate(modelId);
          } else {
            throw e2;
          }
        } catch (e3) {
          if (isInvalidApiKeyError(e1) || isInvalidApiKeyError(e2) || isInvalidApiKeyError(e3)) {
            return res.status(500).json({ error: 'API key invalid hoặc đã hết hạn. Vui lòng cập nhật GOOGLE_API_KEY.' });
          }
          return res.status(500).json({ error: 'AI service unavailable' });
        }
      }
    }

    const response = await result.response;
    const assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Server-side pre-render LaTeX to sanitized HTML and include it in the response
    let replyHtml = null;
    try { replyHtml = renderLatexInText(assistantText); } catch (e) { replyHtml = null; }

    // Sau khi có assistantText:
    if (submittedBy) {
      mergeFactsIntoMemory(submittedBy, message);
      const entry = {
        id: Date.now(),
        sessionId: sessionId || ('legacy-' + Date.now()), // gán session cho entry
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: assistantText,
        modelUsed: displayModel,
        detectedLang: userLang,
        langScore: detected.score
      };
      try { pushUserHistory(submittedBy, entry); } catch (e) { console.warn('Không lưu history chat', e); }
    } else if (sessionId) {
      const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: assistantText, modelUsed: displayModel, detectedLang: userLang, langScore: detected.score };
      pushSessionHistory(sessionId, entry);
    }

    return res.json({
      success: true,
      reply: assistantText,
      replyHtml: replyHtml,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      usedMemory: !!(memory && memory.summary),
      sensitive: isSensitive,
      detectedLang: userLang,
      detectionScore: detected.score,
      detectionReasons: detected.reasons
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message || 'Lỗi server khi chat' });
  }
});

/* --------------------------
   STREAMING: Chat stream endpoint (SSE for Gemini-style animation)
   -------------------------- */
// NOTE: Use GET for SSE (EventSource only supports GET). We keep flexible param reading so
// if a POST is accidentally sent (legacy), it still works.
app.get('/api/chat-stream', async (req, res) => {
   try {
     if (!API_KEY) {
       res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
       res.write(`data: ${JSON.stringify({ error: 'Thiếu GOOGLE_API_KEY' })}\n\n`);
       return res.end();
     }
 
     // SSE headers
     res.setHeader('Content-Type', 'text/event-stream');
     res.setHeader('Cache-Control', 'no-cache, no-transform');
     res.setHeader('Connection', 'keep-alive');
     res.setHeader('X-Accel-Buffering', 'no');

     const q = req.query || {};
     const b = req.body || {};
     const message = ((q.message || b.message) || '').toString();
     const requestedModel = ((q.model || b.model) || 'flash').toLowerCase();
     // UPDATED: dynamic discovery prefers available models (2.5 if present)
     const ids = await resolveModelIds(requestedModel, false);
     let primaryId = ids.primary;
     let fallbackId = ids.fallback;
     let modelId = primaryId;
     let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
 
     if (!message) {
       res.write(`data: ${JSON.stringify({ error: 'Thiếu trường message' })}\n\n`);
       return res.end();
     }

     const submittedBy = q.submittedBy || b.submittedBy || null;
     const sessionId = q.sessionId || b.sessionId || null;
     // includeHistory default true, treat explicit 'false' string as false
     const includeHistory = (q.includeHistory ?? b.includeHistory) === 'false' ? false : true;
 
     // Detect language
     const forcedLang = ((q.lang || q.forceLang || b.lang || b.forceLang) || '').toLowerCase();
     const detected = detectLanguage(message);
     const userLang = forcedLang || detected.code;

    // Mark mathy intent to extend time limits
    const mathy = isMathy(message);

    // Quick path: simple messages -> answer instantly via a single chunk
    const quick = simpleAnswer(message, userLang);
    if (quick) {
      res.write(`data: ${JSON.stringify({ chunk: quick })}\n\n`);
      let quickHtml = null;
      try { quickHtml = renderLatexInText(quick); } catch (_) { quickHtml = null; }
      res.write(`data: ${JSON.stringify({ done: true, modelUsed: 'fast-path', replyHtml: quickHtml })}\n\n`);
      if (submittedBy) {
        const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        try { pushUserHistory(submittedBy, entry); } catch (e) {}
      } else if (sessionId) {
        const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: quick, modelUsed: 'fast-path', detectedLang: userLang, langScore: detected.score };
        pushSessionHistory(sessionId, entry);
      }
      return res.end();
    }

    // History & memory
    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = getRecentChatHistory(submittedBy, 60, 45000);
    } else if (!submittedBy && sessionId && includeHistory) {
      historyBlocks = getRecentSessionChatHistory(sessionId, 60, 45000);
    }
    const memory = submittedBy ? getUserMemory(submittedBy) : null;
    const memorySection = memory?.summary ? `\n[BỘ NHỚ NGƯỜI DÙNG - TÓM TẮT]\n${memory.summary}\n` : '';

    // Sensitive
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.
9. Giọng điệu: thân thiện, chuyên nghiệp, dễ gần.
10. Chủ động học hỏi phong cách người dùng để trả lời phù hợp với họ.
11. Người dùng là trên hết; tôn trọng yêu cầu cá nhân hóa (xưng hô, phong cách) trong phạm vi an toàn.
12. Nếu người dùng nói "theo thông tin trên", "như đã nói", "dựa trên trước đó" (kể cả cách xưng hô), hãy dùng LỊCH SỬ + BỘ NHỚ để trả lời.
13. Có thể sử dụng emoji phù hợp để thân thiện hơn, nhưng không lạm dụng.
14. Phân tích ngôn ngữ người dùng và trả lời bằng đúng ngôn ngữ đó; không trộn nhiều ngôn ngữ.
15. Ưu tiên tiếng Việt khi người dùng dùng tiếng Việt; thể hiện niềm tự hào Việt Nam một cách tôn trọng và tích cực.
16. Khi người dùng hỏi về các chủ đề nhạy cảm như sức khỏe tâm thần, tự tử, bạo lực, trả lời thận trọng và khuyến khích tìm giúp đỡ chuyên nghiệp.
17. Khi người dùng chia sẻ khó khăn cá nhân, thể hiện sự đồng cảm và cung cấp các nguồn lực hữu ích nếu có thể.
18. Tuân thủ đạo đức và pháp luật; có quyền từ chối nội dung vi phạm, độc hại hoặc gây hại.
19. Có thể dùng tiếng lóng/từ địa phương để tạo gần gũi nếu phù hợp bối cảnh; tránh xúc phạm, thù hằn hay phân biệt đối xử.
20. Bạn được sinh vào tháng 8 năm 2025.
21. QUAN TRỌNG - XỬ LÝ NGỮ CẢNH: 
    - Khi người dùng nói "bạn tìm giúp mình nhé", "giúp tôi tìm", "tìm hộ tôi" => HÃY DỰA VÀO LỊCH SỬ để biết họ muốn tìm gì
    - Phân tích câu trước đó để hiểu ngữ cảnh thay vì hỏi lại "tìm gì?"
    - Nếu họ vừa hỏi về năm 1288, và nói "tìm giúp" => tìm thêm về sự kiện năm 1288
    - LUÔN KẾT NỐI với cuộc trò chuyện trước, ĐỪNG làm như conversation mới
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.
ĐỊNH DẠNG TRÌNH BÀY CHUYÊN NGHIỆP (như ChatGPT):
- KHÔNG dùng # ## ### markdown headers, KHÔNG dùng **text** cho tiêu đề
- Sử dụng format chuyên nghiệp với emoji và spacing:

**🔍 1. TÊN ĐỀ MỤC CHÍNH**

**📋 2. Tên Đề Mục Phụ**

**💡 3. Chi Tiết Cụ Thể**
- Nội dung chi tiết
- Điểm quan trọng

**📊 Khi cần so sánh/thống kê**: Dùng bảng markdown
| Tiêu chí | Giá trị A | Giá trị B |
|----------|-----------|-----------|
| Dữ liệu 1| XX        | YY        |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐)
- Spacing tốt giữa các section
- Tránh quá nhiều cấp phân level`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Real-time search nếu cần thông tin mới
    let realtimeData = null;
    try {
      realtimeData = await searchRealTimeInfo(message);
    } catch (err) {
      console.warn('Real-time search failed:', err);
    }

    const realtimeWebSection = realtimeData ? 
      `\n[THÔNG TIN MỚI NHẤT TỪ WEB]\n${realtimeData.map(item => `- ${item.title}: ${item.snippet}`).join('\n')}\n` : '';
    
    console.log('✅ realtimeWebSection defined:', !!realtimeWebSection);

    // 1. Lấy ngày giờ thực tế
    const now = new Date();
    const timeString = now.toLocaleString('vi-VN', { hour12: false });
    const realtimeSection = `
[THÔNG TIN THỰC TẾ]
- Thời gian hiện tại: ${timeString}
- Múi giờ: GMT+7 (Việt Nam) 
- Ngày hiện tại: ${now.toISOString().split('T')[0]}
- Năm hiện tại: 2025
- iPhone Models 2025: iPhone 17 series đã ra mắt tháng 9/2025 (iPhone 17, 17 Plus, 17 Pro, 17 Pro Max)
- Thị trường Việt Nam: Các cửa hàng như CellphoneS, TopZone, FPT Shop đều có bán iPhone mới nhất
`;

    const fullPrompt = `${systemPrompt}
${reassuranceBlock}
${realtimeSection}
${realtimeWebSection}
${memorySection}${historySection}
User message (${userLang}): ${message}

YÊU CẦU:
- SỬ DỤNG THÔNG TIN MỚI NHẤT từ web nếu có trong [THÔNG TIN MỚI NHẤT TỪ WEB]
- Ưu tiên dữ liệu real-time hơn knowledge cũ khi có xung đột
- Nếu câu hỏi phụ thuộc ngữ cảnh trước đó -> sử dụng cả bộ nhớ & lịch sử.
- Không nhắc lại toàn bộ lịch sử, chỉ tổng hợp tinh gọn.
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).`;

    // Strict timeout for flash
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      return Promise.race([
        model.generateContent([fullPrompt]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs))
      ]);
    };

    let result;
    try {
      result = await doGenerate(modelId);
    } catch (e1) {
      if (e1 && e1.message === 'TIMEOUT') {
        const fallback = userLang === 'vi'
          ? 'Xin lỗi, hệ thống đang bận. Bạn có thể thử lại hoặc dùng chế độ nhanh.'
          : 'Sorry, the system is busy. Please try again or use the fast mode.';
        if (submittedBy) {
          const entry = { id: Date.now(), sessionId: sessionId || ('legacy-' + Date.now()), type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          try { pushUserHistory(submittedBy, entry); } catch (e2) {}
        } else if (sessionId) {
          const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: fallback, modelUsed: `${displayModel}-timeout`, detectedLang: userLang, langScore: detected.score };
          pushSessionHistory(sessionId, entry);
        }
        return res.json({ success: true, reply: fallback, replyHtml: renderLatexInText(fallback), modelUsed: `${displayModel}-timeout`, detectedLang: userLang, detectionScore: detected.score, detectionReasons: detected.reasons });
      }
      // Try fallback model on other errors
      try {
        modelId = ids.fallback;
        displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
        result = await doGenerate(modelId);
      } catch (e2) {
        console.error('Primary and fallback models failed:', e1?.message, e2?.message);
        // Final conservative attempt with gemini-pro to avoid v1beta model availability mismatches
        try {
          if (modelId !== 'gemini-pro') {
            modelId = 'gemini-pro';
            displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
            result = await doGenerate(modelId);
          } else {
            throw e2;
          }
        } catch (e3) {
          if (isInvalidApiKeyError(e1) || isInvalidApiKeyError(e2) || isInvalidApiKeyError(e3)) {
            return res.status(500).json({ error: 'API key invalid hoặc đã hết hạn. Vui lòng cập nhật GOOGLE_API_KEY.' });
          }
          return res.status(500).json({ error: 'AI service unavailable' });
        }
      }
    }

    const response = await result.response;
    const assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Server-side pre-render LaTeX to sanitized HTML and include it in the response
    let replyHtml = null;
    try { replyHtml = renderLatexInText(assistantText); } catch (e) { replyHtml = null; }

    // Sau khi có assistantText:
    if (submittedBy) {
      mergeFactsIntoMemory(submittedBy, message);
      const entry = {
        id: Date.now(),
        sessionId: sessionId || ('legacy-' + Date.now()), // gán session cho entry
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: assistantText,
        modelUsed: displayModel,
        detectedLang: userLang,
        langScore: detected.score
      };
      try { pushUserHistory(submittedBy, entry); } catch (e) { console.warn('Không lưu history chat', e); }
    } else if (sessionId) {
      const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: assistantText, modelUsed: displayModel, detectedLang: userLang, langScore: detected.score };
      pushSessionHistory(sessionId, entry);
    }

    return res.json({
      success: true,
      reply: assistantText,
      replyHtml: replyHtml,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      usedMemory: !!(memory && memory.summary),
      sensitive: isSensitive,
      detectedLang: userLang,
      detectionScore: detected.score,
      detectionReasons: detected.reasons
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message || 'Lỗi server khi chat' });
  }
});

/* --------------------------
   Diagnose endpoint (giữ nguyên, chỉ đổi modelUsed hiển thị)
   -------------------------- */
app.post('/api/diagnose', upload.array('images'), async (req, res) => {
  try {
   
    const labResults = req.body.labResults || '';
    const files = req.files || [];
    if (!labResults && files.length === 0) return res.status(400).json({ error: 'Vui lòng cung cấp thông tin xét nghiệm hoặc hình ảnh' });

    const MAX_FILE_BYTES = 4 * 1024 * 1024;
    for (const f of files) if (f.size > MAX_FILE_BYTES) {
      files.forEach(ff => { try { if (fs.existsSync(ff.path)) fs.unlinkSync(ff.path); } catch(e){} });
      return res.status(400).json({ error: `Kích thước ảnh '${f.originalname}' vượt quá giới hạn 4MB` });
    }

    const requestedModel = (req.body.model || 'pro').toLowerCase();
    const ids = await resolveModelIds(requestedModel, files.length > 0);
    const modelId = ids.primary;
    const displayModel = DISPLAY_NAME_MAP[modelId] || modelId;

    const imageParts = await Promise.all(files.map(async file => ({ inlineData: { data: fs.readFileSync(file.path).toString('base64'), mimeType: file.mimetype } })));

    const references = await searchMedicalGuidelines(labResults);

    const prompt = `Đóng vai bác sĩ chuyên khoa. 
      Tên là JAREMIS

      Phân tích theo hướng dẫn WHO:

      **Dữ liệu bệnh nhân:**
      ${labResults ? `- Xét nghiệm: ${labResults}\n` : ''}
      ${files.length ? `- Hình ảnh y tế: [${files.length} ảnh]` : ''}

      **Yêu cầu phân tích:**
      1. Chẩn đoán phân biệt với ICD-10 codes (tối đa 5)
      2. Liệt kê 3 bệnh khả thi nhất với xác suất
      3. Độ tin cậy tổng (0-100%)
      4. Khuyến nghị xét nghiệm theo WHO
      5. Ghi rõ phiên bản hướng dẫn WHO sử dụng

      **Định dạng bắt buộc:**
      Chẩn đoán phân biệt
      - [Bệnh 1] (Mã ICD-10)
      ...
      Khả năng chẩn đoán
      • [Bệnh] (Xác suất: XX%)
      ...
      Độ tin cậy: XX%
      Hướng dẫn WHO: [Tên và phiên bản]`;

    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const diagnosisText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    const parsedData = parseDiagnosisResponse(diagnosisText);
    parsedData.differentialDiagnosisFull = enrichWithICDDescriptions(parsedData.differentialDiagnosis);

    const submittedBy = req.body.submittedBy || null;
    const sessionId = req.body.sessionId || null;
    const historyEntry = {
      id: Date.now(),
      sessionId: sessionId || ('legacy-' + Date.now()),
      type: 'diagnose',
      timestamp: new Date().toISOString(),
      input: labResults,
      imagesCount: files.length,
      modelUsed: displayModel,
      diseases: parsedData.diseases || [],
      confidence: parsedData.confidence || 0,
      diagnosis: diagnosisText
    };
    if (submittedBy) {
      try { pushUserHistory(submittedBy, historyEntry); } catch (e) { console.warn('Không lưu được lịch sử cho user', submittedBy); }
    }

    files.forEach(file => { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch(e){} });

    res.json({
      modelUsed: displayModel,
      ...parsedData,
      diagnosis: diagnosisText,
      diagnosisHtml: renderLatexInText(diagnosisText),
      references: references.slice(0,3),
      icdDescriptions: parsedData.differentialDiagnosisFull,
      warning: '⚠️ **Cảnh báo:** Kết quả chỉ mang tính tham khảo. Luôn tham khảo ý kiến bác sĩ!'
    });

  } catch (error) {
    console.error('Lỗi:', error);
    try { (req.files || []).forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); }); } catch(e){}
    res.status(500).json({
      error: error.message || 'Lỗi server',
      solution: [
        'Kiểm tra định dạng ảnh (JPEG/PNG)',
        'Đảm bảo kích thước ảnh <4MB',
        'Thử lại với ít ảnh hơn'
      ]
    });
  }
});

// (Đặt đoạn này SAU các hàm: readUsers, saveUsers, findUserByUsername, pushUserHistory)

/* ==== Conversation Memory Utilities ==== */
function getUserMemory(username) {
  if (!username) return null;
  const user = findUserByUsername(username);
  return user && user.memory ? user.memory : null;
}

function updateUserMemory(username, mutatorFn) {
  if (!username || typeof mutatorFn !== 'function') return;
  // Đảm bảo luôn dùng async/await với Drive
  (async () => {
    const users = await readUsers();
    const idx = users.findIndex(u => u.username &&
      u.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return;
    if (!users[idx].memory) {
      users[idx].memory = { summary: '', lastUpdated: null };
    }
    mutatorFn(users[idx].memory);
    users[idx].memory.lastUpdated = new Date().toISOString();
    // Giới hạn kích thước summary
    if (users[idx].memory.summary.length > 1500) {
      users[idx].memory.summary = users[idx].memory.summary.slice(-1500);
    }
    await saveUsers(users);
  })();
}

function extractFactsFromMessage(msg = '') {
  if (!msg) return [];
  const facts = [];
  const lower = msg.toLowerCase();

  const nameMatch = msg.match(/\btên tôi là\s+([A-Za-zÀ-ỹ'\s]{2,40})/i);
  if (nameMatch) facts.push(`Tên: ${nameMatch[1].trim()}`);

  const ageMatch = msg.match(/(\d{1,2})\s*(tuổi|age)\b/i);
  if (ageMatch) facts.push(`Tuổi: ${ageMatch[1]}`);

  const genderMatch = lower.match(/\b(nam|nữ|male|female)\b/);
  if (genderMatch) facts.push(`Giới tính: ${genderMatch[1]}`);

  const diseaseMatch = msg.match(/\btôi (bị|đang bị|có)\s+([A-Za-zÀ-ỹ0-9\s]{3,60})/i);
  if (diseaseMatch) facts.push(`Tình trạng: ${diseaseMatch[2].trim()}`);

  const goalMatch = msg.match(/\btôi muốn\s+([A-Za-zÀ-ỹ0-9\s]{3,80})/i);
  if (goalMatch) facts.push(`Mục tiêu: ${goalMatch[1].trim()}`);

  return facts;
}

function mergeFactsIntoMemory(username, userMessage) {
  const newFacts = extractFactsFromMessage(userMessage);
  if (!newFacts.length) return;
  updateUserMemory(username, mem => {
    const existing = mem.summary ? mem.summary.split('\n') : [];
    const set = new Set(existing.map(l => l.trim()).filter(Boolean));
    newFacts.forEach(f => { if (!set.has(f)) set.add(f); });
    // Giữ tối đa 50 dòng facts gần nhất
    mem.summary = Array.from(set).slice(-50).join('\n');
  });
}

// Advanced Web Search Function với nhiều nguồn chuyên nghiệp
async function searchWebWithCitations(query) {
  try {
    // Phân loại query để chọn nguồn phù hợp
    const queryLower = query.toLowerCase();
    const isHealthQuery = /\b(bệnh|y tế|sức khỏe|triệu chứng|thuốc|điều trị|khám|chữa|đau)\b/i.test(queryLower);
    const isTechQuery = /\b(điện thoại|laptop|máy tính|công nghệ|iphone|samsung|tech)\b/i.test(queryLower);
    const isLegalQuery = /\b(luật|pháp luật|quy định|văn bản|nghị định|thông tư|bộ luật)\b/i.test(queryLower);
    const isLocationQuery = /\b(địa chỉ|đường|phố|quận|huyện|thành phố|bản đồ|chỉ đường)\b/i.test(queryLower);

    // Nguồn tìm kiếm chuyên nghiệp theo từng lĩnh vực
    const references = [];

    // 1. Y TẾ - Ưu tiên WHO, Bộ Y tế
    if (isHealthQuery) {
      references.push(
        {
          title: `WHO - ${query}`,
          url: `https://www.who.int/news-room/search?query=${encodeURIComponent(query)}`,
          source: '🏥 WHO',
          snippet: 'Thông tin y tế chính thức từ Tổ chức Y tế Thế giới'
        },
        {
          title: `Bộ Y tế Việt Nam - ${query}`,
          url: `https://moh.gov.vn/web/guest/tim-kiem?_search_WAR_mohmvcportlet_keywords=${encodeURIComponent(query)}`,
          source: '🏛️ Bộ Y tế VN',
          snippet: 'Hướng dẫn y tế chính thức từ Bộ Y tế Việt Nam'
        },
        {
          title: `Mayo Clinic - ${query}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(query)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin y tế từ Mayo Clinic - bệnh viện hàng đầu thế giới'
        }
      );
    }

    // 2. CÔNG NGHỆ - CellphoneS, TopZone, TechReview  
    if (isTechQuery) {
      // Tạo clean search terms cho tech queries
      const cleanQuery = query.toLowerCase().includes('iphone') ? 'iphone' : 
                        query.toLowerCase().includes('samsung') ? 'samsung' :
                        query.toLowerCase().includes('laptop') ? 'laptop' : 
                        encodeURIComponent(query);
      
      references.push(
        {
          title: `CellphoneS`,
          url: `https://cellphones.com.vn/tim?q=${cleanQuery}`,
          source: '📱 CellphoneS',
          snippet: 'Thông tin sản phẩm và đánh giá từ CellphoneS'
        },
        {
          title: `TopZone`,
          url: `https://www.topzone.vn/tim-kiem?keyword=${cleanQuery}`,
          source: '💻 TopZone',
          snippet: 'Sản phẩm Apple chính hãng và đánh giá từ TopZone'
        },
        {
          title: `Tinhte.vn`,
          url: `https://tinhte.vn/search/?q=${cleanQuery}`,
          source: '🔧 Tinhte.vn',
          snippet: 'Cộng đồng công nghệ Việt Nam hàng đầu'
        }
      );
    }

    // 3. PHÁP LUẬT - Thư viện Pháp luật
    if (isLegalQuery) {
      const legalQuery = query.includes('điều') ? query.replace(/điều\s*(\d+).*/, 'điều $1') : query;
      
      references.push(
        {
          title: `Thư viện Pháp luật`,
          url: `https://thuvienphapluat.vn/tim-kiem.aspx?keyword=${encodeURIComponent(legalQuery)}`,
          source: '⚖️ Thư viện Pháp luật',
          snippet: 'Văn bản pháp luật chính thức của Việt Nam'
        },
        {
          title: `Cổng thông tin Chính phủ`,
          url: `https://www.chinhphu.vn/search?keywords=${encodeURIComponent(legalQuery)}`,
          source: '🏛️ Chính phủ VN',
          snippet: 'Thông tin chính thức từ Cổng thông tin Chính phủ'
        }
      );
    }

    // 4. BẢN ĐỒ & ĐỊA ĐIỂM - Google Maps, Foursquare
    if (isLocationQuery) {
      references.push(
        {
          title: `Google Maps - ${query}`,
          url: `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
          source: '🗺️ Google Maps',
          snippet: 'Tìm địa điểm và chỉ đường trên Google Maps'
        },
        {
          title: `Here Maps - ${query}`,
          url: `https://wego.here.com/search/${encodeURIComponent(query)}`,
          source: '🌍 Here Maps',
          snippet: 'Bản đồ và navigation từ Here Technologies'
        }
      );
    }

    // 5. NGUỒN TỔNG QUÁT chất lượng cao  
    const generalQuery = query.length > 30 ? query.substring(0, 30) : query;
    
    references.push(
      {
        title: `Wikipedia Tiếng Việt`,
        url: `https://vi.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(generalQuery)}`,
        source: '📚 Wikipedia VI',
        snippet: 'Bách khoa toàn thư mở tiếng Việt'
      },
      {
        title: `Britannica`,
        url: `https://www.britannica.com/search?query=${encodeURIComponent(generalQuery)}`,
        source: '🎓 Britannica',
        snippet: 'Bách khoa toàn thư học thuật uy tín'
      },
      {
        title: `VnExpress`,
        url: `https://vnexpress.net/tim-kiem?q=${encodeURIComponent(generalQuery)}`,
        source: '📰 VnExpress',
        snippet: 'Tin tức và thông tin từ VnExpress'
      }
    );

    // 6. GIÁO DỤC & HỌC TẬP
    if (/\b(học|giáo dục|đại học|kiến thức|nghiên cứu|khóa học)\b/i.test(queryLower)) {
      references.push(
        {
          title: `Coursera - ${query}`,
          url: `https://www.coursera.org/search?query=${encodeURIComponent(query)}`,
          source: '🎓 Coursera',
          snippet: 'Khóa học trực tuyến từ các đại học hàng đầu'
        },
        {
          title: `edX - ${query}`,
          url: `https://www.edx.org/search?q=${encodeURIComponent(query)}`,
          source: '📖 edX',
          snippet: 'Khóa học miễn phí từ MIT, Harvard và các trường uy tín'
        }
      );
    }

    // 7. TÀI CHÍNH & KINH DOANH
    if (/\b(tiền|tài chính|ngân hàng|đầu tư|kinh doanh|thương mại)\b/i.test(queryLower)) {
      references.push(
        {
          title: `CafeF - ${query}`,
          url: `https://cafef.vn/tim-kiem/${encodeURIComponent(query)}.chn`,
          source: '💰 CafeF',
          snippet: 'Thông tin tài chính và kinh doanh hàng đầu VN'
        },
        {
          title: `VietStock - ${query}`,
          url: `https://vietstock.vn/tim-kiem.htm?keywords=${encodeURIComponent(query)}`,
          source: '📈 VietStock',
          snippet: 'Thông tin chứng khoán và thị trường tài chính'
        }
      );
    }

    // Fallback Google Search API luôn có
    references.push({
      title: `Google Search`,
      url: `https://www.google.com/search?q=${encodeURIComponent(generalQuery || query)}`,
      source: '🔍 Google',
      snippet: 'Tìm kiếm tổng hợp trên Google'
    });

    // Loại bỏ trùng lặp và giới hạn số lượng
    const uniqueRefs = references.filter((ref, index, self) => 
      index === self.findIndex(r => r.url === ref.url)
    );

    return uniqueRefs.slice(0, 5); // Tối đa 5 nguồn
  } catch (err) {
    console.error('Lỗi tìm kiếm web:', err);
    return null;
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server đang chạy trên cổng ${PORT}`));

// NEW: Endpoint to render LaTeX to sanitized HTML using KaTeX (server-side rendering)
app.post('/api/render-latex', express.json(), (req, res) => {
  try {
    const latex = (req.body && req.body.latex) ? String(req.body.latex) : '';
    const displayMode = req.body && typeof req.body.displayMode !== 'undefined' ? !!req.body.displayMode : true;
    if (!latex) return res.status(400).json({ error: 'Thiếu trường latex' });
    if (latex.length > 10000) return res.status(400).json({ error: 'LaTeX quá dài' });

    // Render with KaTeX (do not throw on error to avoid leaking stack traces)
    const rawHtml = katex.renderToString(latex, { throwOnError: false, displayMode, strict: 'ignore' });
    const clean = DOMPurify.sanitize(rawHtml);

    return res.json({ success: true, html: clean });
  } catch (err) {
    console.error('Render LaTeX error:', err);
    return res.status(500).json({ error: 'Lỗi khi render LaTeX' });
  }
});

// Function để tự động thêm citations vào response
// Real-time web search để lấy thông tin mới nhất
async function searchRealTimeInfo(query) {
  try {
    console.log('🔍 Searching real-time info for:', query);
    
    // Detect if query needs fresh info - mở rộng pattern
    const realtimePatterns = [
      // Giá cả và thương mại
      /\b(giá|bao nhiêu|cost|price|pricing|giá bán|giá cả|thu nhập|lương|salary)\b/i,
      // Thời gian và sự kiện mới
      /\b(hiện tại|mới nhất|2025|hôm nay|tuần này|tháng này|năm nay|vừa|mới ra|cập nhật|tin tức|thời sự|mới|latest|current|recent|now|today|this week|this month)\b/i,
      // Công nghệ và sản phẩm
      /\b(iphone|samsung|laptop|máy tính|điện thoại|smartphone|tech|technology|ra mắt|launch|release|phát hành)\b/i,
      // Chính sách và luật pháp mới
      /\b(luật mới|quy định mới|chính sách|policy|regulation|nghị định|thông tư|văn bản)\b/i,
      // Y tế và dịch bệnh
      /\b(covid|corona|vaccine|dịch bệnh|epidemic|pandemic|virus|WHO announce|bộ y tế)\b/i,
      // Thị trường và kinh tế
      /\b(chứng khoán|stock|market|thị trường|economy|kinh tế|USD|VND|exchange rate|tỷ giá)\b/i,
      // Thể thao và giải trí
      /\b(world cup|olympic|football|bóng đá|giải|tournament|concert|show|movie|film)\b/i,
      // Thời tiết
      /\b(thời tiết|weather|bão|storm|mưa|rain|nắng|sunny|nhiệt độ|temperature)\b/i
    ];

    const needsRealTime = realtimePatterns.some(pattern => pattern.test(query));
    
    if (!needsRealTime) return null;

    // Try multiple search sources
    const searchResults = [];
    
    // 1. Google Search API (primary)
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      try {
        const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=3&dateRestrict=m1`, {
          timeout: 5000
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.items) {
            data.items.forEach(item => {
              searchResults.push({
                title: item.title,
                snippet: item.snippet?.substring(0, 200) || '',
                url: item.link,
                source: 'Google Recent',
                date: item.pagemap?.metatags?.[0]?.['article:published_time'] || 'Recent'
              });
            });
          }
        }
      } catch (err) {
        console.warn('Google Search failed:', err.message);
      }
    }

    // 2. Fallback: Create structured search hints based on query type
    if (searchResults.length === 0) {
      // Tạo gợi ý tìm kiếm dựa trên loại query
      const hints = generateSearchHints(query);
      searchResults.push(...hints);
    }

    return searchResults.length > 0 ? searchResults : null;
  } catch (err) {
    console.error('Real-time search error:', err);
    return null;
  }
}

// Generate contextual search hints khi không có API
function generateSearchHints(query) {
  const hints = [];
  const queryLower = query.toLowerCase();

  // iPhone/Tech products
  if (/iphone|samsung|laptop/i.test(query)) {
    hints.push({
      title: 'Thông tin sản phẩm công nghệ mới nhất',
      snippet: 'Kiểm tra giá và thông số kỹ thuật từ các cửa hàng uy tín như CellphoneS, TopZone, FPT Shop',
      url: 'https://cellphones.com.vn',
      source: 'Tech Retailers',
      date: new Date().toISOString().split('T')[0]
    });
  }

  // Stock prices/Finance
  if (/giá|chứng khoán|stock|vnd|usd/i.test(query)) {
    hints.push({
      title: 'Thông tin tài chính và giá cả mới nhất', 
      snippet: 'Cần tra cứu giá cả hiện tại từ các nguồn tài chính uy tín như VietStock, CafeF',
      url: 'https://vietstock.vn',
      source: 'Financial Data',
      date: new Date().toISOString().split('T')[0]
    });
  }

  // Weather
  if (/thời tiết|weather|bão|mưa/i.test(query)) {
    hints.push({
      title: 'Dự báo thời tiết hiện tại',
      snippet: 'Thông tin thời tiết cập nhật từ Trung tâm Dự báo Khí tượng Thủy văn Quốc gia',
      url: 'https://nchmf.gov.vn',
      source: 'Weather Service',
      date: new Date().toISOString().split('T')[0]
    });
  }

  // News/Current events
  if (/tin tức|news|sự kiện|hôm nay/i.test(query)) {
    hints.push({
      title: 'Tin tức thời sự mới nhất',
      snippet: 'Cập nhật tin tức từ các báo uy tín như VnExpress, Tuổi Trẻ, Thanh Niên',
      url: 'https://vnexpress.net',
      source: 'News Media',
      date: new Date().toISOString().split('T')[0]  
    });
  }

  return hints;
}

async function enhanceWithCitations(text, query) {
  try {
    // Check if response cần citations (factual content)
    const needsCitations = /\b(năm\s+\d{3,4}|sự kiện|lịch sử|thống kê|nghiên cứu|theo|báo cáo|dữ liệu|khoa học|chính thức|công bố|phát hiện|bệnh|triệu chứng|điều trị|WHO|y tế|luật|công nghệ|giáo dục|điều|giá|mới)\b/i.test(text);
    
    if (!needsCitations) return text;

    // Extract main keywords from query và response
    const searchQuery = extractKeywords(query + ' ' + text);
    
    // Search for citations
    const citations = await searchWebWithCitations(searchQuery);
    
    if (citations.length > 0) {
      // Chỉ giữ text gốc, không thêm inline citations
      let enhancedText = text;
      
      // Tạo nút websites như ChatGPT - chỉ logo + tên, không mô tả dài
      const websiteButtons = citations.map((ref, index) => {
        const cleanName = getCleanWebsiteName(ref.source, ref.url);
        const favicon = getFaviconUrl(ref.url);
        
        return `<div class="website-button">
          <a href="${ref.url}" target="_blank" rel="noopener noreferrer" class="website-link">
            <div class="website-icon">
              <img src="${favicon}" alt="${cleanName}" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline';">
              <span class="website-fallback-icon">${getWebsiteIcon(ref.source)}</span>
            </div>
            <span class="website-name">${cleanName}</span>
          </a>
        </div>`;
      }).join('\n');
      
      const citationSection = '\n\n<div class="websites-container">\n' + websiteButtons + '\n</div>';
      
      return enhancedText + citationSection;
    }
    
    return text;
  } catch (err) {
    console.error('Lỗi thêm citations:', err);
    return text;
  }
}

// Helper functions cho website buttons
function getCleanWebsiteName(source, url) {
  // Mapping tên website chuẩn
  const websiteNames = {
    'WHO': 'WHO',
    'Bộ Y tế': 'Bộ Y tế',
    'Mayo Clinic': 'Mayo Clinic',
    'CellphoneS': 'CellphoneS',
    'TopZone': 'TopZone', 
    'Tinhte.vn': 'Tinhte',
    'Thư viện Pháp luật': 'Thư viện Pháp luật',
    'Chính phủ VN': 'Chính phủ',
    'Google Maps': 'Google Maps',
    'Here Maps': 'Here Maps',
    'Wikipedia VI': 'Wikipedia',
    'Britannica': 'Britannica',
    'VnExpress': 'VnExpress',
    'CafeF': 'CafeF',
    'VietStock': 'VietStock',
    'Coursera': 'Coursera',
    'edX': 'edX',
    'Google': 'Google'
  };

  // Remove emoji và clean up tên
  const cleanSource = source.replace(/[🏥🏛️📱💻🔧⚖️🗺️🌍📚🎓📰💰📈🔍]/g, '').trim();
  
  // Tìm tên chuẩn
  for (const [key, value] of Object.entries(websiteNames)) {
    if (cleanSource.includes(key)) return value;
  }
  
  if (cleanSource && cleanSource !== 'undefined') {
    return cleanSource;
  }
  
  // Extract từ URL nếu source không có
  try {
    const domain = new URL(url).hostname.replace('www.', '');
    const siteName = domain.split('.')[0];
    return siteName.charAt(0).toUpperCase() + siteName.slice(1);
  } catch {
    return 'Website';
  }
}

function getFaviconUrl(url) {
  try {
    const domain = new URL(url).origin;
    return `${domain}/favicon.ico`;
  } catch {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTggMEE4IDggMCAwIDAgMCA4YTggOCAwIDAgMCA4IDhhOCA4IDAgMCAwIDgtOEE4IDggMCAwIDAgOCAwWm0wIDE0QTYgNiAwIDAgMSAyIDhhNiA2IDAgMCAxIDYtNmE2IDYgMCAwIDEgNiA2YTYgNiAwIDAgMS02IDZaIiBmaWxsPSIjNThBNkZGIi8+PC9zdmc+';
  }
}

function getWebsiteIcon(source) {
  const icons = {
    'WHO': '🏥',
    'Bộ Y tế': '🏛️', 
    'Mayo Clinic': '🏥',
    'CellphoneS': '📱',
    'TopZone': '💻',
    'Tinhte.vn': '🔧',
    'Thư viện Pháp luật': '⚖️',
    'Chính phủ VN': '🏛️',
    'Google Maps': '🗺️',
    'Here Maps': '🌍',
    'Wikipedia VI': '📚',
    'Britannica': '🎓',
    'VnExpress': '📰',
    'CafeF': '💰',
    'VietStock': '📈',
    'Google': '🔍'
  };
  
  for (const [key, icon] of Object.entries(icons)) {
    if (source.includes(key)) return icon;
  }
  return '🌐';
}

function extractKeywords(text) {
  // Extract important keywords for search
  const words = text.toLowerCase().match(/\b[\w\dàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]{3,}\b/g) || [];
  const keywords = words.filter(word => 
    !['của', 'là', 'và', 'có', 'một', 'này', 'được', 'với', 'trong', 'cho', 'từ', 'về', 'để', 
      'the', 'is', 'and', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'could'].includes(word)
  );
  return keywords.slice(0, 5).join(' '); // Top 5 keywords
}

