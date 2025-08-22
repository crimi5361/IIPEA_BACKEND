const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const priseEnChargeController = require('../controllers/priseEnCharge.controller'); 

router.get('/etudiant/:id/active', authenticateToken, priseEnChargeController.getActivePECByEtudiant);
router.get('/pec-en-attente', authenticateToken, priseEnChargeController.getPECEnAttente);


module.exports = router;