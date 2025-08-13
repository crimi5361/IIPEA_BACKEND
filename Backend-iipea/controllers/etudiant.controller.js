const db = require('../config/db.config');
const bcrypt = require('bcrypt');
const moment = require('moment');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const UPLOAD_DIR = path.join(__dirname, '../uploads/photos');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function generateCodeUnique(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

exports.addEtudiant = async (req, res) => {
  try {
    // Vérification de l'authentification
    if (!req.user?.id) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentification requise',
        code: 'AUTH_REQUIRED'
      });
    }

    // Transformation et validation des données
    const data = {
      etudiant: req.body.etudiant || {},
      academique: req.body.academique || {},
      inscription: req.body.inscription || {},
      documents: Array.isArray(req.body.documents) ? req.body.documents : []
    };

    // Normalisation des noms de champs
    if (data.inscription.filiere_id) {
      data.inscription.id_filiere = data.inscription.filiere_id;
      delete data.inscription.filiere_id;
    }

    // Validation des champs obligatoires
    const requiredFields = {
      etudiant: ['nom', 'prenoms', 'date_naissance', 'sexe', 'nationalite'],
      academique: ['matricule', 'annee_academique_id'],
      inscription: ['niveau_id', 'id_filiere']
    };

    const missingFields = {};
    Object.keys(requiredFields).forEach(section => {
      const fields = requiredFields[section].filter(field => !data[section][field]);
      if (fields.length > 0) missingFields[section] = fields;
    });

    if (Object.keys(missingFields).length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Champs obligatoires manquants',
        missingFields,
        code: 'MISSING_FIELDS'
      });
    }

    // Gestion de la photo
    let photoUrl = null;
    if (req.files?.photo?.[0]) {
      try {
        const photoFile = req.files.photo[0];
        const fileExt = path.extname(photoFile.originalname).toLowerCase();
        const allowedExtensions = ['.jpg', '.jpeg', '.png'];
        
        if (!allowedExtensions.includes(fileExt)) {
          return res.status(400).json({
            success: false,
            error: 'Format de photo invalide. Formats acceptés: JPG, JPEG, PNG',
            code: 'INVALID_PHOTO_FORMAT'
          });
        }

        // Génération d'un nom de fichier unique
        const filename = `photo_${uuidv4()}${fileExt}`;
        const filepath = path.join(UPLOAD_DIR, filename);
        
        await fs.promises.writeFile(filepath, photoFile.buffer);
        photoUrl = `/uploads/photos/${filename}`;
      } catch (error) {
        console.error('Erreur traitement photo:', error);
        return res.status(500).json({
          success: false,
          error: 'Erreur lors du traitement de la photo',
          code: 'PHOTO_PROCESSING_ERROR'
        });
      }
    }

    // Génération des identifiants
    const cleanName = (str) => {
      return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '.').toLowerCase();
    };

    const email = `${cleanName(data.etudiant.prenoms.split(' ')[0])}.${cleanName(data.etudiant.nom)}@iipea.com`;
    const hashedPassword = await bcrypt.hash('@elites@', 10);
    const code_unique = generateCodeUnique();

    await db.query('BEGIN');

    try {
      // 1. Insertion de l'étudiant
      const etudiantQuery = `
        INSERT INTO etudiant (
          matricule, nom, prenoms, date_naissance, lieu_naissance, telephone, email,
          lieu_residence, contact_parent, code_unique, annee_bac, serie_bac, etablissement_origine,
          inscrit_par, photo_url, departement_id, annee_academique_id, groupe_id,
          niveau_id, statut_scolaire, nationalite, standing, numero_table, sexe, password,
          curcus_id, id_filiere, date_inscription
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW())
        RETURNING id
      `;

      const etudiantValues = [
        data.academique.matricule,
        data.etudiant.nom.toUpperCase(),
        data.etudiant.prenoms.toUpperCase(),
        moment(data.etudiant.date_naissance).format('YYYY-MM-DD'),
        data.etudiant.lieu_naissance,
        data.etudiant.telephone,
        email,
        data.etudiant.lieu_residence,
        data.etudiant.contact_parent,
        code_unique,
        data.academique.annee_bac || null,
        data.academique.serie_bac || null,
        data.academique.etablissement_origine || null,
        req.user.id, // Utilisation de l'ID de l'utilisateur connecté
        photoUrl,
        req.user.departement_id || 1,
        data.academique.annee_academique_id,
        null, // groupe_id
        data.inscription.niveau_id,
        data.academique.statut_scolaire || 'Non affecté',
        data.etudiant.nationalite,
        'en attente',
        data.academique.numero_table || null,
        data.etudiant.sexe,
        hashedPassword,
        data.inscription.curcus_id || null,
        data.inscription.id_filiere
      ];

      const etudiantResult = await db.query(etudiantQuery, etudiantValues);
      const etudiantId = etudiantResult.rows[0].id;

    // Dans la requête d'insertion des documents :
     // Dans la partie traitement des documents
const parseDocumentValue = (val) => val === 'true' ? 'oui' : 'non';

const docResult = await db.query(
  `INSERT INTO document (
    extrait_naissance, justificatif_identite, fiche_orientation, dernier_diplome
  ) VALUES ($1, $2, $3, $4)
  RETURNING id`,
  [
    parseDocumentValue(data.documents.find(d => d.nom === 'EXTRAIT_DE_NAISSANCE')?.fourni),
    parseDocumentValue(data.documents.find(d => d.nom === 'JUSTIFICATIF_IDENTITE')?.fourni),
    parseDocumentValue(data.documents.find(d => d.nom === 'FICHE_ORIENTATION')?.fourni),
    parseDocumentValue(data.documents.find(d => d.nom === 'COPIES_BAC')?.fourni)
  ]
);
      
      // Mise à jour de l'étudiant avec le document_id
      await db.query(
        `UPDATE etudiant SET document_id = $1 WHERE id = $2`,
        [docResult.rows[0].id, etudiantId]
      );

      // 3. Insertion de la scolarité
      const scolariteResult = await db.query(
        `INSERT INTO scolarite (
          montant_scolarite, scolarite_verse, statut_etudiant
        ) VALUES ($1, $2, $3)
        RETURNING id`,
        [
          data.inscription.montant_scolarite || 0,
          0,
          'en attente'
        ]
      );

      // Mise à jour de l'étudiant avec le scolarite_id
      await db.query(
        `UPDATE etudiant SET scolarite_id = $1 WHERE id = $2`,
        [scolariteResult.rows[0].id, etudiantId]
      );

      await db.query('COMMIT');

      return res.status(201).json({
        success: true,
        data: { 
          id: etudiantId, 
          code_unique, 
          email, 
          photoUrl,
          matricule: data.academique.matricule
        }
      });

    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Erreur DB:', err);

      // Nettoyage de la photo en cas d'erreur
      if (photoUrl) {
        const filepath = path.join(UPLOAD_DIR, path.basename(photoUrl));
        fs.unlink(filepath, () => {});
      }

      // Gestion des erreurs de contrainte unique
      if (err.code === '23505') {
        return res.status(409).json({
          success: false,
          error: 'Un étudiant avec ce matricule ou cet email existe déjà',
          code: 'DUPLICATE_ENTRY'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Erreur base de données',
        code: 'DATABASE_ERROR',
        details: process.env.NODE_ENV === 'development' ? {
          message: err.message,
          stack: err.stack
        } : undefined
      });
    }

  } catch (err) {
    console.error('Erreur globale:', err);
    return res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};