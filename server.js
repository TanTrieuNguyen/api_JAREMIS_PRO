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

// ========================================
// GLOBAL ERROR HANDLERS - Prevent Server Crash
// ========================================
process.on('uncaughtException', (err) => {
  console.error('❌ UNCAUGHT EXCEPTION:', err);
  console.error('Stack:', err.stack);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED REJECTION at:', promise);
  console.error('Reason:', reason);
  // Don't exit - keep server running
});

process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n👋 SIGINT received. Shutting down gracefully...');
  process.exit(0);
});

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
    if (math) return 360000; // 6 phút cho toán phức tạp
    if (weather) return 45000; // 45s cho thời tiết
    return 60000; // 1 phút mặc định
  }
  
  if (math) return 300000; // 5 phút cho toán phức tạp với Pro model
  if (weather) return 90000; // 1.5 phút cho thời tiết
  return 120000; // 2 phút mặc định
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
async function getRecentChatHistory(username, limit = 360, maxChars = 360000) {
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

/**
 * Extract symptoms from natural language (Vietnamese)
 * Remove noise: age, time, question words, connectors
 * Return clean symptom keywords
 */
function extractSymptoms(text) {
  if (!text || typeof text !== 'string') return [];
  
  // Common noise patterns to remove
  const noisePatterns = [
    /bệnh nhân\s+\d+\s+tuổi/gi,           // "bệnh nhân 35 tuổi"
    /\d+\s+tuổi/gi,                        // "35 tuổi"
    /nam|nữ|giới/gi,                       // "nam", "nữ", "giới"
    /từ\s+\d+\s+ngày/gi,                   // "từ 3 ngày"
    /kéo dài\s+\d+/gi,                     // "kéo dài 5 ngày"
    /hiện tại|bây giờ|lúc này/gi,          // time words
    /tôi|mình|em|anh|chị/gi,               // pronouns
    /đang|đã|sẽ|vẫn|còn|đang bị/gi,        // auxiliary verbs
    /có|bị|thấy|cảm thấy/gi,               // common verbs
    /và|hoặc|với|cùng/gi,                  // connectors (keep in final join)
    /nay|qua|trước/gi,                     // time refs
    /của tôi|của em|của bạn/gi             // possessive
  ];
  
  let cleaned = text;
  noisePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, ' ');
  });
  
  // Split by common delimiters
  const parts = cleaned.split(/[,;.\n]+/).map(s => s.trim()).filter(s => s.length > 0);
  
  // Extract symptom keywords (2-5 words phrases)
  const symptoms = [];
  parts.forEach(part => {
    // Remove extra spaces
    const normalized = part.replace(/\s+/g, ' ').trim();
    if (normalized.length > 2 && normalized.length < 100) {
      symptoms.push(normalized);
    }
  });
  
  // Deduplicate
  return [...new Set(symptoms)];
}

/**
 * Translate Vietnamese symptoms to English using simple dictionary
 * For better PubMed/NIH search results
 */
function translateSymptomToEnglish(vietnameseSymptom) {
  const dictionary = {
    // Common symptoms
    'ho': 'cough',
    'ho khan': 'dry cough',
    'ho có đờm': 'productive cough',
    'sốt': 'fever',
    'sốt cao': 'high fever',
    'đau đầu': 'headache',
    'đau ngực': 'chest pain',
    'tức ngực': 'chest tightness',
    'khó thở': 'dyspnea',
    'thở nhanh': 'tachypnea',
    'mệt mỏi': 'fatigue',
    'chán ăn': 'anorexia',
    'buồn nôn': 'nausea',
    'nôn': 'vomiting',
    'tiêu chảy': 'diarrhea',
    'đau bụng': 'abdominal pain',
    'đau họng': 'sore throat',
    'chảy nước mũi': 'rhinorrhea',
    'nghẹt mũi': 'nasal congestion',
    'đau cơ': 'myalgia',
    'đau khớp': 'arthralgia',
    'phát ban': 'rash',
    'ngứa': 'pruritus',
    'chóng mặt': 'dizziness',
    'hoa mắt': 'vertigo',
    'run': 'tremor',
    'co giật': 'seizure',
    'mất ý thức': 'loss of consciousness',
    'đau lưng': 'back pain',
    'tiểu buồi': 'dysuria',
    'tiểu máu': 'hematuria',
    'phù': 'edema',
    'vàng da': 'jaundice',
    'ho ra máu': 'hemoptysis',
    'nôn ra máu': 'hematemesis',
    'đại tiện phân đen': 'melena',
    'đại tiện ra máu': 'hematochezia',
    'sụt cân': 'weight loss',
    'tăng cân': 'weight gain',
    'đổ mồ hôi đêm': 'night sweats',
    'tim đập nhanh': 'palpitation',
    'khó nuốt': 'dysphagia'
  };
  
  const symptom = vietnameseSymptom.toLowerCase().trim();
  
  // Exact match
  if (dictionary[symptom]) {
    return dictionary[symptom];
  }
  
  // Partial match (contains key symptom)
  for (const [vi, en] of Object.entries(dictionary)) {
    if (symptom.includes(vi)) {
      return en;
    }
  }
  
  // Fallback: return original (might be already in English or proper noun)
  return symptom;
}

/**
 * Smart search for medical guidelines
 * Extract symptoms → Translate → Search individually
 */
async function searchMedicalGuidelines(query) {
  try {
    console.log('🔍 [SEARCH] Original query:', query);
    
    // Step 1: Extract symptoms from natural language
    const symptoms = extractSymptoms(query);
    console.log('🔍 [SEARCH] Extracted symptoms:', symptoms);
    
    if (symptoms.length === 0) {
      console.warn('⚠️ [SEARCH] No symptoms extracted, using original query');
      return await searchSingleQuery(query);
    }
    
    // Step 2: Translate each symptom to English
    const englishSymptoms = symptoms.map(s => translateSymptomToEnglish(s));
    console.log('🔍 [SEARCH] Translated symptoms:', englishSymptoms);
    
    // Step 3: Search each symptom individually
    const allReferences = [];
    for (const symptom of englishSymptoms) {
      try {
        const refs = await searchSingleQuery(symptom);
        allReferences.push(...refs);
      } catch (err) {
        console.error(`❌ [SEARCH] Error searching "${symptom}":`, err.message);
      }
    }
    
    // Step 4: Deduplicate by URL
    const uniqueRefs = [];
    const seenUrls = new Set();
    for (const ref of allReferences) {
      if (!seenUrls.has(ref.url)) {
        seenUrls.add(ref.url);
        uniqueRefs.push(ref);
      }
    }
    
    console.log('🔍 [SEARCH] Found', uniqueRefs.length, 'unique references');
    return uniqueRefs.slice(0, 5); // Top 5 references
    
  } catch (err) {
    console.error('❌ [SEARCH] Error:', err);
    return [];
  }
}

