const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const pvController = require('../controllers/PV.controller');

// Routes API (retournent du JSON)
router.get('/api/groupe/:groupeId', authenticateToken, pvController.genererPVByGroupe);
router.get('/api/groupe/:groupeId/semestre/:semestreId',  pvController.genererPVBySemestre);
router.get('/api/etudiant/:etudiantId', authenticateToken, pvController.genererPVByEtudiant);

// Routes WEB (retournent des pages EJS)
router.get('/vue/groupe/:groupeId/semestre/:semestreId', authenticateToken, pvController.afficherPVPage);

module.exports = router;