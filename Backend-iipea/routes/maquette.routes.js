// routes/maquetteRoutes.js
const express = require('express');
const router = express.Router();
const maquetteController = require('../controllers/maquette.controller');

router.post('/create-maquettes', maquetteController.createMaquette);
router.get('/', maquetteController.getAllMaquettes);
router.get('/annees-accademique', maquetteController.getAllAnnee);
router.get('/maquettes/:id', maquetteController.getMaquetteDetail);
router.get('/maquettes/:id/ues', maquetteController.getMaquetteUes);
router.get('/maquettes/:id/matieres', maquetteController.getMaquetteMatieres);

module.exports = router;