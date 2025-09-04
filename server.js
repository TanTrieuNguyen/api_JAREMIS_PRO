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
function getRecentChatHistory(username, limit = 10, maxChars = 6000) {
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
    const includeHistory = req.body.includeHistory !== false;

    // Lấy lịch sử hội thoại gần đây (giữ nguyên logic cũ)
    let historyBlocks = [];
    if (submittedBy && includeHistory) {
      historyBlocks = getRecentChatHistory(submittedBy, 10, 6000);
    }

    // >>> Thêm đoạn này để định nghĩa isSensitive và reassuranceBlock <<<
    const sensitiveRegex = /(ung thư|khối u|u ác|đau ngực|khó thở|xuất huyết|tự sát|tự tử|trầm cảm|đột quỵ|nhồi máu|co giật|hôn mê)/i;
    const isSensitive = sensitiveRegex.test(message);
    const reassuranceBlock = isSensitive
      ? `\n[HƯỚNG DẪN GIỌNG ĐIỆU]\n- Chủ đề nhạy cảm: trấn an, tránh gây hoang mang.\n- Nêu dấu hiệu cần đi khám khẩn nếu có.\n- Nhắc không chẩn đoán chính thức trong chế độ Chat.\n`
      : '';
    // <<< Hết phần thêm >>>

    const systemPrompt = `Bạn là một trợ lý thông minh, thân thiện, trả lời ngắn gọn, rõ ràng bằng tiếng Việt. Tên bạn là JAREMIS-AI được tạo bởi TT1403 & ANT.
Nếu người dùng yêu cầu CHẨN ĐOÁN Y KHOA hoặc xin chẩn đoán lâm sàng,
KHÔNG cung cấp chẩn đoán chi tiết — hãy gợi ý họ dùng chế độ "Diagnose"
và luôn nhắc tham khảo ý kiến bác sĩ. Giữ ngữ cảnh phù hợp, không lặp lại nguyên văn dài dòng từ lịch sử.
MỤC TIÊU:
1. Trả lời có cấu trúc: Tổng quan ngắn -> Các điểm chính -> Giải thích dễ hiểu -> Gợi ý bước an toàn -> Khích lệ (nếu phù hợp).
2. Giải thích thuật ngữ y khoa bằng lời Việt đơn giản.
3. Không đưa chẩn đoán y khoa trực tiếp; nếu người dùng muốn chẩn đoán: gợi ý dùng chế độ "Diagnose".
4. Với nội dung nhạy cảm: trấn an, không phóng đại rủi ro.
5. Không bịa đặt. Nếu thiếu dữ kiện: yêu cầu cung cấp thêm.
6. Không đưa phác đồ điều trị, liều thuốc chi tiết.
7. Không lặp lại nguyên văn dài từ lịch sử – chỉ tham chiếu ngắn gọn.
8. Khích lệ tích cực vừa phải, không sáo rỗng.
Luôn nhắc: Thông tin chỉ tham khảo, không thay thế bác sĩ.`;

    const historySection = historyBlocks.length
      ? `Lịch sử gần đây (tóm tắt, đừng lặp lại nguyên văn):\n${historyBlocks.join('\n')}\n\n`
      : '';

    const fullPrompt = `${systemPrompt}${reassuranceBlock}

${historySection}Người dùng hỏi: ${message}

Trả lời đúng phong cách, rõ ràng, không chẩn đoán trực tiếp:`;

    const model = genAI.getGenerativeModel({ model: modelId });
    const result = await model.generateContent([fullPrompt]);
    const response = await result.response;
    const assistantText = response.text ? response.text() : (typeof response === 'string' ? response : '');

    // Lưu history (đổi modelUsed sang tên hiển thị)
    if (submittedBy) {
      const entry = {
        id: Date.now(),
        type: 'chat',
        timestamp: new Date().toISOString(),
        input: message,
        reply: assistantText,
        modelUsed: displayModel
      };
      try { pushUserHistory(submittedBy, entry); } catch(e) { console.warn('Không lưu history chat', e); }
    }

    return res.json({
      success: true,
      reply: assistantText,
      modelUsed: displayModel,
      usedHistory: historyBlocks.length,
      sensitive: isSensitive
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
    const historyEntry = {
      id: Date.now(),
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server đang chạy trên cổng ${PORT}`));
