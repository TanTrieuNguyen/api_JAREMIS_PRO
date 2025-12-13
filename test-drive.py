from google.oauth2 import service_account
from googleapiclient.discovery import build

# 1️⃣ Đường dẫn đến file JSON bạn tải
SERVICE_ACCOUNT_FILE = 'jaremis-drive-service.json'

# 2️⃣ Quyền truy cập (ở đây là quyền làm việc với Drive)
SCOPES = ['https://www.googleapis.com/auth/drive.file']

# 3️⃣ Tạo credential từ file JSON
creds = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE, scopes=SCOPES)

# 4️⃣ Kết nối với API Google Drive
service = build('drive', 'v3', credentials=creds)

# 5️⃣ Lấy danh sách 5 file đầu tiên
results = service.files().list(
    pageSize=5, fields="files(id, name)").execute()

items = results.get('files', [])

if not items:
    print("Không tìm thấy file nào.")
else:
    print("Danh sách file trong Drive:")
    for item in items:
        print(f"{item['name']} ({item['id']})")