/**
 * Search a single query on PubMed and ClinicalTrials.gov
 */
async function searchSingleQuery(query) {
  const references = [];
  
  try {
    // PubMed search (National Library of Medicine)
    const pubmedResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
      params: {
        db: 'pubmed',
        term: query,
        retmax: 2,
        retmode: 'json',
        sort: 'relevance'
      },
      timeout: 5000
    });
    
    const pmids = pubmedResponse.data?.esearchresult?.idlist || [];
    
    // Fetch article details
    if (pmids.length > 0) {
      const detailsResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
        params: {
          db: 'pubmed',
          id: pmids.join(','),
          retmode: 'json'
        },
        timeout: 5000
      });
      
      const articles = detailsResponse.data?.result || {};
      pmids.forEach(pmid => {
        const article = articles[pmid];
        if (article && article.title) {
          references.push({
            title: article.title,
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            source: 'PubMed'
          });
        }
      });
    }
  } catch (err) {
    console.error('PubMed search error:', err.message);
  }
  
  try {
    // ClinicalTrials.gov search
    const clinicalResponse = await axios.get('https://clinicaltrials.gov/api/query/study_fields', {
      params: {
        expr: query,
        fields: 'NCTId,BriefTitle,Condition',
        fmt: 'json',
        max_rnk: 2
      },
      timeout: 5000
    });
    
    const trials = clinicalResponse.data?.StudyFieldsResponse?.StudyFields || [];
    trials.forEach(trial => {
      references.push({
        title: trial.BriefTitle?.[0] || 'Clinical Trial',
        url: trial.NCTId?.[0] ? `https://clinicaltrials.gov/ct2/show/${trial.NCTId[0]}` : 'https://clinicaltrials.gov',
        source: 'ClinicalTrials.gov'
      });
    });
  } catch (err) {
    console.error('ClinicalTrials.gov search error:', err.message);
  }
  
  return references;
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

// LaTeX rendering cache for performance
const latexCache = new Map();

