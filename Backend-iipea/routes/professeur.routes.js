const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const professeurController = require('../controllers/professeurController');

// Routes CRUD pour les professeurs
router.get('/', authenticateToken, professeurController.getAllProfesseurs);
router.post('/', authenticateToken, professeurController.createProfesseur);
router.post('/:id', authenticateToken, professeurController.updateProfesseur);

// Soft delete (désactivation)
router.delete('/:id', authenticateToken, professeurController.softDeleteProfesseur);

// Réactivation
router.post('/:id/activate', authenticateToken, professeurController.activateProfesseur);

// Voir les inactifs (optionnel)
router.get('/inactifs', authenticateToken, professeurController.getInactifsProfesseurs);
// Dans routes/professeur.js, ajoutez cette route

module.exports = router;