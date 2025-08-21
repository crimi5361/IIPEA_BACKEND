const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const classesController = require('../controllers/classes.controller');

// Pour la page Classes (liste simple)
router.get('/classes/liste', authenticateToken, classesController.getListeClasses);

// Pour la page DetailClasse
router.get('/classe/:id', authenticateToken, classesController.getDetailClasse);

// Pour la page DetailGroupe  
router.get('/groupe/:id', authenticateToken, classesController.getDetailGroupe);

// Pour les années académiques (commun)
router.get('/annees-academiques', authenticateToken, classesController.getAnneesAcademiques);

// Ancienne route (conservée pour compatibilité)
router.get('/classes', authenticateToken, classesController.getClassesAvecGroupes);

module.exports = router;