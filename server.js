require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const { google } = require('googleapis');
const path = require('path');
const { generateMedicalRecordHTML } = require('./medicalRecordTemplate');

// MỚI: Công cụ render LaTeX phía server
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
// Hàm hỗ trợ: Phát hiện lỗi API key không hợp lệ hoặc hết hạn
function isInvalidApiKeyError(err){
  const msg = (err && (err.message || err.toString())) || '';
  return /API key expired|API_KEY_INVALID|invalid api key/i.test(msg);
}
// Tùy chọn: Tùy chỉnh năm sinh hiển thị trong phần giới thiệu bản thân
const APP_BIRTH_YEAR = process.env.APP_BIRTH_YEAR || '2025';

// Lịch sử phiên tạm thời cho người dùng chưa đăng nhập
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

// Phát hiện câu hỏi toán học để điều chỉnh timeout và hành vi model
function isMathy(text=''){
  const t = String(text).toLowerCase();
  return /(\bgiải\b|=|\+|\-|\*|\^|\\frac|\\sqrt|\d\s*[a-z]|\bx\b|\by\b)/i.test(t);
}

function isWeatherQuery(text=''){
  const t = String(text).toLowerCase();
  return /(\bthời tiết\b|\bweather\b|\bnhiệt độ\b|\btemperature\b|\bmưa\b|\brain\b|\bnắng\b|\bsunny\b|\bmây\b|\bcloud\b|\bgió\b|\bwind\b|\bđộ ẩm\b|\bhumidity\b)/i.test(t);
}

// Phát hiện hình ảnh y tế (X-quang, MRI, CT, PET scan) từ tên file hoặc nội dung message
function detectMedicalImage(files = [], message = '') {
  const imagingKeywords = /\b(x-?quang|x-?ray|xquang|mri|ct\s*scan|ct|pet\s*scan|pet|siêu âm|ultrasound|chụp cắt lớp|chụp chiếu|phim chụp|imaging|radiolog)\b/i;
  
  // Kiểm tra message
  if (imagingKeywords.test(message)) {
    return true;
  }
  
  // Kiểm tra tên file
  for (const file of files) {
    if (file.originalname && imagingKeywords.test(file.originalname)) {
      return true;
    }
  }
  
  return false;
}

