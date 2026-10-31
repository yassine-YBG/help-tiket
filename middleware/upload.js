const multer = require('multer');
const fs = require('fs');

// Créer le dossier uploads s'il n'existe pas
const uploadDir = 'uploads/tickets';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Types autorisés -> extension utilisée pour le fichier enregistré.
// L'extension vient du type vérifié, pas du nom envoyé par le client
// (évite par exemple "photo.png.html").
const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'text/plain': '.txt',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav', // Pour les producteurs de musique
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

// Configuration de multer pour le stockage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Générer un nom de fichier unique
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + ALLOWED_TYPES[file.mimetype]);
  }
});

// Filtre pour les types de fichiers
const fileFilter = (req, file, cb) => {
  if (Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, file.mimetype)) {
    cb(null, true);
  } else {
    const err = new Error('Type de fichier non autorisé');
    err.status = 400; // handled by the error handler in server.js -> 400 instead of 500
    cb(err, false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  }
});

module.exports = upload;
