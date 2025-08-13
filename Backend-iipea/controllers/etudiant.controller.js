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

function generateCodeUnique(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

// Fonction pour générer le matricule IIPEA
async function generateMatriculeIIPEA(anneeAcademiqueId, filiereId) {
  try {
    // Récupérer l'année académique (2 derniers chiffres de la deuxième partie)
    const anneeRes = await db.query('SELECT annee FROM anneeacademique WHERE id = $1', [anneeAcademiqueId]);
    let annee = '00';
    
    if (anneeRes.rows[0]?.annee) {
      // Extraire les 2 derniers chiffres de la deuxième partie (ex: "2026-2027" => "27")
      const yearParts = anneeRes.rows[0].annee.split('-');
      if (yearParts.length === 2) {
        annee = yearParts[1].slice(-2);
      }
    }

    // Récupérer le sigle de la filière
    const filiereRes = await db.query('SELECT sigle FROM filiere WHERE id = $1', [filiereId]);
    const sigle = filiereRes.rows[0]?.sigle || 'XX';

    // Générer une partie aléatoire (6 caractères)
    const randomPart = generateCodeUnique(6);

    // Récupérer le dernier numéro séquentiel pour cette combinaison
    const countRes = await db.query(
      `SELECT COUNT(*) FROM etudiant 
       WHERE matricule_iipea LIKE $1 || $2 || '%'`,
      [annee, sigle]
    );
    const sequenceNumber = (parseInt(countRes.rows[0].count) + 1).toString().padStart(4, '0');

    return `${annee}${sigle}${randomPart}${sequenceNumber}`;
  } catch (error) {
    console.error('Erreur génération matricule IIPEA:', error);
    // Fallback si erreur
    return `${new Date().getFullYear().toString().slice(-2)}${generateCodeUnique(8)}`;
  }
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
      etudiant: ['nom', 'prenoms', 'date_naissance', 'sexe', 'nationalite', 'telephone', 'contact_parent'],
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
    
    // Génération du matricule IIPEA
    const matricule_iipea = await generateMatriculeIIPEA(
      data.academique.annee_academique_id,
      data.inscription.id_filiere
    );

    await db.query('BEGIN');

    try {
      // 1. Insertion de l'étudiant avec les nouveaux champs
      const etudiantQuery = `
        INSERT INTO etudiant (
          matricule, nom, prenoms, date_naissance, lieu_naissance, telephone, email,
          lieu_residence, contact_parent, code_unique, annee_bac, serie_bac, etablissement_origine,
          inscrit_par, photo_url, departement_id, annee_academique_id, groupe_id,
          niveau_id, statut_scolaire, nationalite, standing, numero_table, sexe, password,
          curcus_id, id_filiere, date_inscription, contact_etudiant, contact_parent_2, matricule_iipea
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, NOW(), $28, $29, $30)
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
        req.user.id,
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
        data.inscription.id_filiere,
        data.etudiant.telephone, // contact_etudiant
        data.etudiant.contact_parent_2 || null, // contact_parent_2
        matricule_iipea // matricule IIPEA généré
      ];

      const etudiantResult = await db.query(etudiantQuery, etudiantValues);
      const etudiantId = etudiantResult.rows[0].id;

      // 2. Insertion des documents
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
          matricule: data.academique.matricule,
          matricule_iipea,
          contact_etudiant: data.etudiant.telephone,
          contact_parent_2: data.etudiant.contact_parent_2 || null
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
        const field = err.detail.includes('matricule_iipea') ? 'matricule IIPEA' : 
                     err.detail.includes('email') ? 'email' : 'matricule';
        return res.status(409).json({
          success: false,
          error: `Un étudiant avec ce ${field} existe déjà`,
          code: 'DUPLICATE_ENTRY',
          field
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


///=====================================================================================================================
exports.getEtudiantsByDepartement = async (req, res) => {
  try {
    const departementId = req.query.departement_id || req.user?.departement_id;
    
    if (!departementId) {
      return res.status(400).json({
        success: false,
        message: "ID du département requis",
        code: "DEPARTMENT_ID_REQUIRED"
      });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    // REQUÊTE CORRIGÉE AVEC LES BONS NOMS DE TABLES/COLONNES
    const dataQuery = `
      SELECT 
        e.id as etudiant_id,
        e.code_unique as code_unique,
        e.nom as etudiant_nom,
        e.prenoms,
        f.nom as filiere,
        f.sigle as filiere_sigle,
        n.libelle as niveau,
        a.annee as annee_academique,
        a.etat as etat_annee,
        e.telephone,
        e.email as etudiant_email
      FROM etudiant e
      JOIN filiere f ON e.id_filiere = f.id
      JOIN niveau n ON e.niveau_id = n.id
      JOIN anneeacademique a ON e.annee_academique_id = a.id  /* Note: 'anneeacademique' en un seul mot */
      WHERE e.departement_id = $1
      ORDER BY e.nom ASC, e.prenoms ASC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) FROM etudiant e
      WHERE e.departement_id = $1
    `;

    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, [departementId, limit, offset]),
      db.query(countQuery, [departementId])
    ]);

    return res.status(200).json({
      success: true,
      data: dataResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit
    });

  } catch (err) {
    console.error("Erreur récupération étudiants:", err);
    return res.status(500).json({
      success: false,
      error: "Erreur serveur",
      code: "SERVER_ERROR",
      details: err.message
    });
  }
};