// Cảnh báo cho hình ảnh y tế ở chế độ Chat/Diagnose
function getMedicalImageWarning(lang = 'vi') {
  if (lang === 'vi') {
    return `\n\n🔴 **CẢNH BÁO QUAN TRỌNG:**\n⚠️ **Không dựa vào thông tin từ AI hoặc Internet để tự chẩn đoán tại nhà.**\n\nKết quả phân tích hình ảnh y tế từ AI chỉ mang tính tham khảo và có thể không chính xác. Bạn **BẮT BUỘC** phải:\n- Tham khảo ý kiến bác sĩ có chuyên môn\n- Được bác sĩ khám trực tiếp và đọc phim chính xác\n- Thực hiện các xét nghiệm bổ sung nếu cần\n\n📍 Hãy đến cơ sở y tế để được đánh giá và chẩn đoán y tế chính xác nhất!`;
  }
  return `\n\n🔴 **IMPORTANT WARNING:**\n⚠️ **Do not rely on AI or Internet information for self-diagnosis at home.**\n\nMedical image analysis from AI is for reference only and may not be accurate. You **MUST**:\n- Consult a qualified medical doctor\n- Get examined in person and have images read by a doctor\n- Undergo additional tests if needed\n\n📍 Please visit a medical facility for accurate medical evaluation and diagnosis!`;
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

// === Đồng bộ Google Drive cho users.json ===
const { readUsersData, updateUsersData } = require('./driveJsonService');
const DRIVE_USERS_FILE_ID = process.env.DRIVE_USERS_FILE_ID || '1ame57YNTu-GADOjVxeUtoK7cy0VZmvDj';

// === Hàm hỗ trợ khởi tạo Google Drive client ===
async function getDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH, // Đường dẫn file JSON
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

// Đọc danh sách users từ Google Drive (nếu có fileId), fallback về file local nếu lỗi
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

// Ghi danh sách users lên Google Drive (nếu có fileId), đồng thời ghi file local
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
// Tìm người dùng theo username
async function findUserByUsername(username) {
  if (!username) return null;
  const users = await readUsers();
  return users.find(u => u.username && u.username.toLowerCase() === username.toLowerCase()) || null;
}
// Thêm một entry vào lịch sử của người dùng, giới hạn số lượng tối đa
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
// Lấy lịch sử chat gần đây của người dùng, giới hạn số lượng và ký tự
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

// Tìm kiếm hướng dẫn y tế từ ClinicalTrials.gov và PubMed
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

// === HỆ THỐNG BỘ NHớ NGƯỜI DÙNG ===
// Bộ nhớ người dùng lưu trữ thông tin đã chia sẻ
const userMemories = new Map(); // username -> { summary: string, facts: [] }

// Lấy thông tin bộ nhớ của người dùng
function getUserMemory(username) {
  if (!username) return null;
  return userMemories.get(username) || null;
}

// Trích xuất và ghép thông tin mới vào bộ nhớ người dùng
function mergeFactsIntoMemory(username, newMessage) {
  if (!username) return;
  
  const current = userMemories.get(username) || { summary: '', facts: [] };
  
  // Trích xuất thông tin quan trọng từ tin nhắn
  const importantPatterns = [
    /tên (?:của )?tôi là ([^\.,]+)/i,
    /(?:tôi|mình) (?:là|tên) ([^\.,]+)/i,
    /(?:tôi|mình) (?:thích|yêu|quan tâm) ([^\.,]+)/i,
    /(?:tôi|mình) (?:bị|mắc|có) (?:bệnh |triệu chứng )?([^\.,]+)/i,
  ];
  
  for (const pattern of importantPatterns) {
    const match = newMessage.match(pattern);
    if (match && match[1]) {
      const fact = match[0].trim();
      if (!current.facts.includes(fact)) {
        current.facts.push(fact);
      }
    }
  }
  
  // Giới hạn số lượng facts
  if (current.facts.length > 20) {
    current.facts = current.facts.slice(-20);
  }
  
  // Tạo summary từ facts
  if (current.facts.length > 0) {
    current.summary = 'Thông tin đã biết về người dùng:\n' + current.facts.join('\n');
  }
  
  userMemories.set(username, current);
}

// === HỆ THỐNG TÌM KIẾM THỜI GIAN THỰC ===
async function searchRealTimeInfo(query) {
  // Placeholder function - có thể tích hợp với Google Search API hoặc SerpAPI
  // Hiện tại trả về empty để tránh lỗi
  try {
    // CẦN LÀM: Triển khai tìm kiếm thời gian thực với Google Custom Search API
    // const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
    //   params: {
    //     key: process.env.GOOGLE_SEARCH_API_KEY,
    //     cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
    //     q: query,
    //     num: 3
    //   }
    // });
    // return response.data.items || [];
    return null;
  } catch (err) {
    console.warn('Real-time search not implemented:', err.message);
    return null;
  }
}

// Phân tích kết quả chẩn đoán từ văn bản trả về
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

// Làm giàu thông tin chẩn đoán với mô tả từ bộ mã ICD
function enrichWithICDDescriptions(diagnoses) {
  return diagnoses.map(entry => {
    const icdCodeMatch = entry.match(/\((.*?)\)$/);
    const icdCode = icdCodeMatch ? icdCodeMatch[1] : null;
    const description = icdCode && icdData[icdCode] ? icdData[icdCode].name : null;
    return { label: entry, icdCode, description: description || 'Không tìm thấy trong dữ liệu ICD' };
  });
}

// MỚI: Hàm hỗ trợ pre-render LaTeX phía server
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
  // Kiểm tra nhanh
  if (!/[\\$]/.test(text)) return escapeHtml(text).replace(/\n/g, '<br>');
  try {
    // Gộp các dấu dollar lặp lại (ví dụ: $$$ -> $)
    let src = String(text).replace(/\${3,}/g, '$');

    // Chuẩn hóa phân số đơn giản như a/b hoặc (a+b)/(c+d) thành \frac{a}{b}
    function normalizeSimpleFraction(s){
      try {
        const str = String(s || '').trim();
        if (!str || str.indexOf('/') === -1) return str;
        if (/\\(frac|dfrac|tfrac)\b/.test(str)) return str; // đã có frac rồi
        // Trường hợp 1: (A)/(B)
        let m = str.match(/^\(\s*([^()]+?)\s*\)\s*\/\s*\(\s*([^()]+?)\s*\)$/s);
        if (m) return `\\frac{${m[1]}}{${m[2]}}`;
        // Case 2: A/B where A,B are simple tokens (numbers/letters/dots)
        m = str.match(/^([A-Za-z0-9.+-]+)\s*\/\s*([A-Za-z0-9.+-]+)$/);
        if (m) return `\\frac{${m[1]}}{${m[2]}}`;
        return str;
      } catch (_) { return s; }
    }

    // regex để khớp $...$, \[...\], hoặc \(...\) (tránh dấu $ đơn để giảm false positives)
    const re = /(\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\))/g;
    let lastIndex = 0;
    let out = '';
    let m;
    while ((m = re.exec(src)) !== null) {
      const idx = m.index;
      // Thêm phần text không phải toán học đã escape
      if (idx > lastIndex) {
        out += escapeHtml(src.slice(lastIndex, idx)).replace(/\n/g, '<br>');
      }
      const latex = m[2] || m[3] || m[4] || m[5] || '';
      const display = !!(m[2] || m[3]);
      let rendered = '';
      try {
        // Heuristic: tránh KaTeX khi nội dung không phải toán và chứa Unicode (ví dụ tiếng Việt)
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
        // fallback: escape và giữ nguyên delimiter gốc
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


// Hàm hỗ trợ: Chọn model với fallback
function selectModelIds(requested) {
  // Ưu tiên các phiên bản ổn định, hỗ trợ rộng rãi trên v1beta
  // Sử dụng biến thể -latest để khớp với kết quả ListModels và tránh lỗi 404
  return {
    primary: 'gemini-1.5-flash-latest',
    fallback: 'gemini-1.5-pro-latest'
  };
}

// Cập nhật bảng tên hiển thị bao gồm các fallback
const DISPLAY_NAME_MAP = {
  // Mặc định hiện tại
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
  // Các key cũ (giữ để tương thích nếu có tham chiếu)
  'gemini-1.5-flash-latest': 'Jaremis-1.5-flash',
  'gemini-1.5-pro-latest': 'Jaremis-1.5-pro',
  'gemini-1.5-flash': 'Jaremis-1.5-flash',
  'gemini-1.5-pro': 'Jaremis-1.5-pro',
  'gemini-1.5-flash-8b-latest': 'Jaremis-1.5-flash-8b',
  'gemini-1.5-flash-8b': 'Jaremis-1.5-flash-8b'
};

// Phát hiện và chọn model động để tránh lỗi 404 khi phiên bản API/model không được hỗ trợ
const MODEL_PREFS = {
  flash: [
    'gemini-2.5-flash-latest',
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b-latest',
    'gemini-1.5-flash-8b',
    'gemini-pro'
  ],
  pro: [
    'gemini-2.5-pro-latest',
    'gemini-2.5-pro',
    'gemini-1.5-pro-latest',
    'gemini-1.5-pro',
    'gemini-2.0-pro-exp',
    'gemini-2.0-pro',
    'gemini-pro'
  ],
  vision: [
    'gemini-2.5-flash-latest',
    'gemini-2.5-flash',
    'gemini-1.5-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.0-flash-exp',
    'gemini-2.0-flash',
    'gemini-1.5-flash-8b-latest',
    'gemini-1.5-flash-8b',
    'gemini-pro-vision',
    'gemini-pro'
  ]
};

let _modelCache = { when: 0, names: new Set(), supports: {} };
// Lấy danh sách các model khả dụng từ API, cache kết quả 10 phút
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
        // Chuẩn hóa: loại bỏ prefix 'models/' để ID khớp với danh sách ưu tiên
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

// Giải quyết model IDs phù hợp nhất với yêu cầu và năng lực hệ thống
async function resolveModelIds(requested = 'flash', needVision = false) {
  // fallback mặc định nếu list thất bại
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

// Lấy danh sách các model ứng viên theo thứ tự ưu tiên
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
    const newUser = { 
      id: Date.now(), 
      username, 
      email, 
      passwordHash: hash, 
      createdAt: new Date().toISOString(), 
      history: [],
      // Hệ thống phân quyền
      accountType: 'normal', // 'normal' | 'doctor'
      verificationStatus: 'unverified', // 'unverified' | 'pending' | 'verified' | 'rejected'
      verificationData: null // { medicalLicenseNumber, workplace, documents, submittedAt, reviewedAt, reviewedBy, rejectionReason }
    };
    users.push(newUser); await saveUsers(users);
    return res.json({ success: true, user: { username: newUser.username, email: newUser.email, accountType: newUser.accountType, verificationStatus: newUser.verificationStatus } });
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
    return res.json({ 
      success: true, 
      user: { 
        username: user.username, 
        email: user.email,
        accountType: user.accountType || 'normal',
        verificationStatus: user.verificationStatus || 'unverified'
      } 
    });
  } catch (e) { console.error('Login error:', e); return res.status(500).json({ error: 'Lỗi server khi đăng nhập' }); }
});

// Kiểm tra xem tên đăng nhập có khả dụng không
app.get('/api/check-username', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    
    const users = await readUsers();
    const exists = users.some(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    
    return res.json({ available: !exists, username });
  } catch (e) {
    console.error('Check username error:', e);
    return res.status(500).json({ error: 'Lỗi server khi kiểm tra username' });
  }
});

/* --------------------------
   DOCTOR VERIFICATION ENDPOINTS
   -------------------------- */

// Submit verification request (gửi yêu cầu xác minh bác sĩ)
app.post('/api/verify-doctor/submit', upload.array('documents'), async (req, res) => {
  try {
    const { username, medicalLicenseNumber, workplace, email } = req.body;
    const files = req.files || [];

    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    if (!medicalLicenseNumber) return res.status(400).json({ error: 'Vui lòng cung cấp số giấy phép hành nghề' });
    if (!workplace && !email) return res.status(400).json({ error: 'Vui lòng cung cấp nơi công tác hoặc email cơ sở y tế' });

    const users = await readUsers();
    const userIndex = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    const user = users[userIndex];

    // Lưu thông tin xác minh
    const verificationData = {
      medicalLicenseNumber,
      workplace: workplace || '',
      workplaceEmail: email || '',
      documents: files.map(f => ({
        filename: f.filename,
        originalname: f.originalname,
        path: f.path,
        mimetype: f.mimetype,
        size: f.size
      })),
      submittedAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      rejectionReason: null
    };

    user.accountType = 'doctor';
    user.verificationStatus = 'pending';
    user.verificationData = verificationData;

    users[userIndex] = user;
    await saveUsers(users);

    return res.json({ 
      success: true, 
      message: 'Yêu cầu xác minh đã được gửi. Chúng tôi sẽ xem xét trong vòng 24-48 giờ.',
      verificationStatus: 'pending'
    });
  } catch (e) {
    console.error('Verify doctor submit error:', e);
    // Xóa file đã upload nếu có lỗi
    try { (req.files || []).forEach(f => { if (fs.existsSync(f.path)) fs.unlinkSync(f.path); }); } catch(e){}
    return res.status(500).json({ error: 'Lỗi server khi gửi yêu cầu xác minh' });
  }
});

