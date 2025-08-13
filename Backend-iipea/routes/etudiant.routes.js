const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const etudiantController = require('../controllers/etudiant.controller');
const { uploadStudentFiles } = require('../middleware/uploas');

// Configuration spécifique pour les uploads étudiants
const upload = uploadStudentFiles();
router.post(
  '/inscription',
  authenticateToken,
  (req, res, next) => {
    // Middleware pour vérifier le Content-Type
    if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
      return res.status(400).json({
        error: 'Content-Type must be multipart/form-data'
      });
    }
    next();
  },
  upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'documents', maxCount: 5 }
  ]),
  etudiantController.addEtudiant
);

module.exports = router;