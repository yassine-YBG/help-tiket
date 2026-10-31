const fs = require('fs');

// Delete files multer already saved when the request is rejected afterwards
// (bad id, ticket not found, access denied, validation error, server error).
const removeUploadedFiles = (files) => {
  if (!Array.isArray(files)) return;
  files.forEach((file) => {
    fs.unlink(file.path, (err) => {
      if (err && err.code !== 'ENOENT') {
        console.error('❌ Failed to remove uploaded file:', file.path, err.message);
      }
    });
  });
};

module.exports = removeUploadedFiles;
