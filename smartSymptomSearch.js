/**
 * SMART SYMPTOM SEARCH MODULE
 * Tách triệu chứng chính từ câu tự nhiên, loại bỏ trạng ngữ/từ phụ,
 * chọn nguồn web search phù hợp với từng loại triệu chứng.
 * 
 * Author: TT1403, ANT
 * Date: 2025
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

/**
 * Tách keyword triệu chứng chính từ câu tự nhiên
 * VD: "Tôi bị đau đầu dữ dội từ sáng nay" → "đau đầu"
 */
async function extractSymptomKeywords(userInput) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' });
    
    const prompt = `Bạn là chuyên gia phân tích y tế. Nhiệm vụ: Tách KEYWORD TRIỆU CHỨNG CHÍNH từ câu người dùng.

**NGUYÊN TẮC:**
1. Chỉ giữ lại TRIỆU CHỨNG CHÍNH (danh từ y tế)
2. Loại bỏ: trạng ngữ thời gian, mức độ, tính từ phụ
3. Giữ: bộ phận cơ thể nếu cần thiết
4. Kết quả ngắn gọn 2-5 từ, dễ search web

**VÍ DỤ:**
- Input: "Tôi bị đau đầu dữ dội từ sáng nay"
  Output: "đau đầu"

- Input: "Con tôi sốt cao 39 độ mấy ngày nay"
  Output: "sốt cao"

- Input: "Bị ngứa mắt và chảy nước mũi liên tục"
  Output: "ngứa mắt chảy nước mũi"

- Input: "Đau bụng dưới bên phải kéo dài 2 ngày"
  Output: "đau bụng dưới bên phải"

- Input: "Ho khan kéo dài 3 tuần không khỏi"
  Output: "ho khan kéo dài"

- Input: "My child has a high fever and cough"
  Output: "high fever cough"

- Input: "胸痛已经持续了两天"
  Output: "胸痛"

**QUAN TRỌNG:**
- Trả về ĐÚNG NGÔN NGỮ của input
- Chỉ trả keyword, KHÔNG giải thích thêm
- Nếu có nhiều triệu chứng → giữ hết 
- KHÔNG thêm "bệnh", "chẩn đoán", "điều trị"

User input: "${userInput}"

Keyword triệu chứng:`;

    const result = await Promise.race([
      model.generateContent([prompt]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 3000))
    ]);
    
    const response = await result.response;
    let keywords = response.text().trim();
    
    // Clean up markdown/extra formatting
    keywords = keywords.replace(/^["'\`\*]+|["'\`\*]+$/g, '').trim();
    
    console.log(`🔍 Symptom extraction (AI): "${userInput}" → "${keywords}"`);
    return { keyword: keywords, method: 'ai' };
    
  } catch (error) {
    console.warn('⚠️ Symptom extraction failed:', error.message);
    
    // Fallback: Enhanced regex cleanup để tách triệu chứng
    let cleaned = userInput
      // Step 1: Remove numbers with units FIRST (before removing other words)
      .replace(/\d+\s*(độ|lần|giờ)/gi, '') // Remove "39 độ", "2 lần"
      .replace(/\d+\s*(ngày|tuần|tháng|năm)/gi, '') // Remove "2 ngày", "3 tuần"
      .replace(/\d+\s*(days?|weeks?|months?|years?|hours?|minutes?)/gi, '')
      // Step 2: Remove Vietnamese pronouns & modifiers
      .replace(/(^|\s)(tôi|con tôi|gia đình|chồng|vợ|bố|mẹ|con|em|anh|chị)(\s|$)/gi, ' ')
      .replace(/(^|\s)(bị|đang|có|cảm thấy|thấy)(\s|$)/gi, ' ')
      // IMPORTANT: Remove time phrases (giữ lại mức độ như "dữ dội", "nặng")
      .replace(/(^|\s)(từ|nay)\s+(sáng|chiều|tối|đêm|hôm|ngày)/gi, ' ') // "từ sáng nay" → removed
      .replace(/(^|\s)(hôm nay|hôm qua|sáng nay|chiều nay|tối nay|tối qua|sáng sớm)(\s|$)/gi, ' ')
      .replace(/(^|\s)(sáng|chiều|tối|đêm|nay|qua|rồi)(\s|$)/gi, ' ') // Remove standalone time words
      .replace(/(^|\s)(mấy|nhiều|vài|ít|khoảng)(\s|$)/gi, ' ')
      .replace(/(^|\s)(kéo dài|liên tục|thường xuyên|đôi khi|luôn)(\s|$)/gi, ' ')
      // KEEP severity modifiers: dữ dội, nặng, nhẹ, cấp tính, mạn tính
      // .replace(/(^|\s)(rất|dữ dội|nặng|nhẹ|quá|hơi|khá)(\s|$)/gi, ' ') // REMOVED - keep these
      .replace(/(^|\s)(rất|quá|hơi|khá)(\s|$)/gi, ' ') // Only remove generic intensifiers
      // Step 3: Remove English pronouns & modifiers
      .replace(/(^|\s)(i|my|me|his|her|their|our|son|daughter|parent|family|friend)(\s|$)/gi, ' ')
      .replace(/(^|\s)(has|have|had|been|am|is|are|was|were|being)(\s|$)/gi, ' ')
      .replace(/(^|\s)(a|an|the)(\s|$)/gi, ' ') // Remove articles
      .replace(/(^|\s)(for|since|from|to|at|in|on|about|around|with|by)(\s|$)/gi, ' ')
      // KEEP English severity: severe, mild, chronic, acute
      // .replace(/(^|\s)(very|extremely|severe|mild|intense|chronic)(\s|$)/gi, ' ') // REMOVED
      .replace(/(^|\s)(very|extremely)(\s|$)/gi, ' ') // Only remove generic intensifiers
      // Step 4: Clean up extra spaces & commas
      .replace(/\s*,\s*/g, ' ') // "sốt, ho" → "sốt ho"
      .replace(/\s+/g, ' ')
      .trim();
    
    // If cleaned too short or empty, use original
    const finalKeyword = cleaned.length >= 3 ? cleaned : userInput;
    
    console.log(`🔄 Fallback cleanup: "${userInput}" → "${finalKeyword}"`);
    return { keyword: finalKeyword, method: 'fallback-regex' };
  }
}

