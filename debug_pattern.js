// Quick debug pattern matching
const test1 = 'Tôi bị đau đầu dữ dội từ sáng nay';
const test2 = 'Đau ngực dữ dội và khó thở';
const test3 = 'Đau bụng dưới bên phải';

const neuroPattern = /(đau\s?đầu|headache)/i;
const emergencyPattern = /(đau\s?ngực|chest\s?pain)/i;
const giPattern = /(đau\s?bụng|abdominal\s?pain)/i;

console.log('Test 1:', test1);
console.log('Neuro pattern match:', neuroPattern.test(test1));
console.log('Match result:', test1.match(neuroPattern));
console.log('');

console.log('Test 2:', test2);
console.log('Emergency pattern match:', emergencyPattern.test(test2));
console.log('Match result:', test2.match(emergencyPattern));
console.log('');

console.log('Test 3:', test3);
console.log('GI pattern match:', giPattern.test(test3));
console.log('Match result:', test3.match(giPattern));