// Get verification status (kiểm tra trạng thái xác minh)
app.get('/api/verify-doctor/status', async (req, res) => {
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });

    const user = await findUserByUsername(username);
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    return res.json({
      accountType: user.accountType || 'normal',
      verificationStatus: user.verificationStatus || 'unverified',
      canUseProfessional: user.accountType === 'doctor' && user.verificationStatus === 'verified',
      verificationData: user.verificationData ? {
        submittedAt: user.verificationData.submittedAt,
        reviewedAt: user.verificationData.reviewedAt,
        rejectionReason: user.verificationData.rejectionReason
      } : null
    });
  } catch (e) {
    console.error('Get verification status error:', e);
    return res.status(500).json({ error: 'Lỗi server khi kiểm tra trạng thái xác minh' });
  }
});

// Admin: Approve verification (chỉ dành cho admin - cần thêm authentication sau)
app.post('/api/verify-doctor/approve', async (req, res) => {
  try {
    const { username, adminKey } = req.body;
    
    // Simple admin key check (nên thay bằng JWT authentication trong production)
    const ADMIN_KEY = process.env.ADMIN_VERIFICATION_KEY || 'JAREMIS_ADMIN_2025';
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Không có quyền thực hiện thao tác này' });

    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });

    const users = await readUsers();
    const userIndex = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    const user = users[userIndex];
    if (!user.verificationData) return res.status(400).json({ error: 'Tài khoản chưa gửi yêu cầu xác minh' });

    user.verificationStatus = 'verified';
    user.verificationData.reviewedAt = new Date().toISOString();
    user.verificationData.reviewedBy = 'admin';

    users[userIndex] = user;
    await saveUsers(users);

    return res.json({ success: true, message: 'Đã phê duyệt yêu cầu xác minh bác sĩ' });
  } catch (e) {
    console.error('Approve verification error:', e);
    return res.status(500).json({ error: 'Lỗi server khi phê duyệt xác minh' });
  }
});