/**
 * Phân loại loại triệu chứng và chọn nguồn web phù hợp
 */
function categorizeSymptomAndGetSources(symptomKeyword) {
  const keyword = symptomKeyword.toLowerCase();
  
  // 1. TRIỆU CHỨNG CẤP CỨU (Emergency) - ưu tiên WHO, Mayo Clinic, CDC
  const emergencyPatterns = [
    /(đau\s?ngực|chest\s?pain|胸痛)/i,
    /(khó\s?thở|difficulty\s?breathing|呼吸困难)/i,
    /(xuất\s?huyết|bleeding|出血)/i,
    /(co\s?giật|seizure|癫痫)/i,
    /(mất\s?ý\s?thức|unconscious|昏迷)/i,
    /(đột\s?quỵ|stroke|中风)/i,
    /(tai\s?biến|sốc|shock)/i
  ];
  
  if (emergencyPatterns.some(p => p.test(keyword))) {
    return {
      category: 'emergency',
      sources: [
        {
          title: `WHO Emergency Guidelines`,
          url: `https://www.who.int/emergencies/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🚨 WHO Emergency',
          snippet: 'Hướng dẫn xử lý cấp cứu từ WHO'
        },
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin y tế từ bệnh viện hàng đầu thế giới'
        },
        {
          title: `CDC Emergency`,
          url: `https://www.cdc.gov/search/?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏛️ CDC',
          snippet: 'Hướng dẫn cấp cứu từ CDC (US)'
        }
      ]
    };
  }
  
  // 2. TRIỆU CHỨNG TRUYỀN NHIỄM - WHO, CDC, Bộ Y tế
  const infectiousPatterns = [
    /(sốt|fever|发烧)/i,
    /(ho|cough|咳嗽)/i,
    /(cúm|flu|流感)/i,
    /(viêm phổi|pneumonia|肺炎)/i,
    /(tiêu chảy|diarrhea|腹泻)/i,
    /(nôn|vomit|呕吐)/i,
    /(nhiễm trùng|infection)/i
  ];
  
  if (infectiousPatterns.some(p => p.test(keyword))) {
    return {
      category: 'infectious',
      sources: [
        {
          title: `WHO - ${symptomKeyword}`,
          url: `https://www.who.int/health-topics/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 WHO',
          snippet: 'Hướng dẫn về bệnh truyền nhiễm từ WHO'
        },
        {
          title: `Bộ Y tế VN - ${symptomKeyword}`,
          url: `https://moh.gov.vn/web/guest/tim-kiem?_search_WAR_mohmvcportlet_keywords=${encodeURIComponent(symptomKeyword)}`,
          source: '🏛️ Bộ Y tế VN',
          snippet: 'Hướng dẫn phòng chống dịch bệnh'
        },
        {
          title: `CDC - ${symptomKeyword}`,
          url: `https://www.cdc.gov/search/?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🔬 CDC',
          snippet: 'Thông tin từ Trung tâm Kiểm soát Dịch bệnh Mỹ'
        }
      ]
    };
  }
  
  // 3. TRIỆU CHỨNG DA LIỄU - AAD, DermNet, Mayo Clinic
  const dermPatterns = [
    /(ngứa|itch|痒)/i,
    /(phát ban|rash|皮疹)/i,
    /(mụn|acne|痤疮)/i,
    /(viêm da|dermatitis|皮炎)/i,
    /(nấm|fungal|真菌)/i,
    /(chàm|eczema|湿疹)/i
  ];
  
  if (dermPatterns.some(p => p.test(keyword))) {
    return {
      category: 'dermatology',
      sources: [
        {
          title: `DermNet - ${symptomKeyword}`,
          url: `https://dermnetnz.org/search/?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🔬 DermNet NZ',
          snippet: 'Cơ sở dữ liệu da liễu chuyên sâu'
        },
        {
          title: `AAD - ${symptomKeyword}`,
          url: `https://www.aad.org/search?keys=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 AAD',
          snippet: 'Hiệp hội Da liễu Mỹ'
        },
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin da liễu từ Mayo Clinic'
        }
      ]
    };
  }
  
  // 4. TRIỆU CHỨNG TÂM LÝ/TÂM THẦN - NIMH, Mental Health Foundation
  const mentalHealthPatterns = [
    /(trầm cảm|depression|抑郁)/i,
    /(lo âu|anxiety|焦虑)/i,
    /(stress|căng thẳng|压力)/i,
    /(mất ngủ|insomnia|失眠)/i,
    /(tâm lý|mental health)/i
  ];
  
  if (mentalHealthPatterns.some(p => p.test(keyword))) {
    return {
      category: 'mental-health',
      sources: [
        {
          title: `NIMH - ${symptomKeyword}`,
          url: `https://www.nimh.nih.gov/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🧠 NIMH',
          snippet: 'Viện Sức khỏe Tâm thần Quốc gia Mỹ'
        },
        {
          title: `Mental Health Foundation`,
          url: `https://www.mentalhealth.org.uk/search?keys=${encodeURIComponent(symptomKeyword)}`,
          source: '💚 Mental Health UK',
          snippet: 'Tổ chức Sức khỏe Tâm thần Anh'
        },
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin sức khỏe tâm thần'
        }
      ]
    };
  }
  
  // 5. TRIỆU CHỨNG TIÊU HÓA - Mayo Clinic, Johns Hopkins
  const giPatterns = [
    /(đau\s?bụng|abdominal\s?pain|腹痛)/i,
    /(táo\s?bón|constipation|便秘)/i,
    /(trào\s?ngược|reflux|反流)/i,
    /(đầy\s?hơi|bloating|腹胀)/i,
    /(viêm\s?dạ\s?dày|gastritis|胃炎)/i
  ];
  
  if (giPatterns.some(p => p.test(keyword))) {
    return {
      category: 'gastro',
      sources: [
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin về tiêu hóa'
        },
        {
          title: `Johns Hopkins - ${symptomKeyword}`,
          url: `https://www.hopkinsmedicine.org/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Johns Hopkins',
          snippet: 'Bệnh viện Johns Hopkins'
        },
        {
          title: `WHO - ${symptomKeyword}`,
          url: `https://www.who.int/health-topics/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 WHO',
          snippet: 'Thông tin từ WHO'
        }
      ]
    };
  }
  
  // 6. TRIỆU CHỨNG HÔ HẤP - WHO, CDC, Mayo Clinic
  const respiratoryPatterns = [
    /(hen|asthma|哮喘)/i,
    /(khó thở|shortness of breath|呼吸困难)/i,
    /(viêm họng|sore throat|喉咙痛)/i,
    /(viêm xoang|sinusitis|鼻窦炎)/i
  ];
  
  if (respiratoryPatterns.some(p => p.test(keyword))) {
    return {
      category: 'respiratory',
      sources: [
        {
          title: `WHO - ${symptomKeyword}`,
          url: `https://www.who.int/health-topics/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 WHO',
          snippet: 'Hướng dẫn về bệnh hô hấp'
        },
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin về hệ hô hấp'
        },
        {
          title: `CDC - ${symptomKeyword}`,
          url: `https://www.cdc.gov/search/?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🔬 CDC',
          snippet: 'Thông tin từ CDC'
        }
      ]
    };
  }
  
  // 7. TRIỆU CHỨNG THẦN KINH - Mayo Clinic, Johns Hopkins, NINDS
  const neuroPatterns = [
    /(đau\s?đầu|headache|头痛|頭痛)/i,
    /(chóng\s?mặt|dizziness|头晕|眩晕)/i,
    /(tê\s?liệt|paralysis|麻痹)/i,
    /(run\s?tay|tremor|震颤)/i,
    /(đau\s?dây\s?thần\s?kinh|neuralgia)/i
  ];
  
  if (neuroPatterns.some(p => p.test(keyword))) {
    return {
      category: 'neuro',
      sources: [
        {
          title: `Mayo Clinic - ${symptomKeyword}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin về thần kinh'
        },
        {
          title: `Johns Hopkins - ${symptomKeyword}`,
          url: `https://www.hopkinsmedicine.org/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🏥 Johns Hopkins',
          snippet: 'Bệnh viện Johns Hopkins'
        },
        {
          title: `NINDS - ${symptomKeyword}`,
          url: `https://www.ninds.nih.gov/search?query=${encodeURIComponent(symptomKeyword)}`,
          source: '🧠 NINDS',
          snippet: 'Viện Thần kinh Quốc gia Mỹ'
        }
      ]
    };
  }
  
  // 8. DEFAULT - Mayo Clinic, WHO, Wikipedia Medical
  return {
    category: 'general',
    sources: [
      {
        title: `Mayo Clinic - ${symptomKeyword}`,
        url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(symptomKeyword)}`,
        source: '🏥 Mayo Clinic',
        snippet: 'Thông tin y tế tổng quát'
      },
      {
        title: `WHO - ${symptomKeyword}`,
        url: `https://www.who.int/health-topics/search?query=${encodeURIComponent(symptomKeyword)}`,
        source: '🏥 WHO',
        snippet: 'Tổ chức Y tế Thế giới'
      },
      {
        title: `MedlinePlus - ${symptomKeyword}`,
        url: `https://medlineplus.gov/search/?query=${encodeURIComponent(symptomKeyword)}`,
        source: '📚 MedlinePlus',
        snippet: 'Thư viện Y tế Quốc gia Mỹ'
      }
    ]
  };
}

