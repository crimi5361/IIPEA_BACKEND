const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const etudiantController = require('../controllers/etudiant.controller');
const { uploadStudentFiles } = require('../middleware/uploas');

const upload = uploadStudentFiles();

// Route d'inscription d'un étudiant
router.post(
  '/inscription',
  authenticateToken,
  (req, res, next) => {
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

// Route pour récupérer les étudiants par département
router.post(
  '/EtudiantsByDepartement',
  authenticateToken,
  etudiantController.getEtudiantsByDepartement
);

router.get(
  '/EtudiantsByDepartementEnattente',
  authenticateToken,
  etudiantController.getEtudiantsByDepartementEnAttente
);

// Route pour récupérer les détails d'un étudiant
router.get('/etudiant/:id', authenticateToken, etudiantController.getEtudiantById);

router.get('/recu-data/:id', authenticateToken, etudiantController.getRecuData);


module.exports = router;