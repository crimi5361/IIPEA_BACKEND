const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth.middleware');
const paiementController = require('../controllers/paiyement.controller');

router.post('/', authenticateToken, paiementController.createPaiement);
router.get('/Allpayement', authenticateToken, paiementController.getPaiementsByDepartement);


module.exports = router;