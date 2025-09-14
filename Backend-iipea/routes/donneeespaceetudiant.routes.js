const express = require('express');
const router = express.Router();
const etudiantControlle = require('../controllers/donneeespaceetudiant.controller');

router.get('/profile/:id',etudiantControlle.getStudentProfile);
module.exports = router;