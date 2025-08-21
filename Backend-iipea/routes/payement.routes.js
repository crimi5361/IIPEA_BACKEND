const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const paiementController = require('../controllers/paiyement.controller');

router.post('/', authenticateToken, paiementController.createPaiement);
router.get('/Allpayement', authenticateToken, paiementController.getPaiementsByDepartement);


// Nouvelles routes à ajouter
router.get('/etudiant/:id/count', authenticateToken, paiementController.getPaiementCountByEtudiant);
router.post('/valider-pec', authenticateToken, paiementController.validerPEC); // Cette fonction existe déjà dans votre contrôleur !


module.exports = router;