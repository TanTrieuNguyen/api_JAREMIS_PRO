/**
 * HYBRID MEDICAL IMAGE ANALYSIS
 * Hỗ trợ nhiều AI backend: OpenAI GPT-4o, Claude, Gemini, Ollama
 * Tự động fallback khi một service lỗi
 * 
 * Author: TT1403, ANT
 * Date: 2025
 */

const { getImageAnalysisPrompt, getImageTypeLabel, getImageIcon } = require('./medicalImageAnalysis');

/**
 * Phân tích ảnh với OpenAI GPT-4o Vision
 */
async function analyzeWithOpenAI(imageBase64, mimeType, imageType, patientContext = '') {
  try {
    const OpenAI = require('openai');
    const openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 30000
    });
    
    const prompt = getImageAnalysisPrompt(imageType, patientContext);
    
    console.log('🔬 [OpenAI GPT-4o] Analyzing image...');
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o", // hoặc "gpt-4-turbo"
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
                detail: "high"
              }
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0.3 // Ít creativity hơn cho y khoa
    });
    
    console.log('✅ [OpenAI GPT-4o] Analysis completed');
    return {
      analysis: response.choices[0].message.content,
      success: true,
      backend: 'openai-gpt4o',
      cost: estimateCost(response.usage)
    };
    
  } catch (error) {
    console.error('❌ [OpenAI] Failed:', error.message);
    return {
      analysis: null,
      success: false,
      backend: 'openai-gpt4o',
      error: error.message
    };
  }
}

/**
 * Phân tích ảnh với Claude 3.5 Sonnet
 */
async function analyzeWithClaude(imageBase64, mimeType, imageType, patientContext = '') {
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const anthropic = new Anthropic({ 
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 30000
    });
    
    const prompt = getImageAnalysisPrompt(imageType, patientContext);
    
    console.log('🔬 [Claude 3.5] Analyzing image...');
    
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 2048,
      temperature: 0.3,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: imageBase64
              }
            },
            {
              type: "text",
              text: prompt
            }
          ]
        }
      ]
    });
    
    console.log('✅ [Claude 3.5] Analysis completed');
    return {
      analysis: message.content[0].text,
      success: true,
      backend: 'claude-3.5-sonnet'
    };
    
  } catch (error) {
    console.error('❌ [Claude] Failed:', error.message);
    return {
      analysis: null,
      success: false,
      backend: 'claude-3.5-sonnet',
      error: error.message
    };
  }
}

/**
 * Phân tích ảnh với Gemini (Google)
 */
async function analyzeWithGemini(imageBase64, mimeType, imageType, genAI, patientContext = '') {
  try {
    // Use stable production model (not -latest beta)
    const model = genAI.getGenerativeModel({ 
      model: 'gemini-1.5-pro-latest' // Stable for cloud deployment
    });
    
    const prompt = getImageAnalysisPrompt(imageType, patientContext);
    
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType
      }
    };
    
    console.log('🔬 [Gemini] Analyzing image...');
    
    const result = await Promise.race([
      model.generateContent([prompt, imagePart]),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 30000)
      )
    ]);
    
    const response = await result.response;
    const analysis = response.text();
    
    console.log('✅ [Gemini] Analysis completed');
    return {
      analysis,
      success: true,
      backend: 'gemini-1.5-pro'
    };
    
  } catch (error) {
    console.error('❌ [Gemini] Failed:', error.message);
    return {
      analysis: null,
      success: false,
      backend: 'gemini',
      error: error.message
    };
  }
}

/**
 * Phân tích ảnh với Ollama LLaVA (Local, Free)
 */
async function analyzeWithOllama(imageBase64, imageType, patientContext = '') {
  try {
    const axios = require('axios');
    const prompt = getImageAnalysisPrompt(imageType, patientContext);
    
    console.log('🔬 [Ollama LLaVA] Analyzing image (local)...');
    
    const response = await axios.post('http://localhost:11434/api/generate', {
      model: 'llava:13b', // hoặc 'llava:7b' nếu RAM ít
      prompt: prompt,
      images: [imageBase64],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2000
      }
    }, {
      timeout: 60000 // Ollama có thể chậm hơn
    });
    
    console.log('✅ [Ollama LLaVA] Analysis completed');
    return {
      analysis: response.data.response,
      success: true,
      backend: 'ollama-llava',
      cost: 0 // FREE!
    };
    
  } catch (error) {
    console.error('❌ [Ollama] Failed:', error.message);
    return {
      analysis: null,
      success: false,
      backend: 'ollama-llava',
      error: error.message
    };
  }
}

/**
 * MAIN: Phân tích ảnh với auto-fallback
 * Thử các backend theo thứ tự ưu tiên
 */
