const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

function getDriveClient() {
    // Kiểm tra biến môi trường
    const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
    const fileId = process.env.GOOGLE_DRIVE_USERS_FILE_ID;
    if (!keyPath || !fs.existsSync(keyPath)) {
        console.error('Không tìm thấy file Service Account JSON:', keyPath);
        throw new Error('Service Account JSON file not found');
    }
    if (!fileId) {
        console.error('Chưa cấu hình GOOGLE_DRIVE_USERS_FILE_ID trong .env');
        throw new Error('Missing GOOGLE_DRIVE_USERS_FILE_ID');
    }
    // Kiểm tra email Service Account
    let clientEmail = '';
    try {
        const keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        clientEmail = keyData.client_email || '';
    } catch (e) {
        console.error('Lỗi đọc file Service Account JSON:', e);
    }
    console.log('Đang dùng Service Account:', clientEmail);
    console.log('Đường dẫn file JSON:', keyPath);
    console.log('FileId Drive:', fileId);
    // Khởi tạo Google Drive client với Service Account
    const auth = new google.auth.GoogleAuth({
        keyFile: keyPath,
        scopes: ['https://www.googleapis.com/auth/drive'],
    });
    return google.drive({ version: 'v3', auth });
}

/**
 * Đọc dữ liệu từ file users.json trên Google Drive
 * @returns {Promise<Array>} - Luôn trả về mảng users
 */
async function readUsersData() {
    try {
        const drive = getDriveClient();
        const response = await drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_USERS_FILE_ID,
            alt: 'media'
        });
        const rawData = response.data;
        let users = [];
        if (typeof rawData === 'string' && rawData.trim()) {
            try {
                const parsed = JSON.parse(rawData);
                users = Array.isArray(parsed) ? parsed : [];
            } catch (e) {
                console.error("Lỗi phân tích JSON từ Drive:", e);
                users = [];
            }
        } else {
            users = [];
        }
        // Đảm bảo chỉ trả về mảng
        if (!Array.isArray(users)) users = [];
        return users;
    } catch (err) {
        // Log chi tiết lỗi xác thực
        if (err && err.response && err.response.data && err.response.data.error) {
            const apiError = err.response.data.error;
            console.error('Lỗi Google Drive API:', apiError.code, apiError.message);
            if (apiError.code === 403) {
                console.error('Kiểm tra lại quyền chia sẻ file Drive cho Service Account, bật Drive API, và fileId đúng.');
            }
        } else {
            console.error("Lỗi đọc users từ Drive:", err);
        }
        return [];
    }
}

/**
 * Ghi đè dữ liệu vào file users.json trên Google Drive
 * @param {Array|Object} newDataObject - Dữ liệu mới (object hoặc array)
 * @returns {Promise<Object>} - Thông tin file sau khi cập nhật
 */
async function updateUsersData(newDataObject) {
    try {
        const drive = getDriveClient();
        // Chỉ truyền media và uploadType: 'media', KHÔNG truyền fields, KHÔNG truyền metadata!
        const res = await drive.files.update({
            fileId: process.env.GOOGLE_DRIVE_USERS_FILE_ID,
            media: {
                mimeType: 'application/json',
                body: JSON.stringify(newDataObject, null, 2)
            },
            uploadType: 'media'
        });
        // Đọc lại file sau khi ghi để xác nhận
        const verify = await drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_USERS_FILE_ID,
            alt: 'media'
        });
        console.log('Nội dung file sau khi ghi:', verify.data);
        return res.data;
    } catch (err) {
        console.error("Lỗi ghi users lên Drive:", err);
        throw err;
    }
}

/**
 * Ghi đè hoàn toàn file users.json trên Google Drive (xóa file cũ, tạo file mới)
 * @param {Array|Object} newDataObject - Dữ liệu mới (object hoặc array)
 * @returns {Promise<Object>} - Thông tin file mới sau khi tạo
 */
async function overwriteUsersFile(newDataObject) {
    try {
        const drive = getDriveClient();
        // Xóa file cũ
        await drive.files.delete({
            fileId: process.env.GOOGLE_DRIVE_USERS_FILE_ID
        });
        // Tạo file mới
        const res = await drive.files.create({
            requestBody: {
                name: 'users.json',
                mimeType: 'application/json'
            },
            media: {
                mimeType: 'application/json',
                body: JSON.stringify(newDataObject, null, 2)
            }
        });
        console.log('Đã ghi lại file users.json trên Drive:', res.data);
        console.warn('Hãy cập nhật fileId mới trong .env:', res.data.id);
        return res.data;
    } catch (err) {
        console.error("Lỗi ghi users lên Drive (overwrite):", err);
        throw err;
    }
}

/**
 * Đọc dữ liệu người dùng, ưu tiên từ Google Drive, sau đó là file local
 * @returns {Promise<Array>} - Danh sách người dùng (luôn là mảng)
 */
async function readUsers() {
    let users = [];
    try {
        users = await readUsersData(); // Đọc từ Drive, đã là mảng
        if (Array.isArray(users)) return users;
    } catch (err) {
        console.error("Lỗi khi đọc users từ Drive, thử đọc file local.", err);
    }
    // Fallback về file local nếu Drive lỗi hoặc không phải mảng
    try {
        const localData = fs.readFileSync('users.json', 'utf8');
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {
        // Không cần log lỗi file local
    }
    return [];
}

module.exports = { readUsersData, updateUsersData, readUsers, getDriveClient, overwriteUsersFile };
