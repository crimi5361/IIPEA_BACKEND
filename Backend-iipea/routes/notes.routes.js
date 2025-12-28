const express = require('express');
const router = express.Router();
const notesController = require('../controllers/chargementNote');

// Utilisez uploadMiddleware au lieu de handleUpload
const uploadMiddleware = notesController.uploadMiddleware;

// Route OPTIONS pour CORS preflight
router.options('/upload', (req, res) => {
  console.log('✈️ Preflight OPTIONS reçu pour /upload');
  res.header('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'http://localhost:5173');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.status(200).end();
});

// Route de test simple
router.post('/test', notesController.testAPI);

// Route pour tester FormData - CORRIGÉ: utiliser uploadMiddleware
router.post('/test-upload', uploadMiddleware, (req, res) => {
  console.log('✅ Test FormData réussi');
  console.log('📁 Fichier reçu:', req.file);
  console.log('📦 Body reçu:', req.body);
  
  res.json({
    success: true,
    message: 'FormData reçu avec succès!',
    file: req.file ? {
      filename: req.file.filename,
      originalname: req.file.originalname,
      size: req.file.size,
      path: req.file.path
    } : null,
    body: req.body,
    timestamp: new Date().toISOString()
  });
});

// Route principale pour upload des notes - CORRIGÉ: utiliser uploadMiddleware
router.post('/upload', uploadMiddleware, notesController.uploadNotes);

// Retirez la route suivante car la fonction n'existe pas :
// router.post('/validate', uploadMiddleware, notesController.validateExcelFile);

// Routes supplémentaires
router.get('/template/:groupeId/:matiereId', notesController.downloadTemplate);
router.get('/groupe/:groupeId', notesController.getNotesByGroupe);
router.get('/status', notesController.getUploadStatus);
router.get('/groupe/:groupeId/details', notesController.getGroupeDetails);
// NOUVELLE ROUTE: Vérifier les notes existantes
router.get('/check-existing/:groupeId/:matiereId', notesController.checkExistingNotes);

// Route de debug pour vérifier
router.get('/debug-exports', (req, res) => {
  res.json({
    success: true,
    exports: Object.keys(notesController).filter(key => typeof notesController[key] === 'function'),
    uploadMiddlewareExists: typeof uploadMiddleware === 'function',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;