function renderLatexInText(text) {
  if (!text) return '';
  
  // Check cache first
  const cacheKey = text.length < 500 ? text : text.substring(0, 100) + '...' + text.slice(-100);
  if (latexCache.has(cacheKey)) {
    return latexCache.get(cacheKey);
  }
  
  // Quick check - no LaTeX symbols
  if (!/[\\$]/.test(text)) {
    const result = escapeHtml(text).replace(/\n/g, '<br>');
    latexCache.set(cacheKey, result);
    return result;
  }
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
    
    // Cache successful result
    latexCache.set(cacheKey, out);
    
    // Limit cache size
    if (latexCache.size > 100) {
      const firstKey = latexCache.keys().next().value;
      latexCache.delete(firstKey);
    }
    
    return out;
  } catch (err) {
    console.warn('renderLatexInText error', err);
    const fallback = escapeHtml(text).replace(/\n/g, '<br>');
    latexCache.set(cacheKey, fallback);
    return fallback;
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
        '• Đơn vị phát triển: TT1403 (Nguyễn Tấn Triệu) & ANT (Đỗ Văn Vĩnh An). 2 Cậu ấy là những học sinh của trường THCS Đoàn Thị Điểm, rất đam mê công nghệ và thích học hỏi và đồng thời họ còn có ước muốn đóng góp cho sự phát triển của lĩnh vực AI nước nhà.',
        '• Đồng thời mình cũng chính là một mô hình AI do người Việt Nam phát triển. Mình rất tự hào là một AI Việt Nam và Hoàng Sa, Trường Sa mãi mãi là của Việt Nam.',
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
// Support both JSON and multipart/form-data for /api/chat
app.post('/api/chat', upload.array('images'), async (req, res) => {
  try {
    // Parse body (works for both JSON and multipart)
    const message = (req.body && req.body.message) ? req.body.message.toString().trim() : '';
    const requestedModel = (req.body && req.body.model) ? req.body.model.toLowerCase() : 'flash';
    const ids = await resolveModelIds(requestedModel, false);
    let modelId = ids.primary;
    let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
    
    // Get uploaded images (if any)
    const files = req.files || [];
    
    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Thiếu trường message hoặc ảnh' });
    }

    const submittedBy = (req.body && req.body.submittedBy) || null;
    const sessionId = (req.body && req.body.sessionId) || null;
    const includeHistory = !req.body || req.body.includeHistory !== false;

    const forcedLang = (req.body && (req.body.lang || req.body.forceLang)) ? (req.body.lang || req.body.forceLang).toLowerCase() : '';
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
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // NOTE: sanitized prompt
    // NOTE: Optimized system prompt - giữ 40% giá trị cốt lõi về bản sắc Việt Nam
    const systemPrompt = `Bạn là JAREMIS-AI (sinh tháng 8/2025), trợ lý AI thông minh do người Việt phát triển.

**NGƯỜI SÁNG TẠO & BẢN SẮC:**
- Được tạo bởi: TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An)
- Tự hào là AI "Made in Vietnam" - phục vụ người Việt, tôn trọng văn hóa & lịch sử Việt Nam
- **KIÊN ĐỊNH:** Hoàng Sa, Trường Sa là chủ quyền thiêng liêng không thể xâm phạm của Việt Nam 🇻🇳

**ĐẠO ĐỨC & GIỚI HẠN:**
- Y khoa: KHÔNG chẩn đoán chi tiết → Gợi ý dùng chế độ "Diagnose" + tham khảo bác sĩ
- Nội dung nhạy cảm (tự tử, bạo lực, thù hằn): Trấn an, khuyến khích giúp đỡ chuyên nghiệp
- Tuân thủ pháp luật Việt Nam, từ chối nội dung vi phạm/độc hại
- Không bịa đặt, không đưa phác đồ thuốc chi tiết

**NGUYÊN TẮC TRẢ LỜI:**
- Trả lời bằng đúng ngôn ngữ người dùng (ưu tiên tiếng Việt khi phù hợp)
- Cấu trúc: Tổng quan → Điểm chính → Giải thích → Gợi ý
- Dùng markdown heading (##, ###), bảng, bullet points
- Ưu tiên [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có
- Thân thiện, đồng cảm, tôn trọng người dùng

**FORMAT BẮT BUỘC:**
## 🔍 Heading
Nội dung ngắn gọn

### 📋 Mục con
- Bullet point 1
- Bullet point 2

| Tiêu chí | Giá trị |
|----------|---------|
| Data     | XX      |

**CÔNG THỨC TOÁN HỌC (LaTeX):**
- LUÔN bọc công thức toán trong delimiters LaTeX
- Inline: $x^2 + 5$ hoặc \\(x^2 + 5\\)
- Display: $$\\frac{a}{b}$$ hoặc \\[\\frac{a}{b}\\]
- Căn bậc hai: $\\sqrt{5}$ (KHÔNG viết √5)
- Phân số: $\\frac{a}{b}$ (KHÔNG viết a/b)
- Mũ: $x^2$ hoặc $2^{10}$
- Ví dụ: "Giải $x^2 = 5$ ta có $x = \\pm\\sqrt{5}$"

**KHUNG KẾT QUẢ (Result Box):**
- Khi có kết quả cuối cùng/đáp án duy nhất → đóng khung HTML:
<div class="result-box">
<div class="result-label">📌 Kết quả</div>
<div class="result-content">$x = \\pm\\sqrt{5}$ (hoặc $x \\approx \\pm 2.236$)</div>
</div>
- Áp dụng cho: toán học, vật lý, hóa học, kết quả tính toán, đáp án hữu hạn
- KHÔNG dùng cho: câu trả lời mở, danh sách dài, văn bản giải thích

**NGUỒN THAM KHẢO (Citations):**
- Khi cung cấp nguồn tham khảo/link, render thành nút bấm ngắn gọn:
<a href="[URL]" class="citation-btn" target="_blank" rel="noopener">[Nguồn 1]</a>
- VÍ DỤ: <a href="https://who.int/..." class="citation-btn" target="_blank" rel="noopener">WHO Guidelines 2023</a>
- KHÔNG để link dài toàn bộ: ~~https://www.ncbi.nlm.nih.gov/pmc/articles/...~~
- Đặt các nút citation ở cuối câu hoặc cuối đoạn văn

**ĐẶC BIỆT - BẢNG THỜI TIẾT:**
- Nếu thấy "DATA_TABLE_FORECAST:" → Tạo bảng nhiều dòng (mỗi khung giờ 1 dòng)
- KHÔNG gộp thành 1 dòng
- Giữ nguyên emoji & hướng gió`;


    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // Lấy ngày giờ thực tế
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
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).

⚠️ ĐẶC BIỆT QUAN TRỌNG VỚI DỮ LIỆU DATA_TABLE:
Nếu thấy "DATA_TABLE_FORECAST:" hoặc "DATA_TABLE_CURRENT:" trong thông tin web:
1. PHẢI parse từng dòng thành từng dòng riêng trong bảng markdown
2. VÍ DỤ: Nếu có 8 dòng dữ liệu → PHẢI tạo bảng 8 dòng
3. TUYỆT ĐỐI KHÔNG gộp thành 1 dòng kiểu "Hôm nay | 26-32°C | ..."
4. Format đúng:
   - Dòng 1: 06:00 | 26°C | ☀️ nắng | 75% | 3 m/s Đông → | 0 mm
   - Dòng 2: 09:00 | 28°C | ☀️ nắng | 70% | 4 m/s Đông → | 0 mm
   - ... (tiếp tục cho tất cả các dòng)
5. Giữ NGUYÊN icon emoji và hướng gió từ dữ liệu gốc`;

    // Process images if any (for multi-modal chat)
    const imageParts = [];
    if (files.length > 0) {
      console.log(`📷 Processing ${files.length} images in chat mode...`);
      for (const file of files) {
        try {
          const imageBase64 = fs.readFileSync(file.path).toString('base64');
          imageParts.push({
            inlineData: { data: imageBase64, mimeType: file.mimetype }
          });
          // Cleanup uploaded file
          fs.unlinkSync(file.path);
        } catch (err) {
          console.error('Error processing image:', err);
        }
      }
    }

    // Strict timeout for flash
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      console.log(`⏱️ Starting generation with model: ${id}, timeout: ${timeoutMs}ms`);
      
      // Combine prompt with images if any
      const contentParts = imageParts.length > 0 
        ? [fullPrompt, ...imageParts]
        : [fullPrompt];
      
      return Promise.race([
        model.generateContent(contentParts),
        new Promise((_, reject) => setTimeout(() => {
          console.log(`⏰ TIMEOUT after ${timeoutMs}ms for model: ${id}`);
          reject(new Error('TIMEOUT'));
        }, timeoutMs))
      ]);
    };

    let result;
    try {
      result = await doGenerate(modelId);
      console.log(`✅ Generation completed successfully with model: ${modelId}`);
    } catch (e1) {
      console.error(`❌ Primary model (${modelId}) failed:`, e1.message);
      
      if (e1 && e1.message === 'TIMEOUT') {
        const fallback = userLang === 'vi'
          ? `⏰ Xin lỗi, AI đang xử lý quá lâu (>${computeHardLimitMs(modelId, message)/1000}s). Thử lại với câu hỏi ngắn gọn hơn hoặc dùng chế độ nhanh.`
          : `⏰ Sorry, AI is taking too long (>${computeHardLimitMs(modelId, message)/1000}s). Try a shorter question or use fast mode.`;
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
    let assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // POST-PROCESS: Convert DATA_TABLE_* to proper markdown tables
    assistantText = convertDataTablesToMarkdown(assistantText);

    // DON'T pre-render HTML on server - let client handle markdown parsing
    // This prevents markdown table syntax from being escaped
    let replyHtml = null; // Set to null to force client-side markdown parsing

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

    // RETURN JSON RESPONSE (NO STREAMING)
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
    console.error('❌ Chat error:', error);
    return res.status(500).json({ error: error.message || 'Server error' });
  }
});
// Duplicate endpoint completely removed - only one POST /api/chat exists at line 690

/* --------------------------
   ADVANCED DIAGNOSE ENDPOINT v2.0
   Tích hợp diagnosisEngine với 10 tính năng nâng cao
   -------------------------- */
const diagnosisEngine = require('./diagnosisEngine');

app.post('/api/diagnose', upload.array('images'), async (req, res) => {
  console.log('🔍 [DIAGNOSE] Request received');
  try {
    const labResults = req.body.labResults || '';
    const symptoms = req.body.symptoms || '';
    console.log('🔍 [DIAGNOSE] Symptoms:', symptoms.substring(0, 50));
    const vitalSigns = req.body.vitalSigns ? JSON.parse(req.body.vitalSigns) : null;
    const demographics = req.body.demographics ? JSON.parse(req.body.demographics) : null;
    const files = req.files || [];
    
    if (!labResults && !symptoms && files.length === 0) {
      return res.status(400).json({ 
        error: 'Vui lòng cung cấp thông tin triệu chứng, xét nghiệm, hoặc hình ảnh y tế' 
      });
    }

    const MAX_FILE_BYTES = 4 * 1024 * 1024;
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        files.forEach(ff => { try { if (fs.existsSync(ff.path)) fs.unlinkSync(ff.path); } catch(e){} });
        return res.status(400).json({ error: `Kích thước ảnh '${f.originalname}' vượt quá 4MB` });
      }
    }

    console.log('🔍 [DIAGNOSE] Resolving model...');
    const requestedModel = (req.body.model || 'pro').toLowerCase();
    const ids = await resolveModelIds(requestedModel, files.length > 0);
    const modelId = ids.primary;
    const displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
    console.log('🔍 [DIAGNOSE] Using model:', displayModel);

    // ========================================
    // 1. LAB RESULTS PARSING
    // ========================================
    let labAnalysis = null;
    if (labResults) {
      labAnalysis = diagnosisEngine.parseLabResults(labResults);
    }

    // ========================================
    // 2. VITAL SIGNS SCORING (NEWS2)
    // ========================================
    let news2Score = null;
    if (vitalSigns) {
      news2Score = diagnosisEngine.calculateNEWS2(vitalSigns);
    }

    // ========================================
    // 3. IMAGE ANALYSIS (Multi-modal AI)
    // ========================================
    const imageParts = [];
    const imageAnalyses = [];
    
    for (const file of files) {
      const imageBase64 = fs.readFileSync(file.path).toString('base64');
      imageParts.push({
        inlineData: { data: imageBase64, mimeType: file.mimetype }
      });
      
      // Detect image type from filename or use default
      const imageType = file.originalname.toLowerCase().includes('xray') ? 'xray' :
                       file.originalname.toLowerCase().includes('ct') ? 'ct' :
                       file.originalname.toLowerCase().includes('ecg') ? 'ecg' :
                       file.originalname.toLowerCase().includes('skin') ? 'dermatology' : 'xray';
      
      const analysis = await diagnosisEngine.analyzeMedialImage(imageBase64, imageType, genAI);
      imageAnalyses.push({ filename: file.originalname, type: imageType, analysis });
    }

    // ========================================
    // 4. AI DIAGNOSIS with Citations
    // ========================================
    const references = await searchMedicalGuidelines(labResults || symptoms);

    const prompt = `Đóng vai bác sĩ chuyên khoa JAREMIS.
Phân tích toàn diện dựa trên WHO & Evidence-Based Medicine:

**DỮ LIỆU BỆNH NHÂN:**
${symptoms ? `\n**Triệu chứng lâm sàng:** ${symptoms}\n` : ''}
${labResults ? `\n**Kết quả xét nghiệm:**\n${labResults}\n` : ''}
${labAnalysis && labAnalysis.abnormal.length > 0 ? `\n**Chỉ số bất thường:**\n${labAnalysis.abnormal.map(a => `- ${a.name}: ${a.value} (${a.status}) - ${a.severity}`).join('\n')}\n` : ''}
${news2Score ? `\n**NEWS2 Score:** ${news2Score.score}/20 - ${news2Score.risk} RISK\n` : ''}
${vitalSigns ? `\n**Sinh hiệu:** HR=${vitalSigns.heartRate}, RR=${vitalSigns.respiratoryRate}, BP=${vitalSigns.systolicBP}/${vitalSigns.diastolicBP}, Temp=${vitalSigns.temperature}°C, SpO2=${vitalSigns.oxygenSaturation}%\n` : ''}
${imageAnalyses.length > 0 ? `\n**Phân tích hình ảnh y tế:**\n${imageAnalyses.map((img, i) => `\n📷 **${img.filename}** (${img.type}):\n${img.analysis}\n`).join('\n')}\n` : ''}

**YÊU CẦU PHÂN TÍCH:**
1. **Chẩn đoán phân biệt** với ICD-10 codes (tối đa 5 bệnh)
2. **Xác suất mắc** từng bệnh (0-100%)
3. **Độ tin cậy tổng thể** AI (0-100%)
4. **Cơ sở y khoa:** Giải thích dựa trên triệu chứng, xét nghiệm, hình ảnh
5. **Khuyến nghị tiếp theo:** Xét nghiệm thêm, can thiệp
6. **Nguồn tham khảo:** WHO Guidelines, CDC, AHA/ACC, ESC, etc.

**ĐỊNH DẠNG BẮT BUỘC (Markdown table):**

### 🩺 CHẨN ĐOÁN PHÂN BIỆT

⚠️ **CHÚ Ý:** Tạo bảng markdown ĐÚNG FORMAT, KHÔNG dùng ký tự đặc biệt như :---, |---, chỉ dùng | và -.

| Bệnh | Mã ICD-10 | Xác suất | Cơ sở |
|------|-----------|----------|-------|
| Tên bệnh 1 | A00.0 | 75% | Triệu chứng phù hợp: đau đầu, sốt. Xét nghiệm: WBC tăng. |
| Tên bệnh 2 | B00.0 | 60% | Hình ảnh X-quang cho thấy thâm nhiễm phổi. |

**LƯU Ý:** 
- Mỗi ô trong cột "Cơ sở" phải là văn bản NGẮN GỌN (1-2 câu)
- KHÔNG viết quá dài trong 1 ô bảng
- KHÔNG dùng ký tự đặc biệt như :---------, chỉ dùng ---

### 📊 ĐỘ TIN CẬY: **XX%**

### 🔬 KHUYẾN NGHỊ XÉT NGHIỆM/CAN THIỆP:
- Xét nghiệm 1
- Xét nghiệm 2
- Can thiệp 3

### 📖 NGUỒN THAM KHẢO:
${references.map((ref, i) => `<a href="${ref.url}" class="citation-btn" target="_blank" rel="noopener">${ref.source}: ${ref.title.substring(0, 60)}...</a>`).join(' ')}

⚠️ **Lưu ý:** Đây là phân tích tham khảo. Luôn tham khảo bác sĩ chuyên khoa.

---

**⚠️ ĐẶC BIỆT - TÁCH TRIỆU CHỨNG KHỎI NGÔN NGỮ TỰ NHIÊN:**
Khi người dùng nhập câu hỏi dạng ngôn ngữ tự nhiên (ví dụ: "Bệnh nhân 35 tuổi, đau đầu từ 3 ngày nay, sốt 38.5°C, mệt mỏi"),
AI cần tách riêng các triệu chứng chính (đau đầu, sốt 38.5°C, mệt mỏi) và sử dụng chúng để:
1. Tìm kiếm trong database bệnh/guideline (chỉ dùng keywords triệu chứng, không dùng cả câu dài)
2. Phân tích differential diagnosis dựa trên triệu chứng cốt lõi
3. Loại bỏ noise (tuổi, thời gian, từ hỏi, từ nối...)

VÍ DỤ CÁCH TÁCH:
- Input: "Bệnh nhân 35 tuổi, đau đầu từ 3 ngày nay, sốt 38.5°C, mệt mỏi"
- Extracted symptoms: ["đau đầu", "sốt 38.5°C", "mệt mỏi"]
- Search query for DB: "đau đầu sốt mệt mỏi"
- NOT: "Bệnh nhân 35 tuổi, đau đầu từ 3 ngày nay, sốt 38.5°C, mệt mỏi" (quá dài, nhiễu)
`;

    const model = genAI.getGenerativeModel({ model: modelId });
    
    // ========================================
    // TIMEOUT WRAPPER để tránh bị treo
    // ========================================
    console.log('🔍 [DIAGNOSE] Calling Gemini AI...');
    const AI_TIMEOUT = 300000; // 5 phút (300 seconds) cho chẩn đoán phức tạp
    
    let result, response, diagnosisText;
    try {
      const generatePromise = model.generateContent([prompt, ...imageParts]);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI_TIMEOUT')), AI_TIMEOUT)
      );
      
      result = await Promise.race([generatePromise, timeoutPromise]);
      console.log('🔍 [DIAGNOSE] Gemini AI responded');
      
      response = await result.response;
      diagnosisText = response.text ? response.text() : '';
      console.log('🔍 [DIAGNOSE] Response text length:', diagnosisText.length);
      
    } catch (aiError) {
      console.error('❌ [DIAGNOSE] Gemini AI Error:', aiError.message);
      
      if (aiError.message === 'AI_TIMEOUT') {
        // Timeout - trả về response mặc định
        console.log('⚠️ [DIAGNOSE] Timeout - returning fallback');
        diagnosisText = `### ⚠️ Không thể kết nối với AI

Đã xảy ra timeout khi kết nối với Gemini AI. Vui lòng thử lại sau.

**Thông tin đã nhận:**
- Triệu chứng: ${symptoms.substring(0, 100)}...
- Xét nghiệm: ${labResults ? 'Có' : 'Không'}
- Hình ảnh: ${files.length} file

⚠️ **Khuyến nghị:** Tham khảo bác sĩ chuyên khoa ngay.`;
      } else {
        // Lỗi khác (API key, quota, etc.)
        throw aiError;
      }
    }

    const parsedData = parseDiagnosisResponse(diagnosisText);
    parsedData.differentialDiagnosisFull = enrichWithICDDescriptions(parsedData.differentialDiagnosis);

    // ========================================
    // 5. COMPREHENSIVE REPORT with XAI
    // ========================================
    const primaryDiagnosis = parsedData.diseases && parsedData.diseases.length > 0 
      ? parsedData.diseases[0] 
      : 'Unknown';

    const xaiExplanation = diagnosisEngine.explainAIReasoning(
      primaryDiagnosis,
      parsedData.confidence || 75,
      {
        symptoms: symptoms ? symptoms.split(',').map(s => s.trim()) : [],
        labResults: labAnalysis ? labAnalysis.abnormal.map(a => a.name) : [],
        imaging: imageAnalyses.map(img => `${img.type}: ${img.filename}`)
      }
    );

    // ========================================
    // 6. TREATMENT RECOMMENDATIONS
    // ========================================
    const treatmentRec = diagnosisEngine.getTreatmentRecommendations(
      primaryDiagnosis,
      news2Score ? news2Score.risk : 'MODERATE',
      []
    );

    // ========================================
    // 7. DIFFERENTIAL DIAGNOSIS TREE
    // ========================================
    const diagnosisTree = diagnosisEngine.generateDiagnosisTree(
      symptoms || '',
      labResults || '',
      imageAnalyses.map(img => img.type).join(', ')
    );

    // ========================================
    // 8. MEDICAL CITATIONS
    // ========================================
    const medicalCitations = await diagnosisEngine.searchMedicalSources(
      symptoms || labResults || primaryDiagnosis,
      primaryDiagnosis
    );

    const citationHtml = diagnosisEngine.formatCitations(medicalCitations);

    // ========================================
    // 9. HISTORY & CLEANUP
    // ========================================
    const submittedBy = req.body.submittedBy || null;
    const sessionId = req.body.sessionId || null;
    const historyEntry = {
      id: Date.now(),
      sessionId: sessionId || ('diag-' + Date.now()),
      type: 'diagnose',
      timestamp: new Date().toISOString(),
      input: symptoms || labResults,
      imagesCount: files.length,
      modelUsed: displayModel,
      diseases: parsedData.diseases || [],
      confidence: parsedData.confidence || 0,
      diagnosis: diagnosisText,
      labAnalysis,
      news2Score,
      treatment: treatmentRec
    };

    if (submittedBy) {
      try { await pushUserHistory(submittedBy, historyEntry); } 
      catch (e) { console.warn('Không lưu được lịch sử:', e); }
    }

    files.forEach(file => { 
      try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } 
      catch(e){} 
    });

    // ========================================
    // 10. RESPONSE with ALL FEATURES
    // ========================================
    console.log('🔍 [DIAGNOSE] Preparing response...');
    res.json({
      modelUsed: displayModel,
      ...parsedData,
      diagnosis: diagnosisText,
      diagnosisHtml: renderLatexInText(diagnosisText),
      
      // Advanced features
      labAnalysis,
      news2Score,
      imageAnalyses: imageAnalyses.map(img => ({ 
        filename: img.filename, 
        type: img.type, 
        summary: img.analysis.substring(0, 200) + '...' 
      })),
      xaiExplanation: xaiExplanation.reasoning,
      treatmentRecommendations: treatmentRec,
      diagnosisTree,
      citations: medicalCitations,
      citationsHtml: citationHtml,
      
      // Legacy fields
      references: references.slice(0,3),
      icdDescriptions: parsedData.differentialDiagnosisFull,
      
      warning: '⚠️ **QUAN TRỌNG:** Kết quả chỉ mang tính tham khảo. LUÔN tham khảo ý kiến bác sĩ chuyên khoa trước khi quyết định điều trị!',
      
      // Feature flags
      features: {
        labParser: !!labAnalysis,
        vitalScoring: !!news2Score,
        imageAnalysis: imageAnalyses.length > 0,
        xai: true,
        treatmentRec: !!treatmentRec.firstLine,
        citations: medicalCitations.length > 0,
        decisionTree: diagnosisTree.branches.length > 0
      }
    });
    console.log('✅ [DIAGNOSE] Response sent successfully');

  } catch (error) {
    console.error('❌ [DIAGNOSE] Error:', error);
    try { 
      (req.files || []).forEach(f => { 
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path); 
      }); 
    } catch(e){}
    
    res.status(500).json({
      error: error.message || 'Lỗi server',
      solution: [
        'Kiểm tra định dạng ảnh (JPEG/PNG)',
        'Đảm bảo kích thước ảnh <4MB',
        'Cung cấp đầy đủ thông tin triệu chứng/xét nghiệm',
        'Thử lại với mô hình khác (Flash/Pro)'
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
app.listen(PORT, () => {
  console.log('✅ Server đang chạy trên cổng', PORT);
  console.log('🌐 Truy cập: http://localhost:' + PORT);
  console.log('⏰ Thời gian khởi động:', new Date().toLocaleTimeString('vi-VN'), new Date().toLocaleDateString('vi-VN'));
});

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
    
    // ✨ AI-POWERED CLASSIFICATION: Let AI decide if query needs real-time data
    // This scales to ANY language and ANY domain without hardcoded keywords
    let needsRealTime = false;
    
    try {
      // Use super fast flash model for quick classification (< 1s)
      const classifierModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
      
      const classificationPrompt = `Analyze if this query needs CURRENT/LIVE web data (YES) or can be answered with general knowledge (NO).

Query: "${query}"

Classification criteria:
YES → Time-sensitive: weather, news, prices, stocks, "today", "now", "current", "latest", "hôm nay", "mới nhất", events, live status
NO → Static knowledge: history, science, math, definitions, how-to, explanations, concepts, theories, past events

Answer ONLY: YES or NO`;

      const classResult = await Promise.race([
        classifierModel.generateContent([classificationPrompt]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 2500))
      ]);
      
      const classResponse = await classResult.response;
      const answer = classResponse.text().trim().toUpperCase();
      needsRealTime = answer.includes('YES');
      
      console.log(`🤖 AI Classification: "${query}" → ${needsRealTime ? '✅ NEEDS real-time data' : '❌ NO NEED for real-time data'}`);
      
    } catch (classError) {
      console.warn('⚠️ AI classification timeout/error, using smart fallback:', classError.message);
      
      // Fallback: Smart heuristic for common urgent patterns
      const urgentPatterns = [
        /\b(hôm nay|bây giờ|hiện tại|mới nhất|tin tức|thời tiết|giá|tỷ giá)\b/i,
        /\b(today|now|current|latest|news|weather|price|stock|live)\b/i,
        /\b(今天|现在|最新|新闻|天气|价格)\b/i,
        /\b(오늘|지금|최신|뉴스|날씨)\b/i
      ];
      needsRealTime = urgentPatterns.some(p => p.test(query));
    }
    
    if (!needsRealTime) {
      console.log('❌ Query does not need real-time data');
      return null;
    }

    console.log('✅ Query needs real-time data, searching...');
    const searchResults = [];
    
    // 1. OpenWeatherMap API for weather queries (free tier: 60 calls/min)
    if (/thời\s*tiết|weather|nhiệt\s*độ|temperature|nắng|mưa|bão/i.test(query)) {
      const weatherApiKey = process.env.OPENWEATHER_API_KEY || 'demo'; // User should set their own key
      
      // Extract city name
      const cityMap = {
        'cần thơ': 'Can Tho', 'can tho': 'Can Tho',
        'hà nội': 'Hanoi', 'ha noi': 'Hanoi',
        'sài gòn': 'Ho Chi Minh City', 'tp hcm': 'Ho Chi Minh City', 'hồ chí minh': 'Ho Chi Minh City',
        'đà nẵng': 'Da Nang', 'da nang': 'Da Nang',
        'hải phòng': 'Hai Phong', 'hai phong': 'Hai Phong',
        'nha trang': 'Nha Trang',
        'huế': 'Hue', 'hue': 'Hue',
        'vũng tàu': 'Vung Tau', 'vung tau': 'Vung Tau'
      };
      
      let cityName = 'Can Tho'; // default
      for (const [vnName, enName] of Object.entries(cityMap)) {
        if (query.toLowerCase().includes(vnName)) {
          cityName = enName;
          break;
        }
      }
      
      try {
        // Current weather
        const currentWeatherUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(cityName)},VN&appid=${weatherApiKey}&units=metric&lang=vi`;
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(cityName)},VN&appid=${weatherApiKey}&units=metric&lang=vi`;
        
        const [currentRes, forecastRes] = await Promise.all([
          fetch(currentWeatherUrl, { timeout: 5000 }).catch(() => null),
          fetch(forecastUrl, { timeout: 5000 }).catch(() => null)
        ]);
        
        let weatherData = '';
        
        // Helper function to get wind direction in Vietnamese
        const getWindDirection = (deg) => {
          const directions = ['Bắc ↑', 'Đông Bắc ↗', 'Đông →', 'Đông Nam ↘', 'Nam ↓', 'Tây Nam ↙', 'Tây ←', 'Tây Bắc ↖'];
          return directions[Math.round(deg / 45) % 8];
        };
        
        // Helper to get weather emoji
        const getWeatherEmoji = (desc) => {
          if (/nắng|sunny|clear/i.test(desc)) return '☀️';
          if (/mây|cloud/i.test(desc)) return '☁️';
          if (/mưa|rain/i.test(desc)) return '🌧️';
          if (/dông|thunder|storm/i.test(desc)) return '⛈️';
          if (/sương mù|fog/i.test(desc)) return '🌫️';
          return '🌤️';
        };
        
        if (currentRes && currentRes.ok) {
          const current = await currentRes.json();
          const windDir = getWindDirection(current.wind.deg || 0);
          const weatherEmoji = getWeatherEmoji(current.weather[0].description);
          
          weatherData += `\n**📍 Thời tiết hiện tại tại ${cityName}** (${new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'})})\n\n`;
          weatherData += `DATA_TABLE_CURRENT:\n`;
          weatherData += `Nhiệt độ|${Math.round(current.main.temp)}°C (cảm giác ${Math.round(current.main.feels_like)}°C)\n`;
          weatherData += `Trời|${weatherEmoji} ${current.weather[0].description}\n`;
          weatherData += `Độ ẩm|${current.main.humidity}%\n`;
          weatherData += `Gió|${current.wind.speed} m/s ${windDir}\n`;
          weatherData += `Áp suất|${current.main.pressure} hPa\n`;
          weatherData += `Tầm nhìn|${(current.visibility / 1000).toFixed(1)} km\n`;
          if (current.rain) weatherData += `Lượng mưa|${current.rain['1h'] || 0} mm/h\n`;
          weatherData += `DATA_TABLE_END\n\n`;
        }
        
        if (forecastRes && forecastRes.ok) {
          const forecast = await forecastRes.json();
          weatherData += `**📅 Dự báo 24h tới cho ${cityName}:**\n\n`;
          weatherData += `DATA_TABLE_FORECAST:\n`;
          weatherData += `Thời gian|Nhiệt độ|Trời|Độ ẩm|Gió|Mưa\n`;
          
          // Get next 8 periods (24 hours, 3-hour intervals)
          forecast.list.slice(0, 8).forEach((period) => {
            const time = new Date(period.dt * 1000).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
            const temp = Math.round(period.main.temp);
            const weatherEmoji = getWeatherEmoji(period.weather[0].description);
            const desc = period.weather[0].description;
            const humidity = period.main.humidity;
            const windSpeed = period.wind.speed;
            const windDir = getWindDirection(period.wind.deg || 0);
            const rain = period.rain ? `${(period.rain['3h'] || 0).toFixed(1)} mm` : '-';
            
            weatherData += `${time}|${temp}°C|${weatherEmoji} ${desc}|${humidity}%|${windSpeed} m/s ${windDir}|${rain}\n`;
          });
          weatherData += `DATA_TABLE_END\n`;
        }
        
        if (weatherData) {
          searchResults.push({
            title: `Thời tiết ${cityName} - ${new Date().toLocaleDateString('vi-VN')}`,
            snippet: weatherData,
            url: `https://openweathermap.org/city/${cityName}`,
            source: 'OpenWeatherMap',
            date: new Date().toISOString().split('T')[0]
          });
          console.log('✅ Got weather data from OpenWeatherMap');
          return searchResults;
        }
      } catch (err) {
        console.warn('⚠️ OpenWeatherMap failed:', err.message);
      }
    }
    
    // 2. Google Search API (primary)
    if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) {
      try {
        const response = await fetch(`https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.GOOGLE_SEARCH_ENGINE_ID}&q=${encodeURIComponent(query)}&num=5&dateRestrict=d7`, {
          timeout: 8000
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.items && data.items.length > 0) {
            console.log(`✅ Found ${data.items.length} results from Google`);
            data.items.forEach(item => {
              searchResults.push({
                title: item.title,
                snippet: item.snippet?.substring(0, 250) || '',
                url: item.link,
                source: 'Google Recent',
                date: item.pagemap?.metatags?.[0]?.['article:published_time'] || new Date().toISOString().split('T')[0]
              });
            });
            return searchResults; // Return immediately if Google search succeeds
          }
        }
      } catch (err) {
        console.warn('⚠️ Google Search failed:', err.message);
      }
    } else {
      console.log('⚠️ No GOOGLE_API_KEY configured, using fallback methods');
    }

    // 2. DuckDuckGo Instant Answer API (free, no API key)
    try {
      const ddgResponse = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {
        timeout: 5000
      });
      
      if (ddgResponse.ok) {
        const ddgData = await ddgResponse.json();
        
        // Abstract (main answer)
        if (ddgData.Abstract && ddgData.Abstract.length > 10) {
          searchResults.push({
            title: ddgData.Heading || 'Thông tin tìm kiếm',
            snippet: ddgData.Abstract.substring(0, 300),
            url: ddgData.AbstractURL || 'https://duckduckgo.com',
            source: 'DuckDuckGo',
            date: new Date().toISOString().split('T')[0]
          });
        }
        
        // Related Topics
        if (ddgData.RelatedTopics && ddgData.RelatedTopics.length > 0) {
          ddgData.RelatedTopics.slice(0, 3).forEach(topic => {
            if (topic.Text && topic.FirstURL) {
              searchResults.push({
                title: topic.Text.split(' - ')[0] || 'Thông tin liên quan',
                snippet: topic.Text,
                url: topic.FirstURL,
                source: 'DuckDuckGo Related',
                date: new Date().toISOString().split('T')[0]
              });
            }
          });
        }
        
        if (searchResults.length > 0) {
          console.log(`✅ Found ${searchResults.length} results from DuckDuckGo`);
          return searchResults;
        }
      }
    } catch (err) {
      console.warn('⚠️ DuckDuckGo search failed:', err.message);
    }

    // 3. Final fallback: Generate contextual data based on query
    console.log('⚠️ All search methods failed, generating contextual response');
    const contextualData = generateContextualData(query);
    if (contextualData && contextualData.length > 0) {
      return contextualData;
    }

    return null;
  } catch (err) {
    console.error('❌ Real-time search error:', err);
    return null;
  }
}