async function analyzeImageHybrid(imageBase64, mimeType, imageType, genAI, patientContext = '') {
  // Thứ tự ưu tiên (có thể config qua env)
  const priority = (process.env.IMAGE_ANALYSIS_PRIORITY || 'openai,claude,gemini,ollama').split(',');
  
  const backends = {
    'openai': () => analyzeWithOpenAI(imageBase64, mimeType, imageType, patientContext),
    'claude': () => analyzeWithClaude(imageBase64, mimeType, imageType, patientContext),
    'gemini': () => analyzeWithGemini(imageBase64, mimeType, imageType, genAI, patientContext),
    'ollama': () => analyzeWithOllama(imageBase64, imageType, patientContext)
  };
  
  // Try each backend in order
  for (const backendName of priority) {
    const backend = backends[backendName.trim()];
    if (!backend) continue;
    
    // Skip if API key missing
    if (backendName === 'openai' && !process.env.OPENAI_API_KEY) continue;
    if (backendName === 'claude' && !process.env.ANTHROPIC_API_KEY) continue;
    if (backendName === 'gemini' && !genAI) continue;
    
    const result = await backend();
    
    if (result.success) {
      console.log(`✅ [HYBRID] Used backend: ${result.backend}`);
      return {
        imageType,
        analysis: result.analysis,
        success: true,
        backend: result.backend,
        cost: result.cost || 0
      };
    }
  }
  
  // All backends failed
  console.error('❌ [HYBRID] All backends failed');
  return {
    imageType,
    analysis: `⚠️ Không thể phân tích ảnh. Đã thử tất cả các AI backend nhưng đều thất bại.\n\n**Gợi ý:**\n- Kiểm tra API keys (OPENAI_API_KEY, ANTHROPIC_API_KEY)\n- Cài đặt Ollama (miễn phí): https://ollama.ai\n- Thử lại với ảnh chất lượng tốt hơn`,
    success: false,
    backend: 'none'
  };
}

/**
 * Phân tích nhiều ảnh với hybrid backend
 */
async function analyzeMedicalImagesHybrid(files, genAI, patientContext = '') {
  const { detectImageType } = require('./medicalImageAnalysis');
  const analyses = [];
  
  for (const file of files) {
    try {
      const imageType = detectImageType(file.originalname || file.filename || '');
      const imageBase64 = file.base64 || require('fs').readFileSync(file.path).toString('base64');
      const mimeType = file.mimetype || 'image/jpeg';
      
      const result = await analyzeImageHybrid(imageBase64, mimeType, imageType, genAI, patientContext);
      
      analyses.push({
        filename: file.originalname || file.filename,
        ...result
      });
      
    } catch (error) {
      console.error(`❌ [HYBRID] Error processing ${file.originalname}:`, error);
      analyses.push({
        filename: file.originalname || file.filename,
        imageType: 'unknown',
        analysis: `⚠️ Lỗi xử lý ảnh: ${error.message}`,
        success: false,
        backend: 'error',
        error: error.message
      });
    }
  }
  
  return analyses;
}

/**
 * Format báo cáo với backend info
 */
function formatImageAnalysisReportHybrid(analyses) {
  if (!analyses || analyses.length === 0) {
    return '';
  }
  
  let report = '\n\n## 🔬 PHÂN TÍCH HÌNH ẢNH Y TẾ\n\n';
  
  // Tổng kết backend đã dùng
  const backends = [...new Set(analyses.map(a => a.backend))];
  const totalCost = analyses.reduce((sum, a) => sum + (a.cost || 0), 0);
  
  report += `**Hệ thống AI:** ${backends.join(', ')}\n`;
  if (totalCost > 0) {
    report += `**Chi phí ước tính:** $${totalCost.toFixed(4)}\n`;
  }
  report += '\n---\n\n';
  
  analyses.forEach((img, index) => {
    const icon = getImageIcon(img.imageType);
    report += `### ${icon} ${index + 1}. ${img.filename}\n`;
    report += `**Loại:** ${getImageTypeLabel(img.imageType)}\n`;
    report += `**Backend:** ${img.backend}\n\n`;
    
    if (img.success) {
      report += img.analysis + '\n\n';
    } else {
      report += `⚠️ **Lỗi phân tích:** ${img.error || 'Không xác định'}\n\n`;
    }
    
    report += '---\n\n';
  });
  
  return report;
}

/**
 * Helper: Ước tính chi phí OpenAI
 */
function estimateCost(usage) {
  if (!usage) return 0;
  
  // GPT-4o pricing (as of 2025)
  const inputCost = (usage.prompt_tokens / 1000) * 0.005; // $0.005 per 1K input tokens
  const outputCost = (usage.completion_tokens / 1000) * 0.015; // $0.015 per 1K output tokens
  
  return inputCost + outputCost;
}

module.exports = {
  analyzeImageHybrid,
  analyzeMedicalImagesHybrid,
  formatImageAnalysisReportHybrid,
  analyzeWithOpenAI,
  analyzeWithClaude,
  analyzeWithGemini,
  analyzeWithOllama
};
