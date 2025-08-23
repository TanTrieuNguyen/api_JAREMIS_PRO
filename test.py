import json
import requests
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# --- CẤU HÌNH ---
# Nếu bạn có WHO ICD-API credentials, đặt ACCESS_TOKEN ở đây (hoặc để None để dùng sample local)
ACCESS_TOKEN = None  # "Bearer hoặc token phù hợp nếu bạn đã có"
API_BASE = "https://icd.who.int/icdapi"  # theo tài liệu WHO ICD-API
LANG = "vi"  # hoặc 'vi' nếu WHO đã có bản dịch tiếng Việt cho mục bạn cần

# --- BỘ DỮ LIỆU MẪU (dùng khi không có API) ---
SAMPLE_ICD = [
    {"code": "A00", "title": "Cholera", "definition": "Acute diarrheal disease caused by Vibrio cholerae."},
    {"code": "J06.9", "title": "Acute upper respiratory infection, unspecified", "definition": "Symptoms include sore throat, runny nose, cough."},
    {"code": "R50.9", "title": "Fever, unspecified", "definition": "Elevated body temperature without clear cause."},
    {"code": "E11", "title": "Type 2 diabetes mellitus", "definition": "Chronic condition characterized by insulin resistance."},
    {"code": "I10", "title": "Essential (primary) hypertension", "definition": "High blood pressure without a known secondary cause."},
    # ... bạn có thể mở rộng file JSON / CSV thực tế từ WHO
]

# --- HÀM GỌI WHO ICD-API (nếu có token) ---
def search_icd_api(query, token=None, top_n=20):
    """
    Gọi endpoint tìm kiếm ICD-11. Nếu không có token, raise Exception.
    Kết quả trả về list dict với keys: code, title, definition (nếu có).
    """
    if token is None:
        raise ValueError("Không có token. Dùng sample local hoặc cung cấp ACCESS_TOKEN.")
    url = f"{API_BASE}/icd/entity/search"
    headers = {
        "API-Version": "v2",
        "Accept-Language": LANG,
        "Authorization": f"Bearer {token}"
    }
    params = {
        "q": query,
        "flatResults": "true",
        "releaseId": "mms",  # linearization MMS (morbidity & mortality) — tuỳ mục đích
        # bạn có thể thêm propertiesToBeSearched
    }
    resp = requests.get(url, headers=headers, params=params, timeout=20)
    resp.raise_for_status()
    data = resp.json()

    results = []
    # cấu trúc JSON có thể khác nhau theo version, ta xử lý an toàn:
    # tìm mảng kết quả ở keys thông thường
    candidates = None
    for key in ("destination", "results", "items", "entities", "collection"):
        if key in data and isinstance(data[key], list):
            candidates = data[key]
            break
    if candidates is None:
        # thử một số key phổ biến
        candidates = data.get("result", []) or data.get("items", []) or []

    for it in candidates[:top_n]:
        # cố gắng đọc code, title, definition ở nhiều tên field khác nhau
        code = it.get("id") or it.get("code") or it.get("skos:notation") or it.get("icd:code")
        title = it.get("title") or it.get("prefLabel") or it.get("label") or it.get("rdfs:label")
        # definition có thể trong nhiều chỗ
        definition = it.get("definition") or it.get("description") or it.get("fullySpecifiedName") or ""
        # nếu title là dict (nhiều ngôn ngữ) lấy lang
        if isinstance(title, dict):
            title = title.get(LANG) or next(iter(title.values()), "")
        results.append({"code": code, "title": title, "definition": definition})
    return results

# --- HÀM CHẠY SO SÁNH NỘI DUNG (TF-IDF + cosine) ---
def rank_candidates_by_similarity(query_text, candidates, top_k=5):
    """
    candidates: list of dicts with 'title' and/or 'definition'
    Trả về top_k candidate theo cosine similarity giữa query và (title+definition).
    """
    docs = []
    codes = []
    for c in candidates:
        text = ""
        if c.get("title"):
            text += c["title"] + ". "
        if c.get("definition"):
            text += c["definition"]
        docs.append(text.strip())
        codes.append(c.get("code", ""))

    # nếu không có docs, trả rỗng
    if len(docs) == 0:
        return []

    vect = TfidfVectorizer(stop_words='english')  # đơn giản; nếu muốn tiếng Việt, cần stoplist khác
    tfidf = vect.fit_transform([query_text] + docs)
    q_vec = tfidf[0:1]
    doc_vecs = tfidf[1:]
    sims = cosine_similarity(q_vec, doc_vecs)[0]
    ranked_idx = sims.argsort()[::-1][:top_k]
    results = []
    for i in ranked_idx:
        results.append({
            "code": codes[i],
            "title": candidates[i].get("title",""),
            "definition": candidates[i].get("definition",""),
            "score": float(sims[i])
        })
    return results

# --- HÀM CHÍNH GIAO DIỆN DÒNG LỆNH ---
def main():
    print("=== ICD-11 simple diagnoser (tham khảo) ===")
    query = input("Nhập mô tả triệu chứng/triệu chứng ngắn: ").strip()
    if not query:
        print("Không có nội dung nhập. Thoát.")
        return

    # 1) Thử gọi API WHO nếu có token (ACCESS_TOKEN)
    if ACCESS_TOKEN:
        try:
            print("Gọi ICD-API của WHO để lấy dữ liệu...")
            candidates = search_icd_api(query, token=ACCESS_TOKEN, top_n=50)
            if not candidates:
                raise RuntimeError("API trả về không có kết quả, sẽ chuyển sang dữ liệu mẫu.")
        except Exception as e:
            print("Lỗi khi gọi API:", str(e))
            print("Sẽ dùng dữ liệu mẫu cục bộ.")
            candidates = SAMPLE_ICD
    else:
        print("Không có ACCESS_TOKEN — dùng bộ dữ liệu mẫu cục bộ.")
        candidates = SAMPLE_ICD

    # 2) rank bằng TF-IDF
    ranked = rank_candidates_by_similarity(query, candidates, top_k=8)
    if not ranked:
        print("Không tìm được kết quả phù hợp.")
        return

    print("\nKẾT QUẢ (tham khảo):")
    for i, r in enumerate(ranked, 1):
        print(f"{i}. [{r['score']:.3f}] {r['code']} — {r['title']}")
        # in thêm định nghĩa tóm tắt (nếu có)
        if r.get("definition"):
            print(f"    -> {r['definition'][:200]}{'...' if len(r['definition'])>200 else ''}")
    print("\nGhi chú: Đây là kết quả so khớp văn bản, KHÔNG thay cho chẩn đoán y khoa chuyên nghiệp.")

if __name__ == "__main__":
    main()