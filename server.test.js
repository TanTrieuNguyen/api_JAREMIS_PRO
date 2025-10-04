const { isScientificQuery, buildSciLatexGuideline, postProcessLatex } = require('./science/latexUtils');

test('hello world!', () => {
  expect(1 + 1).toBe(2);
});

/* ================== TESTS ================== */

describe('isScientificQuery', () => {
	test('nhận diện bài toán đơn giản', () => {
		expect(isScientificQuery('Giải phương trình x^2 + 1 = 0')).toBe(true);
	});
	test('nhận diện bài vật lý', () => {
		expect(isScientificQuery('Tính vận tốc khi gia tốc a=2 và thời gian t=5')).toBe(true);
	});
	test('nhận diện bài hóa học', () => {
		expect(isScientificQuery('Cân bằng phản ứng oxi hóa khử Fe2+ + MnO4-')).toBe(true);
	});
	test('nhận diện bài thống kê', () => {
		expect(isScientificQuery('Tính phương sai mẫu của dãy')).toBe(true);
	});
	test('chuỗi không khoa học', () => {
		expect(isScientificQuery('Hôm nay trời đẹp quá')).toBe(false);
	});
	test('ký hiệu toán học có dấu =', () => {
		expect(isScientificQuery('x=2y+3')).toBe(true);
	});
});

describe('buildSciLatexGuideline', () => {
	test('chứa tiêu đề quy tắc', () => {
		const g = buildSciLatexGuideline();
		expect(g).toMatch(/\[SCI_LATEX RULES]/);
	});
	test('có cấu trúc đề bài', () => {
		const g = buildSciLatexGuideline();
		expect(g).toMatch(/\\textbf\{Đề bài\.\}/);
	});
	test('có yêu cầu dùng aligned', () => {
		const g = buildSciLatexGuideline();
		expect(g).toMatch(/aligned/);
	});
});

describe('postProcessLatex', () => {
  test('chuyển sqrt thành \\sqrt{}', () => {
    const out = postProcessLatex('√(x+1)=2');
    expect(out).toMatch(/\\sqrt\{x\+1\}/);
  });

  test('chuyển a/b thành \\dfrac{a}{b}', () => {
    const out = postProcessLatex('Ta có x/2 + y/3');
    // chấp nhận 1+ backslash do chuỗi đã escape trong output
    expect(out).toMatch(/\\+dfrac\{x\}\{2\}/);
    expect(out).toMatch(/\\+dfrac\{y\}\{3\}/);
  });

  test('gom 3 dòng liên tiếp vào aligned', () => {
    const input = 'x= y+1\ny+1=2z\n2z=4';
    const out = postProcessLatex(input);
    expect(out).toMatch(/\\begin{aligned}/);
    expect(out).toMatch(/x\s*&=\s*y\+1/);
    expect(out).toMatch(/y\+1\s*&=\s*2z/);
    expect(out).toMatch(/2z\s*&=\s*4/);
  });

  test('không gom khi chỉ một phương trình', () => {
    const input = 'x = y+1';
    const out = postProcessLatex(input);
    expect(out).not.toMatch(/\\begin{aligned}/);
    expect(out).toMatch(/\$\$x\s*=\s*y\+1\$\$/);
  });

  test('thêm kết luận khi có x= và y=', () => {
    const input = 'Kết quả:\nx = -2\ny = 1';
    const out = postProcessLatex(input);
    expect(out).toMatch(/\\textbf\{Kết luận\./);
    expect(out).toMatch(/x=-2,\s*y=1/);
  });

  test('không thêm kết luận nếu đã có', () => {
		const input = 'x=1\ny=2\n\\textbf{Kết luận. } x=1, y=2.';
		const out = postProcessLatex(input);
		const matches = out.match(/\\textbf\{Kết luận\./g) || [];
		expect(matches.length).toBe(1);
	});

	test('không tạo duplicate $$', () => {
		const input = 'x=1\ny=2';
		const out = postProcessLatex(input);
		expect(out).not.toMatch(/\$\$\s*\$\$/);
	});

	test('thêm chú thích fallback nếu không có latex command', () => {
		const input = 'KET QUA DON GIAN';
		const out = postProcessLatex(input);
		expect(out.startsWith('% fallback_no_latex_detected')).toBe(true);
	});
});