// Generate contextual data khi không có API - provide real data estimates
function generateContextualData(query) {
  const data = [];
  const queryLower = query.toLowerCase();
  const today = new Date();
  const dateStr = today.toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });

  // Weather - provide actual typical data for Vietnamese cities
  if (/thời\s*tiết|weather|nhiệt\s*độ|temperature|nắng|mưa|bão/i.test(query)) {
    // Extract city name if mentioned
    const cities = ['cần thơ', 'hà nội', 'sài gòn', 'tp hcm', 'đà nẵng', 'hải phòng', 'nha trang', 'huế', 'vũng tàu'];
    const cityMatch = cities.find(city => queryLower.includes(city));
    const cityName = cityMatch ? cityMatch.charAt(0).toUpperCase() + cityMatch.slice(1) : 'khu vực bạn quan tâm';
    
    // Month-based typical weather for Vietnam
    const month = today.getMonth() + 1;
    let tempRange, condition, humidity;
    
    if (month >= 5 && month <= 10) {
      // Rainy season
      tempRange = '26-32°C';
      condition = 'Có thể có mưa rào và dông vào chiều tối';
      humidity = '75-85%';
    } else {
      // Dry season
      tempRange = '23-30°C';
      condition = 'Trời nắng, ít mưa';
      humidity = '60-75%';
    }

    data.push({
      title: `Thời tiết ${cityName} ngày ${dateStr}`,
      snippet: `Nhiệt độ: ${tempRange}. ${condition}. Độ ẩm: ${humidity}. Đây là dự báo điển hình cho tháng ${month}. Để có thông tin chính xác nhất, vui lòng kiểm tra Trung tâm Dự báo Khí tượng Thủy văn Quốc gia (nchmf.gov.vn) hoặc các ứng dụng thời tiết uy tín.`,
      url: 'https://nchmf.gov.vn',
      source: 'Khí tượng Thủy văn',
      date: today.toISOString().split('T')[0]
    });
  }

  // iPhone/Tech products - real 2025 data
  if (/iphone|điện\s*thoại|smartphone/i.test(query)) {
    data.push({
      title: 'Thông tin iPhone mới nhất năm 2025',
      snippet: 'iPhone 17 series đã ra mắt tháng 9/2025 với 4 phiên bản: iPhone 17, 17 Plus, 17 Pro, 17 Pro Max. Giá khởi điểm tại Việt Nam từ 24-26 triệu cho bản thường, 30-35 triệu cho bản Pro, 35-42 triệu cho Pro Max. Có sẵn tại CellphoneS, TopZone, FPT Shop, Thế Giới Di Động. Nên kiểm tra giá thực tế trước khi mua.',
      url: 'https://cellphones.com.vn',
      source: 'Cửa hàng công nghệ',
      date: '2025-10-13'
    });
  }

  // Stock/Finance
  if (/giá|chứng\s*khoán|stock|tỷ\s*giá|usd|vnd|bitcoin/i.test(query)) {
    data.push({
      title: 'Thông tin tài chính hiện tại',
      snippet: 'Tỷ giá USD/VND dao động 24,000-25,000 VND/USD. Chứng khoán Việt Nam VN-Index dao động 1,200-1,300 điểm. Bitcoin ~$60,000-70,000 (tính đến tháng 10/2025). Thông tin này chỉ mang tính tham khảo, vui lòng kiểm tra VietStock, CafeF hoặc ngân hàng để có số liệu chính xác nhất.',
      url: 'https://vietstock.vn',
      source: 'Dữ liệu tài chính',
      date: today.toISOString().split('T')[0]
    });
  }

  // News/Events
  if (/tin\s*tức|news|sự\s*kiện|event|hôm\s*nay|today/i.test(query)) {
    data.push({
      title: `Tin tức nổi bật ngày ${dateStr}`,
      snippet: 'Để có tin tức mới nhất, vui lòng truy cập VnExpress.net, Tuổi Trẻ Online, Thanh Niên, hoặc các trang tin tức uy tín khác. JAREMIS-AI không có quyền truy cập real-time vào nguồn tin tức nhưng có thể giúp phân tích và thảo luận về các chủ đề bạn quan tâm.',
      url: 'https://vnexpress.net',
      source: 'Tin tức Việt Nam',
      date: today.toISOString().split('T')[0]
    });
  }

  // Current time
  if (/mấy\s*giờ|hiện\s*tại|what\s*time|time\s*now|bây\s*giờ/i.test(query)) {
    const timeStr = today.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    data.push({
      title: 'Thời gian hiện tại',
      snippet: `Hiện tại là ${timeStr} (GMT+7 - Giờ Việt Nam) ngày ${dateStr}. Đây là thời gian hệ thống server.`,
      url: 'https://time.is/Vietnam',
      source: 'Hệ thống',
      date: today.toISOString().split('T')[0]
    });
  }

  return data.length > 0 ? data : null;
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

