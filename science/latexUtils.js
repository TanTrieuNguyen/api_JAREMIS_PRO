function isScientificQuery(text=''){
  const t=(text||'').toLowerCase();
  if(!t.trim()) return false;
  const kw=[
    'giải','tính','chứng minh','chứng tỏ','phân tích','rút gọn','chuyển đổi','xác định',
    'phương trình','hệ','nghiệm','bậc hai','đạo hàm','tích phân','giới hạn','lim','chuỗi',
    'biểu thức','bất đẳng thức','khảo sát','cực trị','vi phân','gradient','ma trận','định thức',
    'vector','eigen','trị riêng','vận tốc','gia tốc','lực','công','năng lượng','công suất',
    'điện trở','dòng điện','điện áp','mạch điện','cảm ứng','từ trường','điện trường',
    'phản ứng','hóa học','oxi hóa','khử','mol','nguyên tử','phân tử','cân bằng','nồng độ',
    'ph','este','hidrocacbon','amin','peptit','enzyme','protein','glucid','lipid',
    'xác suất','thống kê','kỳ vọng','phương sai','phân phối','chuẩn hóa','t-test','anova'
  ];
  const rg=new RegExp(`\\b(${kw.join('|')})\\b`,'i');
  return rg.test(t) || (/[=+\-*/^→\\√]/.test(t) && /[a-zA-Z0-9]/.test(t));
}

function buildSciLatexGuideline(){
  return `
[SCI_LATEX RULES]
Đầu ra CHỈ gồm lời giải dạng LaTeX học thuật tiếng Việt, không chào hỏi, không emoji.
Cấu trúc bắt buộc:
\\textbf{Đề bài.} (ngắn gọn)
\\textbf{Bước 1.} Giải thích ngắn.
\\[ E_1 \\]   % phương trình/trung gian hiển thị (căn giữa)
\\textbf{Bước 2.} ...
\\[
\\begin{aligned}
A &= B \\\\
  &= C
\\end{aligned}
\\]
...
\\textbf{Kết luận.} (nếu có nghiệm, ghi rõ x=..., y=...)
Quy tắc:
- Mỗi phương trình độc lập: dùng \\[ ... \\] (display math, căn giữa).
- Chuỗi biến đổi: \\[
\\begin{aligned}
...
\\end{aligned}
\\]
- Dùng \\dfrac, \\sqrt, \\Delta khi phù hợp. Không lan man.
`.trim();
}

function postProcessLatex(raw=''){
  if(!raw) return raw;
  let txt = String(raw).replace(/\r/g,'').trim();

  // 1) Sửa sqrt: ưu tiên dạng có ngoặc, rồi đến dạng không ngoặc
  txt = txt.replace(/√\s*\(([^()]+)\)/g, '\\\\sqrt{$1}');
  txt = txt.replace(/√\s*([A-Za-z0-9]+)/g, '\\\\sqrt{$1}');

  // 2) Phân số đơn giản (tránh lookbehind). Không đụng \dfrac đã có.
  txt = txt.replace(/(\b[A-Za-z0-9]{1,5})\s*\/\s*([A-Za-z0-9]{1,5}\b)/g,(m,a,b,offset,str)=>{
    const prev = str.slice(Math.max(0, offset-8), offset);
    if(/\\d?frac\{$/.test(prev)) return m; // đã ở dạng \frac/\dfrac
    return '\\\\dfrac{' + a + '}{' + b + '}';
  });

  // 3) Gom chuỗi phương trình vào aligned, có khoảng trắng chuẩn quanh &=
  const lines = txt.split('\n').map(l=>l.trim());
  let out = [], buf = [];
  function flush(){
    if(buf.length >= 2){
      out.push('\\[','\\begin{aligned}');
      buf.forEach(ln=>{
        if(/=/.test(ln)){
          const parts = ln.split('=');
          const lhs = parts.shift().trim();
          const rhs = parts.join('=').trim();
          out.push(`${lhs} &= ${rhs}`);
        } else {
          out.push(ln);
        }
      });
      out.push('\\end{aligned}','\\]');
    } else {
      out.push(...buf);
    }
    buf = [];
  }
  for(const ln of lines){
    if(!ln){ flush(); out.push(''); continue; }
    const isEq = /=/.test(ln) && !/^\\(begin|end){/.test(ln);
    if(isEq) buf.push(ln); else { flush(); out.push(ln); }
  }
  flush();
  txt = out.join('\n');

  // 4) Wrap phương trình đơn lẻ chưa nằm trong $$ hoặc môi trường
  txt = txt.replace(/^([^\n$]*[A-Za-z0-9]\s*=\s*[^$\n]+)$/gm,(m)=>{
    if(/^\s*(\$\$|\\begin|\\\[)/.test(m)) return m;
    if(m.includes('\\begin{aligned}')) return m;
    return '$$' + m.trim() + '$$';
  });

  // 5) Chống duplicate $$
  txt = txt.replace(/\$\$\s*\$\$/g,'$$');

  // 6) Thêm "Kết luận" nếu có nghiệm x, y (hỗ trợ cả &=)
  const xm = txt.match(/\bx\s*(?:&=|=)\s*([-+0-9/]+)/i);
  const ym = txt.match(/\by\s*(?:&=|=)\s*([-+0-9/]+)/i);
  if(xm && ym && !/\\textbf\{Kết luận\./i.test(txt)){
    txt += `\n\\textbf{Kết luận. } x=${xm[1]}, y=${ym[1]}.`;
  }

  // 7) Nếu không có lệnh LaTeX nào, thêm chú thích fallback
  if(!/\\(begin|frac|sqrt|dfrac|Delta|textbf|aligned|\\\[)/.test(txt)){
    txt = '% fallback_no_latex_detected\n' + txt;
  }

  return txt.trim();
}

module.exports = { isScientificQuery, buildSciLatexGuideline, postProcessLatex };