const express = require('express');
const router = express.Router();
const ueController = require('../controllers/ue.controller');

router.get('/', ueController.getAllUes);
router.post('/ues', ueController.createUE);



module.exports = router;