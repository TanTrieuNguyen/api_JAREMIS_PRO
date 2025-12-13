/**
 * Google Drive JSON Service
 * Module để đọc/ghi file JSON trên Google Drive
 */

const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

/**
 * Đọc dữ liệu users từ Google Drive
 * @returns {Promise<Object>} - Users data object
 */
async function readUsersData() {
  try {
    // Fallback: Đọc từ file local nếu không có Drive
    const localPath = path.join(__dirname, 'users.json');
    const data = await fs.readFile(localPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.warn('⚠️ Could not read from Drive, using local file:', error.message);
    // Return empty users object nếu không đọc được
    return { users: {} };
  }
}

/**
 * Cập nhật dữ liệu users lên Google Drive
 * @param {Object} auth - Google Auth object
 * @param {string} fileId - Drive file ID
 * @param {Object} usersData - Data to upload
 * @returns {Promise<void>}
 */
async function updateUsersData(auth, fileId, usersData) {
  try {
    // Ghi vào file local
    const localPath = path.join(__dirname, 'users.json');
    await fs.writeFile(localPath, JSON.stringify(usersData, null, 2), 'utf8');
    console.log('✅ Users data saved to local file');

    // Nếu có auth và fileId, sync lên Drive
    if (auth && fileId) {
      const drive = google.drive({ version: 'v3', auth });
      
      const media = {
        mimeType: 'application/json',
        body: JSON.stringify(usersData, null, 2)
      };

      await drive.files.update({
        fileId: fileId,
        media: media,
        fields: 'id'
      });
      
      console.log('✅ Users data synced to Google Drive');
    }
  } catch (error) {
    console.error('❌ Error updating users data:', error.message);
    // Không throw error, chỉ log warning
  }
}

/**
 * Đọc file JSON từ Google Drive bằng file ID
 * @param {Object} auth - Google Auth object
 * @param {string} fileId - Drive file ID
 * @returns {Promise<Object>} - JSON data
 */
async function readJsonFromDrive(auth, fileId) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    
    const response = await drive.files.get({
      fileId: fileId,
      alt: 'media'
    });
    
    return response.data;
  } catch (error) {
    console.error('❌ Error reading from Drive:', error.message);
    throw error;
  }
}

/**
 * Ghi file JSON lên Google Drive
 * @param {Object} auth - Google Auth object
 * @param {string} fileId - Drive file ID
 * @param {Object} data - JSON data to write
 * @returns {Promise<void>}
 */
async function writeJsonToDrive(auth, fileId, data) {
  try {
    const drive = google.drive({ version: 'v3', auth });
    
    const media = {
      mimeType: 'application/json',
      body: JSON.stringify(data, null, 2)
    };

    await drive.files.update({
      fileId: fileId,
      media: media,
      fields: 'id'
    });
    
    console.log('✅ Data written to Google Drive');
  } catch (error) {
    console.error('❌ Error writing to Drive:', error.message);
    throw error;
  }
}

module.exports = {
  readUsersData,
  updateUsersData,
  readJsonFromDrive,
  writeJsonToDrive
};
