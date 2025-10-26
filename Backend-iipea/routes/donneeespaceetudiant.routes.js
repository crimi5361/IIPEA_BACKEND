const express = require('express');
const router = express.Router();
const etudiantController = require('../controllers/donneeespaceetudiant.controller');
const { uploadStudentFiles } = require('../middleware/upload');

router.get('/profile/:id', etudiantController.getStudentProfile);
router.get('/infoProfile/:id', etudiantController.getinfoProfile);
router.post('/mise-a-jour-profile/:id', etudiantController.updateStudentProfile);
router.post('/profile/:id/photo', uploadStudentFiles().single('photo'), etudiantController.updateStudentPhoto);

module.exports = router;