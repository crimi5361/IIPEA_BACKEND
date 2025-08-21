const db = require('../config/db.config');

exports.createPaiement = async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const { etudiant_id, montant, methode, veut_kit_ecole, demande_pec, type_pec, pourcentage_reduction, reference_pec } = req.body;
    const userId = req.user.id;
    const userCode = req.user.code;
    const date_paiement = new Date();
    const kitAmount = 10000;

    // Validation des données d'entrée
    if (!etudiant_id || !montant || !methode) {
      throw new Error('Données manquantes: etudiant_id, montant et methode sont requis');
    }

    if (isNaN(parseFloat(montant)) || parseFloat(montant) <= 0) {
      throw new Error('Le montant doit être un nombre positif');
    }

    // Vérifier l'existence de kit et PEC active
    const [kitResult, pecResult] = await Promise.all([
      client.query('SELECT * FROM kit WHERE etudiant_id = $1', [etudiant_id]),
      client.query(
        `SELECT * FROM prise_en_charge 
         WHERE etudiant_id = $1 AND statut = 'valide'`,
        [etudiant_id]
      )
    ]);

    const hasKit = kitResult.rows.length > 0;
    const hasActivePEC = pecResult.rows.length > 0;
    const pecActive = hasActivePEC ? pecResult.rows[0] : null;

    // 1. Vérifier si c'est le premier paiement
    const checkPremierPaiement = await client.query(
      'SELECT COUNT(*) FROM paiement WHERE etudiant_id = $1',
      [etudiant_id]
    );
    const isPremierPaiement = parseInt(checkPremierPaiement.rows[0].count) === 0;

    // Gestion du kit pour le premier paiement - TOUJOURS créer une entrée kit
    if (isPremierPaiement && !hasKit) {
      let kitMontant = 0;
      let kitDeposer = false;
      
      if (veut_kit_ecole) {
        // Cas 1: Case cochée - a payé le kit à l'école
        kitMontant = kitAmount;
        kitDeposer = true;
      }
      // Cas 2: Case non cochée - montant 0 et deposer false
      
      await client.query(
        `INSERT INTO kit (etudiant_id, montant, deposer, date_enregistrement)
         VALUES ($1, $2, $3, $4)`,
        [etudiant_id, kitMontant, kitDeposer, date_paiement]
      );
    }

    // Gestion de la demande de prise en charge
    if (demande_pec && !hasActivePEC) {
      if (!type_pec || !pourcentage_reduction) {
        throw new Error('Données manquantes pour la prise en charge: type_pec et pourcentage_reduction sont requis');
      }

      await client.query(
        `INSERT INTO prise_en_charge 
         (etudiant_id, type_pec, pourcentage_reduction, reference, statut, date_demande)
         VALUES ($1, $2, $3, $4, 'en_attente', $5)`,
        [etudiant_id, type_pec, pourcentage_reduction, reference_pec || null, date_paiement]
      );
    }

    // 2. Créer le reçu avec un numéro unique
    const numeroRecu = `RECU-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const recuQuery = `
      INSERT INTO recu (
        numero_recu, date_emission, montant, emetteur
      ) VALUES ($1, $2, $3, $4)
      RETURNING id
    `;
    const recuResult = await client.query(recuQuery, [
      numeroRecu,
      date_paiement,
      montant,
      userCode
    ]);
    const recuId = recuResult.rows[0].id;

    // 3. Enregistrement du paiement avec le reçu
    const paiementQuery = `
      INSERT INTO paiement (
        montant, date_paiement, methode, effectue_par, etudiant_id, recu_id
      ) VALUES ($1, $2, $3, $4, $5, $6) 
      RETURNING id
    `;
    const paiementResult = await client.query(paiementQuery, [
      montant,
      date_paiement,
      methode,
      userId,
      etudiant_id,
      recuId
    ]);

    // 4. Récupération des infos étudiant
    const etudiantQuery = `
      SELECT 
        e.id, 
        f.nom as filiere, 
        f.sigle as filiere_sigle, 
        n.libelle as niveau,
        s.scolarite_verse, 
        s.montant_scolarite,
        s.id as scolarite_id,
        s.statut_etudiant
      FROM etudiant e
      JOIN scolarite s ON e.scolarite_id = s.id
      JOIN filiere f ON e.id_filiere = f.id
      JOIN niveau n ON e.niveau_id = n.id
      WHERE e.id = $1
    `;
    const etudiantResult = await client.query(etudiantQuery, [etudiant_id]);
    
    if (etudiantResult.rows.length === 0) {
      throw new Error('Étudiant non trouvé');
    }
    
    const etudiant = etudiantResult.rows[0];

    // 5. Calcul des nouvelles valeurs avec parseFloat
    const currentVerse = parseFloat(etudiant.scolarite_verse) || 0;
    const totalScolarite = parseFloat(etudiant.montant_scolarite) || 0;
    const montantPaye = parseFloat(montant);

    // Application de la réduction PEC si active
    let montantReductionPEC = 0;
    if (hasActivePEC) {
      montantReductionPEC = (totalScolarite * pecActive.pourcentage_reduction) / 100;
    }

    const newScolariteVerse = currentVerse + montantPaye;
    let newScolariteRestante = totalScolarite - newScolariteVerse - montantReductionPEC;

    // Validation des montants
    if (newScolariteRestante < 0) {
      throw new Error('Le montant payé ne peut pas dépasser le montant total de la scolarité');
    }

    // Détermination du statut
    let statutEtudiant = 'NON_SOLDE';
    if (Math.abs(newScolariteRestante) < 0.01) {
      statutEtudiant = 'SOLDE';
    }

    // 6. Mise à jour de la scolarité
    await client.query(
      `UPDATE scolarite 
       SET scolarite_verse = $1, 
           scolarite_restante = $2, 
           statut_etudiant = $3
       WHERE id = $4`,
      [newScolariteVerse, newScolariteRestante, statutEtudiant, etudiant.scolarite_id]
    );

    // 7. Gestion spécifique pour le premier paiement
    if (isPremierPaiement) {
      const nomClasse = `${etudiant.filiere} ${etudiant.filiere_sigle} ${etudiant.niveau}`;
      
      // Créer ou trouver la classe
      let classeResult = await client.query(
        'SELECT id FROM classe WHERE nom = $1', [nomClasse]
      );
      
      let classeId;
      if (classeResult.rows.length > 0) {
        classeId = classeResult.rows[0].id;
      } else {
        const newClasseResult = await client.query(
          `INSERT INTO classe (nom, description) 
           VALUES ($1, $2) RETURNING id`,
          [nomClasse, `Classe pour ${nomClasse}`]
        );
        classeId = newClasseResult.rows[0].id;
      }

      // Trouver ou créer un groupe disponible
      let groupeNumber = 1;
      let groupeId;
      let groupeTrouve = false;
      
      while (!groupeTrouve) {
        const nomGroupe = `${nomClasse} Groupe ${groupeNumber}`;
        const groupeResult = await client.query(
          `SELECT g.id, COUNT(e.id) as count_etudiants
           FROM groupe g 
           LEFT JOIN etudiant e ON e.groupe_id = g.id
           WHERE g.nom = $1 
           GROUP BY g.id`,
          [nomGroupe]
        );

        if (groupeResult.rows.length === 0) {
          const newGroupe = await client.query(
            `INSERT INTO groupe (nom, capacite_max, classe_id) 
             VALUES ($1, $2, $3) RETURNING id`,
            [nomGroupe, 70, classeId]
          );
          groupeId = newGroupe.rows[0].id;
          groupeTrouve = true;
        } else if (parseInt(groupeResult.rows[0].count_etudiants) < 70) {
          groupeId = groupeResult.rows[0].id;
          groupeTrouve = true;
        } else {
          groupeNumber++;
        }
      }

      await client.query(
        `UPDATE etudiant SET groupe_id = $1, standing = 'Inscrit' WHERE id = $2`,
        [groupeId, etudiant_id]
      );
    }

    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      data: {
        paiement_id: paiementResult.rows[0].id,
        recu_id: recuId,
        numero_recu: numeroRecu,
        scolarite_verse: newScolariteVerse,
        scolarite_restante: newScolariteRestante,
        statut_etudiant: statutEtudiant,
        is_premier_paiement: isPremierPaiement,
        kit_ajoute: isPremierPaiement && veut_kit_ecole,
        demande_pec_envoyee: demande_pec && !hasActivePEC,
        reduction_appliquee: hasActivePEC ? montantReductionPEC : 0
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lors de l\'enregistrement du paiement:', error);
    
    res.status(error.message.includes('Données manquantes') ? 400 : 500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'enregistrement du paiement'
    });
  } finally {
    client.release();
  }
};

// Nouveau contrôleur pour la validation des PEC par l'admin
exports.validerPEC = async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const { pec_id, action, motif_refus } = req.body;
    const adminId = req.user.id;

    if (!pec_id || !action) {
      throw new Error('Données manquantes: pec_id et action sont requis');
    }

    // Récupérer la PEC
    const pecResult = await client.query(
      `SELECT p.*, s.montant_scolarite, s.scolarite_verse, s.scolarite_restante
       FROM prise_en_charge p
       JOIN etudiant e ON p.etudiant_id = e.id
       JOIN scolarite s ON e.scolarite_id = s.id
       WHERE p.id = $1`,
      [pec_id]
    );

    if (pecResult.rows.length === 0) {
      throw new Error('Prise en charge non trouvée');
    }

    const pec = pecResult.rows[0];

    if (pec.statut !== 'en_attente') {
      throw new Error('Cette prise en charge a déjà été traitée');
    }

    if (action === 'valider') {
      // Calculer la réduction
      const reduction = (pec.montant_scolarite * pec.pourcentage_reduction) / 100;
      
      // Mettre à jour la scolarité
      const nouvelleScolariteRestante = pec.scolarite_restante - reduction;
      
      if (nouvelleScolariteRestante < 0) {
        throw new Error('La réduction dépasse le montant restant de la scolarité');
      }

      await client.query(
        `UPDATE scolarite 
         SET scolarite_restante = $1
         WHERE etudiant_id = $2`,
        [nouvelleScolariteRestante, pec.etudiant_id]
      );

      // Marquer comme validé
      await client.query(
        `UPDATE prise_en_charge 
         SET statut = 'valide', date_validation = $1, valide_par = $2, montant_reduction = $3
         WHERE id = $4`,
        [new Date(), adminId, reduction, pec_id]
      );

    } else if (action === 'refuser') {
      if (!motif_refus) {
        throw new Error('Le motif de refus est requis');
      }

      await client.query(
        `UPDATE prise_en_charge 
         SET statut = 'refuse', date_validation = $1, valide_par = $2, motif_refus = $3
         WHERE id = $4`,
        [new Date(), adminId, motif_refus, pec_id]
      );
    } else {
      throw new Error('Action non valide: doit être "valider" ou "refuser"');
    }

    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: action === 'valider' ? 'PEC validée avec succès' : 'PEC refusée avec succès' 
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur lors de la validation PEC:', error);
    
    res.status(error.message.includes('Données manquantes') ? 400 : 500).json({
      success: false,
      message: error.message || 'Erreur lors de la validation de la prise en charge'
    });
  } finally {
    client.release();
  }
};

exports.getPaiementCountByEtudiant = async (req, res) => {
  const client = await db.connect();
  
  try {
    const { id } = req.params;
    
    const countResult = await client.query(
      'SELECT COUNT(*) FROM paiement WHERE etudiant_id = $1',
      [id]
    );
    
    res.json({ 
      success: true, 
      count: parseInt(countResult.rows[0].count) 
    });
  } catch (error) {
    console.error('Erreur comptage paiements:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors du comptage des paiements' 
    });
  } finally {
    client.release();
  }
};

//===================================================================================================

exports.getPaiementsByDepartement = async (req, res) => {
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

    let whereClauses = ['d.id = $1'];
    const params = [departementId];

    // Filtres optionnels
    if (req.query.filiere) {
      whereClauses.push('f.nom = $' + (params.length + 1));
      params.push(req.query.filiere);
    }
    if (req.query.niveau) {
      whereClauses.push('n.libelle = $' + (params.length + 1));
      params.push(req.query.niveau);
    }
    if (req.query.date_debut) {
      whereClauses.push('p.date_paiement >= $' + (params.length + 1));
      params.push(req.query.date_debut);
    }
    if (req.query.date_fin) {
      whereClauses.push('p.date_paiement <= $' + (params.length + 1));
      params.push(req.query.date_fin);
    }

    const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // REQUÊTE CORRIGÉE avec exactement les champs demandés
    const dataQuery = `
      SELECT 
        p.montant,
        p.date_paiement,
        p.methode,
        r.numero_recu,
        r.date_emission,
        r.emetteur,
        e.nom as nom_etudiant,
        e.prenoms,
        d.nom as nom_departement,
        u.nom as nom_utilisateur_effectue_par
      FROM paiement p
      INNER JOIN recu r ON p.recu_id = r.id
      INNER JOIN etudiant e ON p.etudiant_id = e.id
      INNER JOIN departement d ON e.departement_id = d.id
      LEFT JOIN filiere f ON e.id_filiere = f.id
      LEFT JOIN niveau n ON e.niveau_id = n.id
      LEFT JOIN utilisateur u ON p.effectue_par::integer = u.id
      ${whereClause}
      ORDER BY p.date_paiement DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    // REQUÊTE DE COUNT CORRIGÉE
    const countQuery = `
      SELECT COUNT(*) 
      FROM paiement p
      INNER JOIN etudiant e ON p.etudiant_id = e.id
      INNER JOIN departement d ON e.departement_id = d.id
      LEFT JOIN filiere f ON e.id_filiere = f.id
      LEFT JOIN niveau n ON e.niveau_id = n.id
      ${whereClause}
    `;

    const queryParams = [...params, limit, offset];

    const [dataResult, countResult] = await Promise.all([
      db.query(dataQuery, queryParams),
      db.query(countQuery, params)
    ]);

    // STRUCTURATION SIMPLIFIÉE avec exactement les données demandées
    const paiements = dataResult.rows.map(row => ({
      montant: row.montant,
      date_paiement: row.date_paiement,
      methode: row.methode,
      numero_recu: row.numero_recu,
      date_emission: row.date_emission,
      emetteur: row.emetteur,
      nom_etudiant: row.nom_etudiant,
      prenoms_etudiant: row.prenoms,
      nom_departement: row.nom_departement,
      nom_utilisateur_effectue_par: row.nom_utilisateur_effectue_par
    }));

    return res.status(200).json({
      success: true,
      data: paiements,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
      total_pages: Math.ceil(parseInt(countResult.rows[0].count, 10) / limit)
    });

  } catch (err) {
    console.error("Erreur récupération paiements par département:", err);
    return res.status(500).json({
      success: false,
      error: "Erreur serveur",
      code: "SERVER_ERROR",
      details: err.message
    });
  }
};