/**
 * Main function: Tách triệu chứng + tạo web search thông minh
 */
async function smartSymptomSearch(userInput) {
  try {
    // Step 1: Extract symptom keywords (AI with fallback)
    const extraction = await extractSymptomKeywords(userInput);
    
    // Step 2: Categorize & get appropriate sources
    // Use the extracted/cleaned keyword for both categorization AND web search
    const result = categorizeSymptomAndGetSources(extraction.keyword);
    
    return {
      originalInput: userInput,
      extractedKeyword: extraction.keyword,
      category: result.category,
      sources: result.sources,
      searchPerformed: true,
      extractionMethod: extraction.method
    };
    
  } catch (error) {
    console.error('❌ Smart symptom search failed:', error);
    
    // Final fallback: use original input with general sources
    return {
      originalInput: userInput,
      extractedKeyword: userInput,
      category: 'general',
      sources: [
        {
          title: `Mayo Clinic - ${userInput}`,
          url: `https://www.mayoclinic.org/search/search-results?q=${encodeURIComponent(userInput)}`,
          source: '🏥 Mayo Clinic',
          snippet: 'Thông tin y tế tổng quát'
        }
      ],
      searchPerformed: false,
      extractionMethod: 'none',
      error: error.message
    };
  }
}

module.exports = {
  extractSymptomKeywords,
  categorizeSymptomAndGetSources,
  smartSymptomSearch
};

