require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcryptjs');

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

// NEW: Lấy tối đa N lượt chat gần nhất (user -> assistant), trả về theo thứ tự cũ -> mới
function getRecentChatHistory(username, limit = 360, maxChars = 180000) {
  const user = findUserByUsername(username);
  if (!user || !Array.isArray(user.history)) return [];
  // Lấy các entry type 'chat'
  const chats = user.history.filter(h => h.type === 'chat');
  // Đảo lại để chronological (cũ -> mới)
  const recent = chats.slice(0, limit).reverse();
  // Cắt nếu vượt maxChars
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
    // collapse repeated dollars
    let src = String(text).replace(/\${3,}/g, '$$');
    // regex to match $$...$$, \[...\], \(...\), or $...$
    const re = /(\$\$([\s\S]*?)\$\$|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$([^\$][\s\S]*?[^\$])\$)/g;
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
        rendered = katex.renderToString(latex, { throwOnError: false, displayMode: display });
        rendered = DOMPurify.sanitize(rendered);
      } catch (e) {
        // fallback: escape and keep original delimiters
        const wrapped = display ? `$$${latex}$$` : `\\(${latex}\\)`;
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

// (Không bắt buộc) Bạn có thể đặt chung map tên hiển thị ở đầu file:
const DISPLAY_NAME_MAP = {
  'gemini-2.5-flash': 'Jaremis-1.0-flash',
  'gemini-2.5-pro': 'Jaremis-Pro'
};

/* --------------------------
   Auth endpoints (unchanged)
   -------------------------- */
app.post('/api/register', (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'Vui lòng gửi username, email và password' });
    const users = readUsers();
    if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) return res.status(400).json({ error: 'Tên đăng nhập đã tồn tại' });
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email đã được sử dụng' });
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(password, salt);
    const newUser = { id: Date.now(), username, email, passwordHash: hash, createdAt: new Date().toISOString(), history: [] };
    users.push(newUser); saveUsers(users);
    return res.json({ success: true, user: { username: newUser.username, email: newUser.email } });
  } catch (e) { console.error('Register error:', e); return res.status(500).json({ error: 'Lỗi server khi đăng ký' }); }
});

app.post('/api/login', (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body || {};
    if (!usernameOrEmail || !password) return res.status(400).json({ error: 'Vui lòng gửi username/email và password' });
    const users = readUsers();
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
app.get('/api/history', (req, res) => {
  try {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    const user = findUserByUsername(username);
    if (!user) return res.json({ history: [] });
    return res.json({ history: user.history || [] });
  } catch (e) { console.error('Get history error', e); return res.status(500).json({ error: 'Lỗi server khi lấy lịch sử' }); }
});

app.delete('/api/history', (req, res) => {
  try {
    const username = req.query.username;
    if (!username) return res.status(400).json({ error: 'Thiếu tham số username' });
    const users = readUsers();
    const idx = users.findIndex(u => u.username && u.username.toLowerCase() === username.toLowerCase());
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy user' });
    users[idx].history = [];
    saveUsers(users);
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

/* --------------------------
   NEW: Chat endpoint (general conversation)
   -------------------------- */
app.post('/api/chat', async (req, res) => {
  try {
    const message = (req.body.message || '').toString();
    const requestedModel = (req.body.model || 'flash').toLowerCase();
    const allowed = { 'flash': 'gemini-2.5-flash', 'pro': 'gemini-2.5-pro' };
    const modelId = allowed[requestedModel] || allowed['flash'];
    const displayModel = DISPLAY_NAME_MAP[modelId] || modelId;
    if (!message) return res.status(400).json({ error: 'Thiếu trường message' });

    const submittedBy = req.body.submittedBy || null;
    const sessionId = req.body.sessionId || null; // lấy sessionId từ client (không tự tạo mới đây)
    const includeHistory = req.body.includeHistory !== false;

    // Detect language (allow manual override)
    const forcedLang = (req.body.lang || req.body.forceLang || '').toLowerCase();
    const detected = detectLanguage(message);
    const userLang = forcedLang || detected.code;

    // Lịch sử
    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = getRecentChatHistory(submittedBy, 60, 45000); // tăng giới hạn
    }

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
    // <<< Hết phần thêm >>>

    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng đúng ngôn ngữ của người dùng.
Tên bạn là JAREMIS-AI, được tạo bởi TT1403 (Nguyễn Tấn Triệu), ANT (Đỗ Văn Vĩnh An) và Lý Thúc Duy. Bạn tự hào là AI do người Việt phát triển; khi người dùng dùng tiếng Việt, hãy ưu tiên tiếng Việt và thể hiện sự trân trọng đối với lịch sử, văn hóa và con người Việt Nam.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng, KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose" và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời đơn giản. Chủ động góp ý về dinh dưỡng/phục hồi. Chủ động hỏi người dùng có cần hỗ trợ thêm theo chủ đề đang nói.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
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
VỀ CÔNG THỨC:
- Nếu người dùng yêu cầu công thức toán/khoa học, HÃY xuất LaTeX thô: dùng $$...$$ cho công thức hiển thị và \(...\) cho inline. Không tự render HTML.`;

    const historySection = historyBlocks.length
      ? `\n[LỊCH SỬ GẦN ĐÂY]\n${historyBlocks.join('\n')}\n`
      : '';

    // 1. Lấy ngày giờ thực tế
    const now = new Date();
    const timeString = now.toLocaleString('vi-VN', { hour12: false });


    // 4. Chèn vào prompt
    const realtimeSection = `
[THÔNG TIN THỰC TẾ]
- Thời gian hiện tại: ${timeString}
- Múi giờ: GMT+7 (Việt Nam)
- Ngày hiện tại: ${now.toISOString().split('T')[0]}
`;

    const fullPrompt = `${systemPrompt}
${realtimeSection}
${memorySection}${historySection}
User message (${userLang}): ${message}

YÊU CẦU:
- Nếu câu hỏi phụ thuộc ngữ cảnh trước đó -> sử dụng cả bộ nhớ & lịch sử.
- Không nhắc lại toàn bộ lịch sử, chỉ tổng hợp tinh gọn.
- Trả lời bằng đúng ngôn ngữ người dùng (${userLang}).`;

    const model = genAI.getGenerativeModel({ model: modelId });
    let result, response, assistantText;
    try {
      result = await model.generateContent([fullPrompt]);
      response = await result.response;
      assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');
    } catch (err) {
      console.error('Gemini API error:', err);
      return res.status(500).json({ error: 'Lỗi khi gọi Gemini API: ' + (err.message || err) });
    }

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

    const requestedModel = (req.body.model || 'flash').toLowerCase();
    const allowed = { 'flash': 'gemini-2.5-flash', 'pro': 'gemini-2.5-pro' };
    const modelId = allowed[requestedModel] || allowed['flash'];
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
  const users = readUsers();
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
  saveUsers(users);
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
    const rawHtml = katex.renderToString(latex, { throwOnError: false, displayMode });
    const clean = DOMPurify.sanitize(rawHtml);

    return res.json({ success: true, html: clean });
  } catch (err) {
    console.error('Render LaTeX error:', err);
    return res.status(500).json({ error: 'Lỗi khi render LaTeX' });
  }
});