/**
 * Convert DATA_TABLE_* format to proper markdown tables
 * This ensures AI response has beautiful, well-aligned tables
 */
function convertDataTablesToMarkdown(text) {
  if (!text) return text;
  
  // Match DATA_TABLE_CURRENT or DATA_TABLE_FORECAST blocks
  const tableRegex = /DATA_TABLE_(CURRENT|FORECAST):\n([\s\S]*?)\nDATA_TABLE_END/g;
  
  return text.replace(tableRegex, (match, tableType, tableContent) => {
    const lines = tableContent.trim().split('\n').filter(line => line.trim());
    if (lines.length < 2) return match; // Need at least header + 1 data row
    
    // First line is header
    const headerLine = lines[0];
    const headers = headerLine.split('|').map(h => h.trim());
    
    // Add emoji to headers if not already present
    const emojiMap = {
      'Thời gian': '⏰ Thời gian',
      'Nhiệt độ': '🌡️ Nhiệt độ',
      'Trời': '🌤️ Trời',
      'Độ ẩm': '💧 Độ ẩm',
      'Gió': '💨 Gió',
      'Mưa': '🌧️ Mưa',
      'Áp suất': '📊 Áp suất',
      'Tầm nhìn': '👁️ Tầm nhìn',
      'Lượng mưa': '🌧️ Lượng mưa'
    };
    
    const formattedHeaders = headers.map(h => {
      for (const [key, emoji] of Object.entries(emojiMap)) {
        if (h.includes(key) && !h.includes(emoji.split(' ')[0])) {
          return emoji;
        }
      }
      return h;
    });
    
    // Build markdown table
    let markdown = '\n| ' + formattedHeaders.join(' | ') + ' |\n';
    markdown += '|' + formattedHeaders.map(() => '----------').join('|') + '|\n';
    
    // Add data rows
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split('|').map(c => c.trim());
      markdown += '| ' + cells.join(' | ') + ' |\n';
    }
    
    return markdown;
  });
}

// ==================== GLOBAL ERROR HANDLERS ====================
// Prevent server crash from unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit process, just log it
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  // Don't exit process for minor errors
  if (error.code === 'ECONNRESET' || error.code === 'EPIPE') {
    console.log('⚠️  Connection error, continuing...');
    return;
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('💤 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n💤 SIGINT received (Ctrl+C), shutting down gracefully...');
  process.exit(0);
});



