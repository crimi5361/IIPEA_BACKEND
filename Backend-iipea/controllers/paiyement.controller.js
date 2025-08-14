const db = require('../config/db.config');

exports.createPaiement = async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    const { etudiant_id, montant, methode, date_paiement } = req.body;
    const userId = req.user.id;

    // 1. Enregistrement du paiement
    const paiementQuery = `
      INSERT INTO paiement (
        montant, date_paiement, methode, effectue_par, etudiant_id
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING id, recu_id
    `;
    const paiementResult = await client.query(paiementQuery, [
      montant,
      date_paiement,
      methode,
      userId,
      etudiant_id
    ]);

    // 2. Récupération des infos étudiant
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
    const etudiant = etudiantResult.rows[0];

    if (!etudiant) {
      throw new Error('Étudiant non trouvé');
    }

    // 3. Calcul des nouvelles valeurs
    const newScolariteVerse = parseFloat(etudiant.scolarite_verse) + parseFloat(montant);
    const newScolariteRestante = parseFloat(etudiant.montant_scolarite) - newScolariteVerse;

    // Validation des montants
    if (newScolariteRestante < 0) {
      throw new Error('Le montant payé ne peut pas dépasser le montant total de la scolarité');
    }

    // Détermination du statut selon la contrainte (NON_SOLDE avec underscore)
    let statutEtudiant = 'NON_SOLDE';
    if (newScolariteRestante === 0) {
      statutEtudiant = 'SOLDE';
    }

    // 4. Mise à jour de la scolarité
    await client.query(
      `UPDATE scolarite 
       SET scolarite_verse = $1, 
           scolarite_restante = $2, 
           statut_etudiant = $3
       WHERE id = $4`,
      [newScolariteVerse, newScolariteRestante, statutEtudiant, etudiant.scolarite_id]
    );

    // 5. Gestion de la classe/groupe (premier paiement)
    if (parseFloat(etudiant.scolarite_verse) === 0) {
      const nomClasse = `${etudiant.filiere} ${etudiant.filiere_sigle} ${etudiant.niveau}`;
      
      // Créer ou trouver la classe
      let classeResult = await client.query(
        'SELECT id FROM classe WHERE nom = $1', [nomClasse]
      );
      let classeId = classeResult.rows[0]?.id;
      
      if (!classeId) {
        classeResult = await client.query(
          `INSERT INTO classe (nom, description) 
           VALUES ($1, $2) RETURNING id`,
          [nomClasse, `Classe pour ${nomClasse}`]
        );
        classeId = classeResult.rows[0].id;
      }

      // Trouver ou créer un groupe disponible
      let groupeNumber = 1;
      let groupeId;
      
      while (true) {
        const nomGroupe = `${nomClasse} Groupe ${groupeNumber}`;
        const groupeResult = await client.query(
          `SELECT g.id, COUNT(e.id) as count 
           FROM groupe g LEFT JOIN etudiant e ON e.groupe_id = g.id
           WHERE g.nom = $1 GROUP BY g.id`,
          [nomGroupe]
        );

        if (groupeResult.rows.length === 0 || groupeResult.rows[0].count < 70) {
          if (groupeResult.rows.length === 0) {
            const newGroupe = await client.query(
              `INSERT INTO groupe (nom, capacite_max, classe_id) 
               VALUES ($1, 70, $2) RETURNING id`,
              [nomGroupe, classeId]
            );
            groupeId = newGroupe.rows[0].id;
          } else {
            groupeId = groupeResult.rows[0].id;
          }
          break;
        }
        groupeNumber++;
      }

      // Mettre à jour l'étudiant
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
        recu_id: paiementResult.rows[0].recu_id,
        scolarite_restante: newScolariteRestante,
        statut_etudiant: statutEtudiant
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Erreur:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Erreur lors de l\'enregistrement du paiement'
    });
  } finally {
    client.release();
  }
};