// Admin: Reject verification
app.post('/api/verify-doctor/reject', async (req, res) => {
  try {
    const { username, adminKey, reason } = req.body;
    
    const ADMIN_KEY = process.env.ADMIN_VERIFICATION_KEY || 'JAREMIS_ADMIN_2025';
    if (adminKey !== ADMIN_KEY) return res.status(403).json({ error: 'Không có quyền thực hiện thao tác này' });

    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    if (!reason) return res.status(400).json({ error: 'Vui lòng cung cấp lý do từ chối' });

    const users = await readUsers();
    const userIndex = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (userIndex === -1) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    const user = users[userIndex];
    if (!user.verificationData) return res.status(400).json({ error: 'Tài khoản chưa gửi yêu cầu xác minh' });

    user.verificationStatus = 'rejected';
    user.verificationData.reviewedAt = new Date().toISOString();
    user.verificationData.reviewedBy = 'admin';
    user.verificationData.rejectionReason = reason;

    users[userIndex] = user;
    await saveUsers(users);

    return res.json({ success: true, message: 'Đã từ chối yêu cầu xác minh' });
  } catch (e) {
    console.error('Reject verification error:', e);
    return res.status(500).json({ error: 'Lỗi server khi từ chối xác minh' });
  }
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

// Phát hiện trả lời nhanh cho câu hỏi rất đơn giản
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
   NEW: Chat endpoint (general conversation) - with multer support
   -------------------------- */
app.post('/api/chat', upload.array('images'), async (req, res) => {
  try {
    // Truy cập an toàn req.body - xử lý cả JSON và FormData
    const body = req.body || {};
    const message = (body.message || '').toString().trim();
    const files = req.files || [];
    
    // Xác thực đầu vào
    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Vui lòng nhập tin nhắn hoặc đính kèm ảnh' });
    }
    
    const requestedModel = (body.model || 'flash').toLowerCase();
    const ids = await resolveModelIds(requestedModel, files.length > 0);
    let modelId = ids.primary;
    let displayModel = DISPLAY_NAME_MAP[modelId] || modelId;

    const submittedBy = body.submittedBy || null;
    const sessionId = body.sessionId || null;
    const includeHistory = body.includeHistory !== false;

    const forcedLang = (body.lang || body.forceLang || '').toLowerCase();
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

    // Build history section from blocks
    const historySection = historyBlocks.length > 0
      ? `\n[LỊCH SỬ HỘI THOẠI GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
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

    // Phát hiện chủ đề nhạy cảm (y tế, tâm lý)
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';

    // LƯU Ý: System prompt đã được làm sạch và tối ưu hóa
    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu) và ANT (Đỗ Văn Vĩnh An). Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.

⚕️ **QUAN TRỌNG - CHÍNH SÁCH THUỐC (MEDICATION POLICY):**
- TUYỆT ĐỐI KHÔNG gợi ý, đề xuất, khuyến nghị bất kỳ loại thuốc nào (tên thương mại, generic, OTC, prescription) trừ khi người dùng HỎI TRỰC TIẾP về thuốc cho bệnh cụ thể (VD: "bị cảm mua thuốc gì?", "viêm họng uống thuốc gì?")
- Thay vào đó, tập trung vào:
  • Hướng dẫn đi bác sĩ ngay (khoa nào, chuyên môn gì)
  • Gợi ý xét nghiệm cần làm để chẩn đoán chính xác
  • Biện pháp an toàn tại nhà (nghỉ ngơi, dinh dưỡng, theo dõi triệu chứng)
- TRƯỜNG HỢP ĐẶC BIỆT: Nếu người dùng hỏi TRỰC TIẾP về thuốc ("mua thuốc gì", "dùng thuốc gì") thì MỚI cung cấp, nhưng BẮT BUỘC phải kèm:
  
  🔴 **CẢNH BÁO QUAN TRỌNG:**
  ⚠️ **KHÔNG TỰ Ý MUA/DÙNG THUỐC NÀY NẾU KHÔNG CÓ:**
  - Chỉ định rõ ràng từ bác sĩ
  - Xét nghiệm xác định bệnh
  - Tư vấn về liều lượng phù hợp
  
  🚫 **CHỐNG CHỈ ĐỊNH (Không dùng cho):**
  [Liệt kê đầy đủ: phụ nữ có thai/cho con bú, trẻ em dưới X tuổi, người suy gan/thận, dị ứng thành phần...]
  
  ⚡ **TÁC DỤNG PHỤ CÓ THỂ GẶP:**
  [Liệt kê đầy đủ]
  
  💊 **KHUYẾN CÁO:** Đến bác sĩ/dược sĩ để được tư vấn trước khi mua!

MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
4.5. QUAN TRỌNG: Luôn ưu tiên thông tin từ [THÔNG TIN MỚI NHẤT TỪ WEB] nếu có - đây là dữ liệu real-time mới nhất.
4.6. Khi có thông tin conflicting giữa knowledge cũ vs web data mới → luôn dùng web data mới và ghi rõ "theo thông tin mới nhất"
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. KHÔNG đưa phác đồ điều trị, liều thuốc chi tiết (trừ khi người dùng hỏi trực tiếp - xem policy thuốc bên trên).
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

**📊 QUAN TRỌNG - BẢNG MARKDOWN**
Khi cần hiển thị dữ liệu có cấu trúc (thời tiết, so sánh, thống kê, lịch trình):
PHẢI dùng bảng markdown theo format SAU (có khoảng trắng 2 bên ký tự |):

| Cột 1 | Cột 2 | Cột 3 |
|-------|-------|-------|
| Dữ liệu 1 | Dữ liệu 2 | Dữ liệu 3 |
| Dữ liệu 4 | Dữ liệu 5 | Dữ liệu 6 |

VÍ DỤ BẢNG THỜI TIẾT:

| Thời gian | Nhiệt độ | Trời | Độ ẩm | Gió |
|-----------|----------|------|-------|-----|
| 16:00 | 30°C | ☀️ Nắng nhe | 68% | 2.0 m/s Đông Bắc ↗ |
| 19:00 | 28°C | ☁️ Ít mây | 75% | 1.8 m/s Đông |
| 22:00 | 26°C | ☁️ Mây rải rác | 80% | 1.5 m/s Đông |

**⚠️ Lưu ý quan trọng**: Format đẹp mắt, dễ đọc, PHẢI có khoảng trắng 2 bên ký tự |
**🎯 Kết luận**: Tóm tắt ngắn gọn

- Emoji phù hợp (🔍📋💡📊⚠️🎯🚀💪🌟✨📝🔧⭐☀️☁️🌧️❄️🌡️💨)
- Spacing tốt giữa các section (2 dòng trống giữa mục lớn)
- Tránh quá nhiều cấp phân level
- LUÔN dùng bảng markdown cho dữ liệu có cấu trúc`;

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

    // Timeout nghiêm ngặt cho flash
    // Xử lý ảnh cho endpoint chat
    const imageParts = files.length > 0 ? await Promise.all(files.map(async file => ({ 
      inlineData: { 
        data: fs.readFileSync(file.path).toString('base64'), 
        mimeType: file.mimetype 
      } 
    }))) : [];
    const contentParts = [fullPrompt, ...imageParts];
    const doGenerate = async (id) => {
      const model = genAI.getGenerativeModel({ model: id });
      const timeoutMs = computeHardLimitMs(id, message);
      return Promise.race([
        model.generateContent(contentParts),
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

    // Phát hiện hình ảnh y tế và thêm cảnh báo cho chế độ Chat
    const hasMedicalImage = detectMedicalImage(files, message);
    const medicalImageWarning = hasMedicalImage ? getMedicalImageWarning(userLang) : '';
    const finalReply = assistantText + medicalImageWarning;

    // Server-side pre-render LaTeX to sanitized HTML and include it in the response
    let replyHtml = null;
    try { replyHtml = renderLatexInText(finalReply); } catch (e) { replyHtml = null; }

    // Sau khi có assistantText:
    if (submittedBy) {
      mergeFactsIntoMemory(submittedBy, message);
      const entry = {
        id: Date.now(),
        sessionId: sessionId || ('legacy-' + Date.now()), // gán session cho entry
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: finalReply,
        modelUsed: displayModel,
        detectedLang: userLang,
        langScore: detected.score,
        hasMedicalImage: hasMedicalImage
      };
      try { pushUserHistory(submittedBy, entry); } catch (e) { console.warn('Không lưu history chat', e); }
    } else if (sessionId) {
      const entry = { id: Date.now(), sessionId, type: 'chat', timestamp: new Date().toISOString(), input: message, reply: finalReply, modelUsed: displayModel, detectedLang: userLang, langScore: detected.score, hasMedicalImage: hasMedicalImage };
      pushSessionHistory(sessionId, entry);
    }

    return res.json({
      success: true,
      reply: finalReply,
      replyHtml: replyHtml,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      usedMemory: !!(memory && memory.summary),
      sensitive: isSensitive,
      hasMedicalImageWarning: hasMedicalImage,
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
// LƯU Ý: Dùng GET cho SSE (EventSource chỉ hỗ trợ GET). Vẫn đọc param linh hoạt để
// nếu có POST gửi nhầm (legacy) thì vẫn hoạt động được.
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
        model.generateContent(contentParts),
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
// LƯU Ý: Dùng GET cho SSE (EventSource chỉ hỗ trợ GET). Vẫn đọc param linh hoạt để
// nếu có POST gửi nhầm (legacy) thì vẫn hoạt động được.
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
        model.generateContent(contentParts),
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

    const prompt = `Đóng vai bác sĩ chuyên khoa hỗ trợ chẩn đoán cho BỆNH NHÂN.
Tên là JAREMIS-AI

⚕️ **QUAN TRỌNG - CHÍNH SÁCH THUỐC:**
- TUYỆT ĐỐI KHÔNG đề xuất, gợi ý bất kỳ loại thuốc nào (kể cả OTC, prescription drugs, supplements)
- KHÔNG đưa tên thuốc (generic, thương mại), liều lượng, phác đồ điều trị
- Thay vào đó TẬP TRUNG VÀO:
  • Hướng dẫn ĐI BÁC SĨ ngay (khoa nào? chuyên khoa gì?)
  • Gợi ý XÉT NGHIỆM cần làm để chẩn đoán chính xác
  • Biện pháp an toàn tại nhà (nghỉ ngơi, dinh dưỡng, theo dõi triệu chứng)
  • Dấu hiệu nguy hiểm cần đến cấp cứu ngay

TRỪ KHI: Người dùng HỎI TRỰC TIẾP về thuốc cho bệnh cụ thể (VD: "bệnh này mua thuốc gì?"), khi đó MỚI cung cấp nhưng BẮT BUỘC kèm:

🔴 **CẢNH BÁO ĐỎ:**
⚠️ KHÔNG TỰ Ý MUA/DÙNG CÁC THUỐC TRÊN NẾU KHÔNG CÓ:
- Chỉ định rõ ràng từ bác sĩ có chuyên môn
- Xét nghiệm xác định chính xác bệnh
- Tư vấn về liều lượng, thời gian điều trị phù hợp với tình trạng cá nhân

🚫 CHỐNG CHỈ ĐỊNH (Không dùng cho):
[Liệt kê chi tiết: phụ nữ mang thai/cho con bú, trẻ em <X tuổi, người bệnh gan/thận, dị ứng...]

⚡ TÁC DỤNG PHỤ: [Liệt kê đầy đủ]

Phân tích theo hướng dẫn WHO:

**Dữ liệu bệnh nhân:**
${labResults ? `- Triệu chứng/Xét nghiệm: ${labResults}\n` : ''}
${files.length ? `- Hình ảnh y tế: [${files.length} ảnh]` : ''}

**YÊU CẦU PHÂN TÍCH - ĐỊNH DẠNG ĐẸP:**

## 🏥 1. CHẨN ĐOÁN PHÂN BIỆT
Liệt kê 3-5 chẩn đoán khả thi với ICD-10 codes:

| 🏥 Chẩn đoán | Mã ICD-10 | Xác suất | Triệu chứng khớp |
|-------------|-----------|----------|------------------|
| **[Bệnh 1]** | [Mã] | [%] ⭐⭐⭐ | [Chi tiết] |
| **[Bệnh 2]** | [Mã] | [%] ⭐⭐ | [Chi tiết] |

## 📊 2. ĐÁNH GIÁ TỔNG QUAN
- Độ tin cậy chẩn đoán: XX%
- Mức độ nguy hiểm: Thấp/Trung bình/Cao/Khẩn cấp
- Khuyến nghị: Đi bác sĩ ngay/trong 24h/trong tuần

## 🔬 3. XÉT NGHIỆM ĐỀ XUẤT
PHẢI dùng bảng markdown đẹp:

| 🔬 Xét nghiệm | Mục đích | Độ ưu tiên | Chi phí ước tính (VNĐ) |
|-------------|----------|------------|----------------------|
| **Công thức máu** | Phát hiện nhiễm trùng | 🔴 Khẩn cấp | ~100,000 |
| **[XN 2]** | [Mục đích] | 🟡 Sớm | [Chi phí] |

## 🏥 4. HƯỚNG DẪN ĐI BÁC SĨ
- **Khoa khám:** [Tên khoa cụ thể]
- **Chuyên khoa:** [Nếu cần]
- **Thời gian:** [Ngay/trong 24h/tuần tới]
- **Lý do:** [Giải thích]

## ⚠️ 5. DẤU HIỆU NGUY HIỂM - CẦN CẤP CỨU NGAY
- 🚨 [Dấu hiệu 1]
- 🚨 [Dấu hiệu 2]

## 💡 6. BIỆN PHÁP AN TOÀN TẠI NHÀ
- Nghỉ ngơi: [Chi tiết]
- Dinh dưỡng: [Gợi ý]
- Theo dõi: [Triệu chứng cần theo dõi]

## 📚 7. CĂN CỨ KHOA HỌC
- Hướng dẫn WHO: [Tên và phiên bản]
- Guidelines khác: [Nếu có]

**NHẮC LẠI:** Kết quả chỉ mang tính tham khảo. Hãy đến bác sĩ để được khám, xét nghiệm và điều trị chính xác!

---

**ĐỊNH DẠNG:**
- PHẢI dùng emoji: 🏥📊🔬⚠️💡📚🚨
- PHẢI dùng bảng markdown cho Chẩn đoán, Xét nghiệm
- Spacing đẹp: 2 dòng trống giữa các mục lớn
- TRÁNH: ═█░▓▒╔╗║
- KHÔNG đề xuất thuốc trừ khi người dùng hỏi trực tiếp`;

    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await model.generateContent([prompt, ...imageParts]);
    const response = await result.response;
    const diagnosisText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Phát hiện hình ảnh y tế và thêm cảnh báo cho chế độ Diagnose
    const hasMedicalImage = detectMedicalImage(files, labResults);
    const medicalImageWarning = hasMedicalImage ? getMedicalImageWarning('vi') : '';
    const finalDiagnosisText = diagnosisText + medicalImageWarning;

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
      diagnosis: finalDiagnosisText,
      hasMedicalImage: hasMedicalImage
    };
    if (submittedBy) {
      try { pushUserHistory(submittedBy, historyEntry); } catch (e) { console.warn('Không lưu được lịch sử cho user', submittedBy); }
    }

    files.forEach(file => { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch(e){} });

    res.json({
      modelUsed: displayModel,
      ...parsedData,
      diagnosis: finalDiagnosisText,
      diagnosisHtml: renderLatexInText(finalDiagnosisText),
      references: references.slice(0,3),
      icdDescriptions: parsedData.differentialDiagnosisFull,
      hasMedicalImageWarning: hasMedicalImage,
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

/* --------------------------
   Professional endpoint - Enhanced diagnosis with patient information
   -------------------------- */
app.post('/api/professional', upload.array('images'), async (req, res) => {
  try {
    // KIỂM TRA QUYỀN TRUY CẬP - CHẾ ĐỘ PROFESSIONAL CHỈ CHO BÁC SĨ ĐÃ XÁC MINH
    const submittedBy = req.body.submittedBy || null;
    
    if (!submittedBy) {
      return res.status(403).json({ 
        error: 'Vui lòng đăng nhập để sử dụng chế độ Professional',
        requireLogin: true 
      });
    }

    const user = await findUserByUsername(submittedBy);
    if (!user) {
      return res.status(403).json({ 
        error: 'Tài khoản không tồn tại',
        requireLogin: true 
      });
    }

    // Kiểm tra accountType và verificationStatus
    const accountType = user.accountType || 'normal';
    const verificationStatus = user.verificationStatus || 'unverified';

    if (accountType !== 'doctor' || verificationStatus !== 'verified') {
      const messages = {
        'unverified': 'Chế độ Professional chỉ dành cho bác sĩ đã xác minh. Vui lòng gửi yêu cầu xác minh với giấy phép hành nghề hoặc email cơ sở y tế.',
        'pending': 'Yêu cầu xác minh của bạn đang được xem xét. Vui lòng đợi trong 24-48 giờ.',
        'rejected': `Yêu cầu xác minh của bạn đã bị từ chối. ${user.verificationData?.rejectionReason || 'Vui lòng liên hệ hỗ trợ để biết thêm thông tin.'}`
      };

      return res.status(403).json({ 
        error: messages[verificationStatus] || messages['unverified'],
        accountType,
        verificationStatus,
        requireVerification: true
      });
    }

    const message = req.body.message || req.body.labResults || req.body.symptoms || '';
    const files = req.files || [];
    const patientInfo = req.body.patientInfo ? JSON.parse(req.body.patientInfo) : null;
    
    console.log('🏥 Professional endpoint called');
    console.log('📝 Message:', message);
    console.log('👤 Patient info:', patientInfo);
    console.log('📷 Images:', files.length);
    console.log('👨‍⚕️ Verified doctor:', submittedBy);
    
    if (!message && files.length === 0) {
      return res.status(400).json({ error: 'Vui lòng cung cấp thông tin triệu chứng hoặc hình ảnh' });
    }

    // Kiểm tra kích thước file
    const MAX_FILE_BYTES = 4 * 1024 * 1024;
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) {
        files.forEach(ff => { try { if (fs.existsSync(ff.path)) fs.unlinkSync(ff.path); } catch(e){} });
        return res.status(400).json({ error: `Kích thước ảnh '${f.originalname}' vượt quá giới hạn 4MB` });
      }
    }

    const requestedModel = (req.body.model || 'pro').toLowerCase();
    const ids = await resolveModelIds(requestedModel, files.length > 0);
    const modelId = ids.primary;
    const displayModel = DISPLAY_NAME_MAP[modelId] || modelId;

    // Xử lý hình ảnh
    const imageParts = await Promise.all(files.map(async file => ({ 
      inlineData: { 
        data: fs.readFileSync(file.path).toString('base64'), 
        mimeType: file.mimetype 
      } 
    })));

    // Search medical guidelines
    const references = await searchMedicalGuidelines(message);

    // Xây dựng bối cảnh bệnh nhân chi tiết
    let patientContext = '';
    if (patientInfo) {
      patientContext = `
**THÔNG TIN BỆNH NHÂN:**
- Họ tên: ${patientInfo.name || 'Không rõ'}
- Tuổi: ${patientInfo.age || 'Không rõ'}
- Giới tính: ${patientInfo.gender || 'Không rõ'}
- Cân nặng: ${patientInfo.weight ? patientInfo.weight + ' kg' : 'Không rõ'}
- Chiều cao: ${patientInfo.height ? patientInfo.height + ' cm' : 'Không rõ'}
- Tiền sử bệnh: ${patientInfo.medicalHistory || 'Không có'}
- Dị ứng: ${patientInfo.allergies || 'Không có'}
- Thuốc đang dùng: ${patientInfo.currentMedications || 'Không có'}
- Ngày bắt đầu triệu chứng: ${patientInfo.symptomsStartDate || 'Không rõ'}
`;
    }

    const prompt = `Bạn là TRỢ LÝ Y KHOA CHUYÊN NGHIỆP (Medical AI Assistant) của JAREMIS-AI.

**VAI TRÒ:** Viết BẢN TƯ VẤN Y KHOA (Medical Consultation Report) gửi đến Bác Sĩ điều trị.

**ĐỊNH DẠNG BẮT BUỘC - QUAN TRỌNG:**

🎯 **BẮT ĐẦU bằng lời chào:**
\`\`\`
Kính gửi Bác Sĩ [Tên khoa/chuyên môn],

Tôi xin gửi đến quý Bác Sĩ báo cáo tư vấn y khoa chi tiết cho bệnh nhân như sau:
\`\`\`

📋 **SỬ DỤNG MARKDOWN FORMAT ĐẸP MẮT:**
- Heading chính: \`## 📊 TIÊU ĐỀ CHÍNH\`
- Subheading: \`### 🔬 Tiêu đề phụ\`
- Text: **bold**, *italic*, \`code\`
- Spacing: 2 dòng trống giữa các mục lớn, 1 dòng giữa các mục nhỏ
- Emoji: 📊 📋 🔬 💊 ⚠️ 📚 🏥 🎯 ✅ ❌ 🩺 💉

📊 **BẢNG MARKDOWN - BẮT BUỘC:**
VÍ DỤ format bảng đẹp (PHẢI dùng cho Chẩn đoán phân biệt, Xét nghiệm, Thuốc):

| 🏥 Chẩn đoán | Mã ICD-10 | Xác suất | Triệu chứng khớp | Khuyến nghị |
|------------|-----------|----------|------------------|-------------|
| **Viêm phổi** (Pneumonia) | J18.9 | 75% ⭐⭐⭐ | Sốt, ho, khó thở | Xét nghiệm ngay |
| **Lao phổi** (Tuberculosis) | A15.0 | 20% ⭐⭐ | Ho kéo dài, sốt nhẹ | Xét nghiệm AFB |

| 🔬 Xét nghiệm | Mục đích | Độ ưu tiên | Chi phí ước tính |
|-------------|----------|------------|------------------|
| **Công thức máu** | Nhiễm trùng, thiếu máu | 🔴 Khẩn cấp | 100,000 đ |
| **X-quang phổi** | Tổn thương phổi | 🔴 Khẩn cấp | 150,000 đ |

**LƯU Ý QUAN TRỌNG:**
- TRÁNH dùng ký tự đặc biệt như ═ █ ░ ▓ ▒ ╔ ╗ ║
- PHẢI dùng bảng markdown cho: Chẩn đoán phân biệt, Xét nghiệm, Thuốc
- PHẢI có emoji phù hợp cho mỗi mục
- PHẢI có spacing đẹp (2 dòng trống giữa các mục lớn)

🎯 **KẾT THÚC bằng:**
\`\`\`
---

Trân trọng,

**JAREMIS-AI Medical Assistant**  
*Hệ thống hỗ trợ quyết định lâm sàng - Phiên bản Professional*
\`\`\`

**NGÔN NGỮ:** Chuyên môn y khoa, thuật ngữ Anh + Việt, ICD-10, guidelines.

${patientContext}

**DỮ LIỆU LÂM SÀNG:**
${message}

${files.length ? `**HÌNH ẢNH Y HỌC:** ${files.length} ảnh (X-quang/MRI/CT/PET Scan)\n` : ''}

---

**BẮT ĐẦU BÁO CÁO TƯ VẤN NGAY (Nhớ mở đầu "Kính gửi Bác Sĩ..." và format đẹp với bảng markdown):**


## 📊 1. PHÂN TÍCH HÌNH ẢNH Y HỌC

${files.length ? `*Mô tả chi tiết findings, so sánh chuẩn, radiological differential diagnosis*` : '*Không có hình ảnh y học đính kèm*'}


## 🧬 2. CHẨN ĐOÁN PHÂN BIỆT (Differential Diagnosis)

**BẮT BUỘC dùng bảng markdown:**

| 🏥 Chẩn đoán | Mã ICD-10 | Xác suất | Triệu chứng khớp | Cơ chế bệnh sinh |
|------------|-----------|----------|------------------|-----------------|
| **[Bệnh 1 VN]** ([English]) | [Mã] | [%] ⭐⭐⭐ | [Chi tiết] | [Pathophysiology ngắn] |
| **[Bệnh 2 VN]** ([English]) | [Mã] | [%] ⭐⭐ | [Chi tiết] | [Pathophysiology ngắn] |

*Giải thích chi tiết clinical correlation, prevalence, supporting evidence*


## 📊 3. ĐÁNH GIÁ XÁC SUẤT

| 🎯 Top Diagnoses | Xác suất | Độ tin cậy | Likelihood Ratio |
|----------------|----------|-----------|-----------------|
| **[Chẩn đoán 1]** | [%] | ⭐⭐⭐⭐⭐ | +LR: [#], -LR: [#] |


## 🔬 4. XÉT NGHIỆM ĐỀ XUẤT

**BẮT BUỘC dùng bảng markdown:**

| 🔬 Xét nghiệm | Mục đích | Độ ưu tiên | Chi phí (VNĐ) | Thời gian |
|-------------|----------|------------|---------------|-----------|
| **Công thức máu (CBC)** | Nhiễm trùng, thiếu máu | 🔴 Khẩn cấp | ~100,000 | 2-4h |
| **[XN 2]** | [Mục đích] | 🟡 Sớm | [Chi phí] | [TG] |


## 💊 5. GỢI Ý ĐIỀU TRỊ CHO BÁC SĨ

⚕️ **CHÍNH SÁCH:** Gợi ý thuốc cho BÁC SĨ tham khảo. BẮT BUỘC mỗi thuốc có đầy đủ thông tin an toàn.

### A. PHARMACOTHERAPY

**BẮT BUỘC dùng bảng markdown:**

| 💊 Thuốc | Liều dùng | Đường dùng | Monitoring |
|---------|-----------|------------|------------|
| **[Generic]** ([Commercial]) | [Dose/kg/day] | PO/IV/IM | [Parameters] |

**Chi tiết từng thuốc:**

#### 1. [Tên Generic] (Tên thương mại: [Commercial])

**Cơ chế:** [Mechanism]
**Liều dùng:** 
- Người lớn: [Liều]
- Trẻ em: [Liều/kg]
- Điều chỉnh suy gan/thận: [Chi tiết]
**Đường dùng:** PO/IV/IM

🚫 **CHỐNG CHỈ ĐỊNH (BẮT BUỘC):**
- Phụ nữ mang thai (trimester X) / cho con bú
- Trẻ em dưới [X] tuổi
- Suy gan/thận mức độ [X]
- Dị ứng với [thành phần]
- [Bệnh lý kèm theo cụ thể]

⚠️ **TƯƠNG TÁC THUỐC (BẮT BUỘC):**
- [Thuốc A]: [Tương tác và hậu quả]
- [Kiểm tra với thuốc đang dùng: "${patientInfo?.currentMedications || 'không rõ'}"]

⚡ **TÁC DỤNG PHỤ (BẮT BUỘC):**
- Thường gặp: [Liệt kê]
- Nghiêm trọng: [Liệt kê]

🔬 **THEO DÕI:** [Xét nghiệm, tần suất, red flags]

---

*Lưu ý: Đã kiểm tra tiền sử, dị ứng "${patientInfo?.allergies || 'không rõ'}", thuốc đang dùng "${patientInfo?.currentMedications || 'không rõ'}"*

### B. NON-PHARMACOLOGICAL:
- Lifestyle, diet, exercise, physical therapy, surgical options (nếu cần)


## ⚠️ 6. TIÊN LƯỢNG & BIẾN CHỨNG

| ⚠️ Biến chứng | Nguy cơ | Dấu hiệu cảnh báo | Xử trí |
|--------------|---------|-------------------|--------|
| **[BC]** | Cao/TB/Thấp | [Red flags] | [Emergency mgmt] |


## 📚 7. CĂN CỨ KHOA HỌC

*Guidelines: WHO, CDC, ESC... | RCTs, meta-analyses | Level: Grade A/B/C*


## 🏥 8. KHUYẾN NGHỊ QUẢN LÝ

| 🏥 Khuyến nghị | Chi tiết |
|---------------|----------|
| **Quản lý** | ☑️ Nội trú / ☐ Ngoại trú |
| **Chuyên khoa** | [Nếu cần] |
| **Tái khám** | [Schedule] |


## 🎓 9. ĐIỂM HỌC THUẬT BỔ SUNG

*Pathophysiology, epidemiology, genetic basis, pearls & pitfalls*

---

**NHẮC QUAN TRỌNG:**
- ✅ Bảng markdown cho Chẩn đoán, Xét nghiệm, Thuốc
- ✅ Spacing: 2 dòng trống giữa mục lớn
- ✅ Emoji: 📊🔬💊⚠️📚🏥
- ❌ TRÁNH: ═█░▓▒╔╗║
- ✅ KẾT THÚC: "---\n\nTrân trọng,\n\n**JAREMIS-AI Medical Assistant**\n*Professional Mode*"
`;

    // Tạo báo cáo tư vấn chuyên nghiệp với error handling và fallback
    let consultationText = '';
    let usedModel = modelId;
    
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent([prompt, ...imageParts]);
      const response = await result.response;
      consultationText = response.text ? response.text() : (typeof response === 'string' ? response : '');
      usedModel = modelId;
    } catch (error1) {
      console.warn(`⚠️ Primary model ${modelId} failed:`, error1.message);
      
      // Try fallback model
      try {
        const fallbackModelId = ids.fallback || 'gemini-1.5-pro';
        console.log(`🔄 Trying fallback model: ${fallbackModelId}`);
        
        const fallbackModel = genAI.getGenerativeModel({ model: fallbackModelId });
        const result = await fallbackModel.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        consultationText = response.text ? response.text() : (typeof response === 'string' ? response : '');
        usedModel = fallbackModelId;
      } catch (error2) {
        console.error('❌ Fallback model also failed:', error2.message);
        
        // Last attempt with gemini-pro
        try {
          console.log('🔄 Last attempt with gemini-pro');
          const lastModel = genAI.getGenerativeModel({ model: 'gemini-pro' });
          const result = await lastModel.generateContent([prompt, ...imageParts]);
          const response = await result.response;
          consultationText = response.text ? response.text() : (typeof response === 'string' ? response : '');
          usedModel = 'gemini-pro';
        } catch (error3) {
          console.error('❌ All models failed');
          files.forEach(file => { try { if (fs.existsSync(file.path)) fs.unlinkSync(file.path); } catch(e){} });
          
          return res.status(503).json({
            error: 'Dịch vụ AI tạm thời quá tải. Vui lòng thử lại sau vài phút.',
            details: 'Tất cả các model AI đều đang bận. Đây là lỗi từ Google Gemini API, không phải lỗi hệ thống.',
            suggestion: 'Vui lòng thử lại sau 2-5 phút hoặc liên hệ hỗ trợ nếu lỗi vẫn tiếp diễn.',
            retryAfter: 120
          });
        }
      }
    }

    // Lưu vào lịch sử
    const sessionId = req.body.sessionId || null;
    const historyEntry = {
      id: Date.now(),
      sessionId: sessionId || ('professional-' + Date.now()),
      type: 'professional',
      timestamp: new Date().toISOString(),
      input: message,
      patientInfo: patientInfo,
      imagesCount: files.length,
      modelUsed: DISPLAY_NAME_MAP[usedModel] || usedModel,
      consultation: consultationText
    };
    
    if (submittedBy) {
      try { 
        pushUserHistory(submittedBy, historyEntry); 
      } catch (e) { 
        console.warn('Không lưu được lịch sử cho user', submittedBy); 
      }
    }

    // Xóa các file đã tải lên
    files.forEach(file => { 
      try { 
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path); 
      } catch(e){} 
    });

    // Gửi phản hồi
    res.json({
      modelUsed: DISPLAY_NAME_MAP[usedModel] || usedModel,
      consultation: consultationText,
      consultationHtml: renderLatexInText(consultationText),
      references: references.slice(0, 5),
      warning: '⚠️ **Cảnh báo:** Kết quả chỉ mang tính tham khảo. Luôn tham khảo ý kiến bác sĩ chuyên khoa!'
    });

  } catch (error) {
    console.error('Professional endpoint error:', error);
    try { 
      (req.files || []).forEach(f => { 
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path); 
      }); 
    } catch(e){}
    
    // Kiểm tra lỗi vượt hạn mức (429)
    const errorMsg = error.message || '';
    const isQuotaError = errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('Quota exceeded');
    
    if (isQuotaError) {
      return res.status(429).json({
        error: '⚠️ API đã vượt quá giới hạn sử dụng miễn phí',
        details: 'Gemini API free tier đã hết quota. Vui lòng thử lại sau hoặc nâng cấp API key.',
        solution: [
          'Đợi vài phút và thử lại (quota sẽ reset)',
          'Hoặc nâng cấp lên Gemini API paid plan',
          'Liên hệ admin để cập nhật API key mới'
        ]
      });
    }
    
    res.status(500).json({
      error: error.message || 'Lỗi server khi tạo tư vấn y khoa',
      solution: [
        'Kiểm tra định dạng ảnh (JPEG/PNG)',
        'Đảm bảo kích thước ảnh <4MB',
        'Thử lại với thông tin đầy đủ hơn'
      ]
    });
  }
});

// ==== PATIENT MEDICAL RECORDS ENDPOINTS ====

// Đường dẫn file hồ sơ bệnh nhân
const patientRecordsPath = path.join(__dirname, 'patientRecords.json');

// Đọc hồ sơ bệnh nhân từ file
function readPatientRecords() {
  try {
    if (!fs.existsSync(patientRecordsPath)) {
      fs.writeFileSync(patientRecordsPath, JSON.stringify([], null, 2), 'utf8');
      return [];
    }
    const data = fs.readFileSync(patientRecordsPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading patient records:', error);
    return [];
  }
}

// Lưu hồ sơ bệnh nhân vào file
function savePatientRecords(records) {
  try {
    fs.writeFileSync(patientRecordsPath, JSON.stringify(records, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving patient records:', error);
  }
}

// Tìm hồ sơ bệnh nhân theo ID
function findPatientRecord(patientId) {
  const records = readPatientRecords();
  return records.find(r => r.patientId === patientId);
}

// GET /api/patient-records - Lấy danh sách hồ sơ bệnh nhân của bác sĩ
app.get('/api/patient-records', (req, res) => {
  try {
    const doctor = req.query.doctor;
    if (!doctor) {
      return res.status(401).json({ success: false, error: 'Login required' });
    }
    
    const allRecords = readPatientRecords();
    const doctorRecords = allRecords.filter(r => r.createdBy === doctor);
    
    const summary = doctorRecords.map(r => ({
      patientId: r.patientId,
      patientName: r.patientName,
      createdAt: r.createdAt,
      lastUpdatedAt: r.lastUpdatedAt,
      totalVisits: r.totalVisits,
      latestVisit: r.consultations && r.consultations.length > 0 
        ? { 
            consultationDate: r.consultations[r.consultations.length - 1].consultationDate,
            chiefComplaint: r.consultations[r.consultations.length - 1].chiefComplaint?.substring(0, 100) + '...'
          }
        : null
    }));
    
    res.json({ success: true, records: summary });
  } catch (error) {
    console.error('Error fetching patient records:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/patient-record/:patientId - Lấy chi tiết hồ sơ bệnh nhân
app.get('/api/patient-record/:patientId', (req, res) => {
  try {
    const { patientId } = req.params;
    const doctor = req.query.doctor;
    
    if (!doctor) {
      return res.status(401).json({ success: false, error: 'Login required' });
    }
    
    const record = findPatientRecord(patientId);
    
    if (!record) {
      return res.status(404).json({ success: false, error: 'Patient record not found' });
    }
    
    if (record.createdBy !== doctor) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    res.json({ success: true, record });
  } catch (error) {
    console.error('Error fetching patient record:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/patient-record/:patientId/medical-report - Tạo báo cáo y tế HTML
app.get('/api/patient-record/:patientId/medical-report', (req, res) => {
  try {
    const { patientId } = req.params;
    const doctor = req.query.doctor;
    
    if (!doctor) {
      return res.status(401).send('<h1>Login required</h1>');
    }
    
    const record = findPatientRecord(patientId);
    
    if (!record) {
      return res.status(404).send('<h1>Patient record not found</h1>');
    }
    
    if (record.createdBy !== doctor) {
      return res.status(403).send('<h1>Access denied</h1>');
    }
    
    const htmlReport = generateMedicalRecordHTML(record);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlReport);
  } catch (error) {
    console.error('Error generating medical report:', error);
    res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
  }
});

// PUT /api/patient-record/:patientId/profile - Cập nhật hồ sơ bệnh nhân
app.put('/api/patient-record/:patientId/profile', (req, res) => {
  try {
    const { patientId } = req.params;
    const { doctor, patientInfo } = req.body;
    
    if (!doctor) {
      return res.status(401).json({ success: false, error: 'Login required' });
    }
    
    const records = readPatientRecords();
    const record = records.find(r => r.patientId === patientId);
    
    if (!record) {
      return res.status(404).json({ success: false, error: 'Patient record not found' });
    }
    
    if (record.createdBy !== doctor) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    // Cập nhật tên bệnh nhân nếu được cung cấp
    if (patientInfo.name) {
      record.patientName = patientInfo.name;
    }
    
    // Cập nhật thông tin bệnh nhân trong lần khám mới nhất
    if (record.consultations && record.consultations.length > 0) {
      const latestConsultation = record.consultations[record.consultations.length - 1];
      latestConsultation.patientInfo = { 
        ...latestConsultation.patientInfo, 
        ...patientInfo 
      };
    }
    
    record.lastUpdatedAt = new Date().toISOString();
    savePatientRecords(records);
    
    res.json({ success: true, record });
  } catch (error) {
    console.error('Error updating patient profile:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/patient-record/:patientId/export-word - Xuất báo cáo y tế dạng Word
app.get('/api/patient-record/:patientId/export-word', (req, res) => {
  try {
    const { patientId } = req.params;
    const doctor = req.query.doctor;
    
    if (!doctor) {
      return res.status(401).send('<h1>Login required</h1>');
    }
    
    const record = findPatientRecord(patientId);
    
    if (!record) {
      return res.status(404).send('<h1>Patient record not found</h1>');
    }
    
    if (record.createdBy !== doctor) {
      return res.status(403).send('<h1>Access denied</h1>');
    }
    
    // Generate HTML report
    const htmlReport = generateMedicalRecordHTML(record);
    
    // Extract body content from HTML
    const bodyMatch = htmlReport.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : htmlReport;
    
    // Xóa thẻ script và dọn dẹp cho Word
    let cleanContent = bodyContent
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<button[\s\S]*?<\/button>/gi, '')
      .replace(/class="editable-field"/gi, '')
      .replace(/contenteditable="[^"]*"/gi, '');
    
    // Convert medical-certificate div to remove extra wrappers
    cleanContent = cleanContent.replace(/<div class="medical-certificate">/gi, '');
    cleanContent = cleanContent.replace(/<\/div>\s*<\/body>/gi, '</body>');
    
    // Đảm bảo tất cả bảng có thuộc tính Word phù hợp
    cleanContent = cleanContent.replace(/<table/gi, '<table border="0" cellspacing="0" cellpadding="0"');
    
    // Convert HTML to Word-compatible format - Universal for WPS & Word 2019
    const wordContent = `
<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <title>Giấy khám bệnh</title>
  <style>
    /* Universal page setup - Works in both WPS and Word */
    @page {
      size: A4;
      margin: 1.5cm 2cm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 13pt;
      line-height: 1.5;
      color: #000;
      padding: 20px 30px;
    }
    
    /* Tables - Simple approach for compatibility */
    table {
      width: 100%;
      border-collapse: collapse;
      border: none;
    }
    
    td {
      border: none;
      padding: 4px;
      vertical-align: top;
    }
    
    /* Header section */
    .header-table {
      margin-bottom: 15px;
    }
    
    .header-table td {
      font-size: 11pt;
      line-height: 1.4;
    }
    
    .header-left {
      text-align: left;
      width: 50%;
      font-weight: bold;
    }
    
    .header-right {
      text-align: right;
      width: 50%;
      font-weight: bold;
    }
    
    .header-underline {
      text-decoration: underline;
      font-style: italic;
      font-size: 12pt;
    }
    
    strong {
      font-weight: bold;
    }
    
    /* Title */
    .title {
      text-align: center;
      font-size: 18pt;
      font-weight: bold;
      margin: 25px 0;
      letter-spacing: 0.5pt;
    }
    
    /* Patient info section */
    .patient-info-container {
      width: 100%;
      margin-bottom: 20px;
    }
    
    .photo-box {
      width: 90px;
      height: 120px;
      border: 2px solid #000;
      text-align: center;
      vertical-align: middle;
      font-size: 11pt;
      font-style: italic;
      padding: 10px;
    }
    
    .patient-info {
      padding-left: 20px;
      vertical-align: top;
    }
    
    .info-row {
      margin-bottom: 7px;
      line-height: 1.5;
    }
    
    .info-label {
      display: inline-block;
      min-width: 160px;
      font-size: 13pt;
    }
    
    .info-value {
      display: inline;
      border-bottom: 1px dotted #333;
      padding: 0 3px;
      font-size: 13pt;
    }
    
    /* Section styling */
    .section-title {
      text-align: center;
      font-weight: bold;
      font-size: 14pt;
      margin: 25px 0 15px 0;
      text-decoration: underline;
    }
    
    .section-number {
      font-weight: bold;
      font-size: 13pt;
      margin: 15px 0 8px 0;
    }
    
    .subsection {
      margin-left: 20px;
      margin-bottom: 10px;
      font-size: 13pt;
      line-height: 1.6;
      text-align: justify;
    }
    
    /* Checkbox styling - Simple squares */
    .checkbox {
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #000;
      margin: 0 5px;
      vertical-align: middle;
      text-align: center;
      line-height: 14px;
    }
    
    .checkbox.checked {
      background: #000;
      color: #fff;
      font-size: 12pt;
      font-weight: bold;
    }
    
    /* Visit sections */
    .visit-section {
      margin: 20px 0;
      page-break-inside: avoid;
    }
    
    .visit-title {
      font-weight: bold;
      font-size: 13pt;
      margin: 15px 0 10px 0;
    }
    
    .bullet-list {
      margin-left: 30px;
      margin-top: 10px;
    }
    
    .bullet-item {
      margin-bottom: 8px;
      font-size: 13pt;
      line-height: 1.5;
    }
    
    /* Footer signatures */
    .footer-table {
      width: 100%;
      margin-top: 50px;
    }
    
    .footer-table td {
      text-align: center;
      padding: 10px;
      width: 50%;
    }
    
    .signature-date {
      font-style: italic;
      margin-bottom: 10px;
      font-size: 13pt;
    }
    
    .signature-title {
      font-weight: bold;
      margin-bottom: 70px;
      font-size: 13pt;
    }
    
    .signature-name {
      font-style: italic;
      font-size: 13pt;
      margin-top: 70px;
    }
  </style>
</head>
<body>
${cleanContent}
</body>
</html>
    `;
    
    res.setHeader('Content-Type', 'application/msword');
    res.setHeader('Content-Disposition', `attachment; filename="GiayKhamBenh_${patientId}_${Date.now()}.doc"`);
    res.send(wordContent);
  } catch (error) {
    console.error('Error exporting to Word:', error);
    res.status(500).send(`<h1>Error</h1><p>${error.message}</p>`);
  }
});

// Khởi động server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy trên cổng ${PORT}`);
  console.log(`📡 API endpoints sẵn sàng:`);
  console.log(`   - POST /api/chat`);
  console.log(`   - POST /api/diagnose`);
  console.log(`   - POST /api/professional`);
  console.log(`   - GET  /api/history`);
});
