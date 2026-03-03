const db = require('../config/db.config');

// ============ FONCTION PRINCIPALE ============

/**
 * Génère le PV complet d'un groupe
 */
exports.genererPVByGroupe = async (req, res) => {
  try {
    const { groupeId } = req.params;
    
    console.log(`🎓 Génération PV pour groupe: ${groupeId}`);
    
    // 1. Récupérer les informations du groupe
    const groupeQuery = `
      SELECT 
        g.id, g.nom, g.classe_id,
        f.nom as filiere, f.sigle,
        tf.libelle as type_filiere,
        aa.annee as annee_academique
      FROM groupe g
      LEFT JOIN etudiant et ON et.groupe_id = g.id AND et.standing = 'Inscrit'
      LEFT JOIN filiere f ON f.id = et.id_filiere
      LEFT JOIN typefiliere tf ON tf.id = f.type_filiere_id
      LEFT JOIN anneeacademique aa ON aa.id = et.annee_academique_id
      WHERE g.id = $1
      LIMIT 1
    `;
    
    const groupeResult = await db.query(groupeQuery, [groupeId]);
    
    if (groupeResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Groupe ${groupeId} non trouvé` 
      });
    }
    
    const groupeInfo = groupeResult.rows[0];
    
    // 2. Récupérer tous les étudiants du groupe
    const etudiantsQuery = `
      SELECT 
        e.id, e.matricule_iipea, e.nom, e.prenoms, e.groupe_id,
        e.niveau_id, e.annee_academique_id, e.id_filiere,
        s.statut_etudiant
      FROM etudiant e
      LEFT JOIN scolarite s ON s.id = e.scolarite_id
      WHERE e.groupe_id = $1 
      AND e.standing = 'Inscrit'
      ORDER BY e.nom, e.prenoms
    `;
    
    const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
    const etudiants = etudiantsResult.rows;
    
    console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés`);
    
    // 3. Récupérer la structure académique
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, null);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées`);
    
    // Calculer le total des crédits de la maquette
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    console.log(`📊 Total crédits maquette: ${totalCreditsMaquette}`);
    
    // 4. Pour chaque étudiant, calculer les résultats
    const resultatsEtudiants = [];
    const etudiantsAReprendre = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
      
      // Calculer les résultats par UE avec harmonisation
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
        uesAvecResultats.push(resultatsUE);
      }
      
      // Calculer les totaux
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
      
      // Déterminer la décision (ADMIS ou AJOURNÉ uniquement)
      const decision = determinerDecisionFonction(
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere
      );
      
      const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
      
      // Collecter les ECUE à reprendre pour cet étudiant
      // RÈGLE : Un ECUE est à reprendre si :
      // 1. Il appartient à une UE non validée (moyenne UE < 10)
      // 2. Sa moyenne originale est < 10
      const ecueAReprendre = [];
      uesAvecResultats.forEach(ue => {
        // Ne considérer que les UE non validées
        if (!ue.valide) {
          ue.matieres.forEach(matiere => {
            // Moyenne originale (non harmonisée)
            const moyenneOriginale = matiere.harmonisee ? matiere.moyenne_originale : matiere.moyenne;
            
            // Un ECUE est à reprendre s'il a une note et que sa moyenne originale < 10
            if (matiere.a_note && moyenneOriginale < 10) {
              ecueAReprendre.push({
                ue_libelle: ue.libelle,
                ue_id: ue.ue_id,
                ue_valide: ue.valide,
                ue_moyenne: ue.moyenne,
                matiere_nom: matiere.nom,
                matiere_id: matiere.matiere_id,
                moyenne: moyenneOriginale,
                coefficient: matiere.coefficient,
                cc_original: matiere.cc_original || matiere.moyenne_cc,
                examen_original: matiere.examen_original || matiere.partiel,
                harmonisee: matiere.harmonisee || false
              });
            }
          });
        }
      });
      
      // Si l'étudiant a des ECUE à reprendre, l'ajouter à la liste
      if (ecueAReprendre.length > 0) {
        etudiantsAReprendre.push({
          etudiant_id: etudiant.id,
          matricule_iipea: etudiant.matricule_iipea,
          nom: etudiant.nom,
          prenoms: etudiant.prenoms,
          decision: decision,
          ecue_a_reprendre: ecueAReprendre,
          scolarite_soldee: aSoldeScolarite
        });
      }
      
      resultatsEtudiants.push({
        etudiant_id: etudiant.id,
        matricule_iipea: etudiant.matricule_iipea,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        moyenne_generale: totaux.moyenneGenerale,
        credits_valides: totaux.creditsValides,
        credits_total: totaux.creditsTotal,
        decision: decision,
        ues: uesAvecResultats,
        scolarite_soldee: aSoldeScolarite,
        statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI',
        ecue_a_reprendre: ecueAReprendre
      });
    }
    
    // 5. Trier les étudiants
    if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
      resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
    }
    
    // Compter les admis
    const admisCount = resultatsEtudiants.filter(e => e.decision === 'ADMIS').length;
    
    // 6. Structurer la réponse
    const pvComplet = {
      success: true,
      groupe: {
        id: groupeInfo.id,
        nom: groupeInfo.nom,
        annee_academique: groupeInfo.annee_academique
      },
      maquette: {
        id: structureAcademique.maquette_id,
        filiere: groupeInfo.filiere,
        sigle: groupeInfo.sigle,
        parcour: structureAcademique.parcour
      },
      type_filiere: groupeInfo.type_filiere,
      etudiants: resultatsEtudiants,
      etudiants_a_reprendre: etudiantsAReprendre,
      date_generation: new Date().toISOString(),
      statistiques: {
        total_etudiants: etudiants.length,
        total_admis: admisCount,
        total_ajournes: etudiants.length - admisCount,
        total_ue: structureAcademique.ues.length,
        total_credits_maquette: totalCreditsMaquette,
        statistiques_scolarite: {
          total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
          total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
        },
        statistiques_reprise: {
          total_etudiants_a_reprendre: etudiantsAReprendre.length,
          total_ecue_a_reprendre: etudiantsAReprendre.reduce((sum, e) => sum + e.ecue_a_reprendre.length, 0)
        }
      }
    };
    
    console.log('✅ PV généré avec succès');
    console.log(`📊 Statistiques: ${admisCount} admis sur ${etudiants.length} étudiants`);
    console.log(`📚 Reprise: ${etudiantsAReprendre.length} étudiants, ${etudiantsAReprendre.reduce((sum, e) => sum + e.ecue_a_reprendre.length, 0)} ECUE à reprendre`);
    
    res.json(pvComplet);
  } catch (error) {
    console.error('❌ Erreur génération PV:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la génération du PV',
      details: error.message
    });
  }
};

/**
 * Génère le PV d'un groupe pour un semestre spécifique
 */
exports.genererPVBySemestre = async (req, res) => {
  try {
    const { groupeId, semestreId } = req.params;
    
    console.log(`🎓 Génération PV pour groupe: ${groupeId}, semestre: ${semestreId}`);
    
    // 1. Récupérer les informations du groupe
    const groupeQuery = `
      SELECT 
        g.id, g.nom, g.classe_id,
        f.nom as filiere, f.sigle,
        tf.libelle as type_filiere,
        aa.annee as annee_academique
      FROM groupe g
      LEFT JOIN etudiant et ON et.groupe_id = g.id AND et.standing = 'Inscrit'
      LEFT JOIN filiere f ON f.id = et.id_filiere
      LEFT JOIN typefiliere tf ON tf.id = f.type_filiere_id
      LEFT JOIN anneeacademique aa ON aa.id = et.annee_academique_id
      WHERE g.id = $1
      LIMIT 1
    `;
    
    const groupeResult = await db.query(groupeQuery, [groupeId]);
    
    if (groupeResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Groupe ${groupeId} non trouvé` 
      });
    }
    
    const groupeInfo = groupeResult.rows[0];
    
    // 2. Récupérer tous les étudiants
    const etudiantsQuery = `
      SELECT 
        e.id, e.matricule_iipea, e.nom, e.prenoms, e.groupe_id,
        e.niveau_id, e.annee_academique_id, e.id_filiere,
        s.statut_etudiant
      FROM etudiant e
      LEFT JOIN scolarite s ON s.id = e.scolarite_id
      WHERE e.groupe_id = $1 
      AND e.standing = 'Inscrit'
      ORDER BY e.nom, e.prenoms
    `;
    
    const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
    const etudiants = etudiantsResult.rows;
    
    console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés`);
    
    // 3. Récupérer la structure académique pour le semestre
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées pour le semestre ${semestreId}`);
    
    // Calculer le total des crédits de la maquette
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    console.log(`📊 Total crédits maquette semestre ${semestreId}: ${totalCreditsMaquette}`);
    
    // 4. Pour chaque étudiant, calculer les résultats
    const resultatsEtudiants = [];
    const etudiantsAReprendre = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
      
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
        uesAvecResultats.push(resultatsUE);
      }
      
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
      
      const decision = determinerDecisionFonction(
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere
      );
      
      const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
      
      // Collecter les ECUE à reprendre pour cet étudiant
      const ecueAReprendre = [];
      uesAvecResultats.forEach(ue => {
        // Ne considérer que les UE non validées
        if (!ue.valide) {
          ue.matieres.forEach(matiere => {
            const moyenneOriginale = matiere.harmonisee ? matiere.moyenne_originale : matiere.moyenne;
            
            if (matiere.a_note && moyenneOriginale < 10) {
              ecueAReprendre.push({
                ue_libelle: ue.libelle,
                ue_id: ue.ue_id,
                ue_valide: ue.valide,
                ue_moyenne: ue.moyenne,
                matiere_nom: matiere.nom,
                matiere_id: matiere.matiere_id,
                moyenne: moyenneOriginale,
                coefficient: matiere.coefficient,
                cc_original: matiere.cc_original || matiere.moyenne_cc,
                examen_original: matiere.examen_original || matiere.partiel,
                harmonisee: matiere.harmonisee || false
              });
            }
          });
        }
      });
      
      if (ecueAReprendre.length > 0) {
        etudiantsAReprendre.push({
          etudiant_id: etudiant.id,
          matricule_iipea: etudiant.matricule_iipea,
          nom: etudiant.nom,
          prenoms: etudiant.prenoms,
          decision: decision,
          ecue_a_reprendre: ecueAReprendre,
          scolarite_soldee: aSoldeScolarite
        });
      }
      
      resultatsEtudiants.push({
        etudiant_id: etudiant.id,
        matricule_iipea: etudiant.matricule_iipea,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        moyenne_generale: totaux.moyenneGenerale,
        credits_valides: totaux.creditsValides,
        credits_total: totaux.creditsTotal,
        decision: decision,
        ues: uesAvecResultats,
        scolarite_soldee: aSoldeScolarite,
        statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI',
        ecue_a_reprendre: ecueAReprendre
      });
    }
    
    // 5. Trier
    if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
      resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
    }
    
    // Compter les admis
    const admisCount = resultatsEtudiants.filter(e => e.decision === 'ADMIS').length;
    
    // 6. Structurer la réponse
    const pvComplet = {
      success: true,
      groupe: {
        id: groupeInfo.id,
        nom: groupeInfo.nom,
        annee_academique: groupeInfo.annee_academique
      },
      maquette: {
        id: structureAcademique.maquette_id,
        filiere: groupeInfo.filiere,
        sigle: groupeInfo.sigle,
        parcour: structureAcademique.parcour
      },
      type_filiere: groupeInfo.type_filiere,
      semestre: {
        id: semestreId
      },
      etudiants: resultatsEtudiants,
      etudiants_a_reprendre: etudiantsAReprendre,
      date_generation: new Date().toISOString(),
      statistiques: {
        total_etudiants: etudiants.length,
        total_admis: admisCount,
        total_ajournes: etudiants.length - admisCount,
        total_ue: structureAcademique.ues.length,
        total_credits_maquette: totalCreditsMaquette,
        statistiques_scolarite: {
          total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
          total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
        },
        statistiques_reprise: {
          total_etudiants_a_reprendre: etudiantsAReprendre.length,
          total_ecue_a_reprendre: etudiantsAReprendre.reduce((sum, e) => sum + e.ecue_a_reprendre.length, 0)
        }
      }
    };
    
    console.log('✅ PV semestre généré avec succès');
    res.json(pvComplet);
  } catch (error) {
    console.error('❌ Erreur génération PV semestre:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la génération du PV semestre',
      details: error.message
    });
  }
};

/**
 * Génère le PV d'un étudiant
 */
exports.genererPVByEtudiant = async (req, res) => {
  try {
    const { etudiantId } = req.params;
    
    console.log(`🎓 Génération PV pour étudiant: ${etudiantId}`);
    
    const etudiantQuery = `
      SELECT 
        e.id, e.matricule_iipea, e.nom, e.prenoms, e.groupe_id,
        e.niveau_id, e.annee_academique_id, e.id_filiere,
        s.statut_etudiant
      FROM etudiant e
      LEFT JOIN scolarite s ON s.id = e.scolarite_id
      WHERE e.id = $1
    `;
    
    const etudiantResult = await db.query(etudiantQuery, [etudiantId]);
    
    if (etudiantResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: `Étudiant ${etudiantId} non trouvé` 
      });
    }
    
    const etudiant = etudiantResult.rows[0];
    
    const groupeQuery = `
      SELECT 
        g.id, g.nom,
        f.nom as filiere, f.sigle,
        tf.libelle as type_filiere
      FROM groupe g
      LEFT JOIN etudiant et ON et.groupe_id = g.id AND et.id = $1
      LEFT JOIN filiere f ON f.id = et.id_filiere
      LEFT JOIN typefiliere tf ON tf.id = f.type_filiere_id
      WHERE g.id = $2
      LIMIT 1
    `;
    
    const groupeResult = await db.query(groupeQuery, [etudiantId, etudiant.groupe_id]);
    const groupeInfo = groupeResult.rows[0];
    
    const structureAcademique = await getStructureAcademiqueFonction(etudiant.groupe_id, null);
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    
    const notes = await getNotesEtudiantAvecDetailsFonction(etudiantId, structureAcademique.maquette_id);
    
    const uesAvecResultats = [];
    for (const ue of structureAcademique.ues) {
      const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
      uesAvecResultats.push(resultatsUE);
    }
    
    const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
    
    const decision = determinerDecisionFonction(
      totaux.creditsValides, 
      totaux.creditsTotal, 
      groupeInfo.type_filiere
    );
    
    const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
    
    // Collecter les ECUE à reprendre
    const ecueAReprendre = [];
    uesAvecResultats.forEach(ue => {
      // Ne considérer que les UE non validées
      if (!ue.valide) {
        ue.matieres.forEach(matiere => {
          const moyenneOriginale = matiere.harmonisee ? matiere.moyenne_originale : matiere.moyenne;
          
          if (matiere.a_note && moyenneOriginale < 10) {
            ecueAReprendre.push({
              ue_libelle: ue.libelle,
              ue_id: ue.ue_id,
              ue_valide: ue.valide,
              ue_moyenne: ue.moyenne,
              matiere_nom: matiere.nom,
              matiere_id: matiere.matiere_id,
              moyenne: moyenneOriginale,
              coefficient: matiere.coefficient,
              cc_original: matiere.cc_original || matiere.moyenne_cc,
              examen_original: matiere.examen_original || matiere.partiel,
              harmonisee: matiere.harmonisee || false
            });
          }
        });
      }
    });
    
    const pvEtudiant = {
      success: true,
      etudiant: {
        id: etudiant.id,
        matricule_iipea: etudiant.matricule_iipea,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        niveau_id: etudiant.niveau_id
      },
      groupe: {
        id: groupeInfo.id,
        nom: groupeInfo.nom
      },
      type_filiere: groupeInfo.type_filiere,
      moyenne_generale: totaux.moyenneGenerale,
      credits_valides: totaux.creditsValides,
      credits_total: totaux.creditsTotal,
      decision: decision,
      ues: uesAvecResultats,
      ecue_a_reprendre: ecueAReprendre,
      scolarite_soldee: aSoldeScolarite,
      statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI',
      date_generation: new Date().toISOString()
    };
    
    console.log('✅ PV étudiant généré avec succès');
    res.json(pvEtudiant);
  } catch (error) {
    console.error('❌ Erreur génération PV étudiant:', error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Erreur lors de la génération du PV étudiant',
      details: error.message
    });
  }
};

// ============ FONCTIONS INTERNES ============

/**
 * Récupérer la structure académique
 */
const getStructureAcademiqueFonction = async (groupeId, semestreId = null) => {
  const query = `
    WITH etudiants_groupe AS (
      SELECT DISTINCT id_filiere, niveau_id
      FROM etudiant
      WHERE groupe_id = $1 
      AND standing = 'Inscrit'
      LIMIT 1
    ),
    maquette_groupe AS (
      SELECT mq.*
      FROM maquette mq
      JOIN etudiants_groupe eg ON (
        mq.filiere_id = eg.id_filiere 
        AND mq.niveau_id = eg.niveau_id
      )
      LIMIT 1
    )
    SELECT 
      mg.id as maquette_id,
      mg.parcour,
      ue.id as ue_id,
      ue.libelle as ue_libelle,
      ue.semestre_id,
      ue.categorie_id,
      mat.id as matiere_id,
      mat.nom as matiere_nom,
      mat.coefficient as matiere_coef,
      mat.volume_horaire_cm,
      mat.volume_horaire_td,
      mat.type_evaluation
    FROM maquette_groupe mg
    JOIN ue ON ue.maquette_id = mg.id
    JOIN matiere mat ON mat.ue_id = ue.id
    WHERE 1=1
    ${semestreId ? 'AND ue.semestre_id = $2' : ''}
    ORDER BY ue.semestre_id, ue.id, mat.id
  `;
  
  const params = [groupeId];
  if (semestreId) {
    params.push(semestreId);
  }
  
  const result = await db.query(query, params);
  
  const structure = {
    maquette_id: result.rows[0]?.maquette_id || null,
    parcour: result.rows[0]?.parcour || null,
    ues: []
  };
  
  const uesMap = new Map();
  
  result.rows.forEach(row => {
    if (!uesMap.has(row.ue_id)) {
      uesMap.set(row.ue_id, {
        ue_id: row.ue_id,
        libelle: row.ue_libelle,
        semestre_id: row.semestre_id,
        categorie_id: row.categorie_id,
        matieres: []
      });
    }
    
    uesMap.get(row.ue_id).matieres.push({
      matiere_id: row.matiere_id,
      nom: row.matiere_nom,
      coefficient: parseFloat(row.matiere_coef) || 1,
      volume_horaire_cm: row.volume_horaire_cm,
      volume_horaire_td: row.volume_horaire_td,
      type_evaluation: row.type_evaluation
    });
  });
  
  structure.ues = Array.from(uesMap.values());
  return structure;
};

/**
 * Calculer le total des crédits de la maquette
 */
const calculerTotalCreditsMaquette = (ues) => {
  let total = 0;
  ues.forEach(ue => {
    ue.matieres.forEach(matiere => {
      total += matiere.coefficient;
    });
  });
  return total;
};

/**
 * Récupérer les notes d'un étudiant
 */
const getNotesEtudiantAvecDetailsFonction = async (etudiantId, maquetteId) => {
  const query = `
    SELECT 
      n.id, 
      n.note1, 
      n.note2, 
      n.partiel, 
      n.moyenne, 
      n.statut, 
      n.coefficient,
      n.enseignement_id,
      e.matiere_id,
      mat.ue_id
    FROM note n
    JOIN enseignement e ON e.id = n.enseignement_id
    JOIN matiere mat ON mat.id = e.matiere_id
    JOIN ue ON ue.id = mat.ue_id
    JOIN maquette mq ON mq.id = ue.maquette_id
    WHERE n.etudiant_id = $1
    AND mq.id = $2
    ORDER BY mat.ue_id, mat.id
  `;
  
  const result = await db.query(query, [etudiantId, maquetteId]);
  return result.rows;
};

/**
 * Calculer la moyenne du contrôle continu
 */
const calculerMoyenneCC = (note1, note2) => {
  const n1 = (note1 !== null && note1 !== undefined) ? parseFloat(note1) : null;
  const n2 = (note2 !== null && note2 !== undefined) ? parseFloat(note2) : null;
  
  const aNote1 = n1 !== null;
  const aNote2 = n2 !== null;
  
  if (aNote1 && aNote2) {
    return (n1 + n2) / 2;
  } else if (aNote1) {
    return n1;
  } else if (aNote2) {
    return n2;
  }
  return null;
};

/**
 * Calculer la moyenne totale d'une matière (fonction conservée mais non utilisée)
 */
const calculerMoyenneMatiere = (note1, note2, partiel, typeFiliere) => {
  if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
    const notes = [];
    
    if (note1 !== null && note1 !== undefined) notes.push(parseFloat(note1));
    if (note2 !== null && note2 !== undefined) notes.push(parseFloat(note2));
    if (partiel !== null && partiel !== undefined) notes.push(parseFloat(partiel));
    
    if (notes.length === 0) return null;
    
    const somme = notes.reduce((a, b) => a + b, 0);
    return somme / notes.length;
  } 
  return null;
};

/**
 * Fonction pour harmoniser les notes d'une UE
 * Calcule les valeurs CC et Exam harmonisées pour atteindre la moyenne UE = 10
 * Les notes originales sont conservées dans les champs *_original
 * Seuls les ECUE avec moyenne < 10 sont harmonisés
 */
const harmoniserNotesUE = (matieres, moyenneUE) => {
  const SEUIL_VALIDATION = 8;
  const CIBLE = 10;
  
  // Si moyenne UE < 8, pas d'harmonisation
  if (moyenneUE < SEUIL_VALIDATION) {
    return matieres.map(m => ({
      ...m,
      moyenne_originale: m.moyenne,
      moyenne_affichage: m.moyenne,
      cc_original: m.moyenne_cc,
      examen_original: m.partiel,
      cc_affichage: m.moyenne_cc,
      examen_affichage: m.partiel,
      harmonisee: false
    }));
  }
  
  // Si moyenne UE est déjà ≥ 10, pas d'harmonisation nécessaire
  if (moyenneUE >= CIBLE) {
    return matieres.map(m => ({
      ...m,
      moyenne_originale: m.moyenne,
      moyenne_affichage: m.moyenne,
      cc_original: m.moyenne_cc,
      examen_original: m.partiel,
      cc_affichage: m.moyenne_cc,
      examen_affichage: m.partiel,
      harmonisee: false
    }));
  }
  
  // Séparer les notes ≥ 10 et < 10
  const notesFortes = matieres.filter(m => m.moyenne >= CIBLE);
  const notesFaibles = matieres.filter(m => m.moyenne < CIBLE);
  
  // Calculer la somme pondérée des notes fortes (inchangées)
  const sommeForte = notesFortes.reduce((sum, m) => sum + (m.moyenne * m.coefficient), 0);
  
  // Calculer la somme pondérée totale nécessaire pour atteindre 10
  const totalCoeff = matieres.reduce((sum, m) => sum + m.coefficient, 0);
  const sommeNecessaire = CIBLE * totalCoeff;
  
  // Somme à répartir sur les notes faibles
  const sommeRestante = sommeNecessaire - sommeForte;
  const coeffFaible = notesFaibles.reduce((sum, m) => sum + m.coefficient, 0);
  
  // Si pas de notes faibles ou sommeRestante négative, pas d'harmonisation
  if (coeffFaible === 0 || sommeRestante <= 0) {
    return matieres.map(m => ({
      ...m,
      moyenne_originale: m.moyenne,
      moyenne_affichage: m.moyenne,
      cc_original: m.moyenne_cc,
      examen_original: m.partiel,
      cc_affichage: m.moyenne_cc,
      examen_affichage: m.partiel,
      harmonisee: false
    }));
  }
  
  // Construire les résultats
  return matieres.map(m => {
    if (m.moyenne >= CIBLE) {
      // Notes fortes inchangées - on garde les valeurs originales
      return {
        ...m,
        moyenne_originale: m.moyenne,
        moyenne_affichage: m.moyenne,
        cc_original: m.moyenne_cc,
        examen_original: m.partiel,
        cc_affichage: m.moyenne_cc,
        examen_affichage: m.partiel,
        harmonisee: false
      };
    } else {
      // Pour les notes faibles, on doit déterminer les nouvelles valeurs CC et Exam
      // Calculer la contribution nécessaire pour cette matière
      const contributionNecessaire = sommeRestante * (m.coefficient / coeffFaible);
      
      // Valeurs originales
      const ccOriginal = m.moyenne_cc || 0;
      const examenOriginal = m.partiel || 0;
      
      // Poids
      const poidsCC = 0.4;
      const poidsExamen = 0.6;
      
      // Moyenne cible pour cette matière
      const moyenneCible = contributionNecessaire / m.coefficient;
      
      // Stratégie : on privilégie l'augmentation de la note la plus faible
      let ccCible, examenCible;
      
      if (examenOriginal < ccOriginal) {
        // Augmenter l'examen en priorité
        examenCible = Math.min(20, Math.max(examenOriginal, (moyenneCible - ccOriginal * poidsCC) / poidsExamen));
        if (examenCible > 20) {
          examenCible = 20;
          ccCible = (moyenneCible - examenCible * poidsExamen) / poidsCC;
        } else {
          ccCible = ccOriginal;
        }
      } else {
        // Augmenter le CC en priorité
        ccCible = Math.min(20, Math.max(ccOriginal, (moyenneCible - examenOriginal * poidsExamen) / poidsCC));
        if (ccCible > 20) {
          ccCible = 20;
          examenCible = (moyenneCible - ccCible * poidsCC) / poidsExamen;
        } else {
          examenCible = examenOriginal;
        }
      }
      
      // Arrondir
      ccCible = parseFloat(ccCible.toFixed(2));
      examenCible = parseFloat(examenCible.toFixed(2));
      
      // Calculer la moyenne résultante
      const moyenneResultante = (ccCible * poidsCC + examenCible * poidsExamen) * m.coefficient;
      
      return {
        ...m,
        moyenne_originale: m.moyenne,
        moyenne_affichage: moyenneResultante / m.coefficient,
        cc_original: m.moyenne_cc,
        examen_original: m.partiel,
        cc_affichage: ccCible,
        examen_affichage: examenCible,
        harmonisee: true
      };
    }
  });
};

/**
 * Calculer les résultats détaillés d'une UE avec harmonisation
 * Règles :
 * - Seuil éliminatoire : 6 (note < 6 fait perdre le crédit)
 * - UE validée si moyenne UE ≥ 8
 * - Harmonisation des notes pour que la moyenne UE soit exactement 10
 */
const calculerResultatsUEAvecDetailsFonction = async (ue, notes, typeFiliere) => {

  //======================== Seuil éliminatoire =====================
  const SEUIL_ELIMINATOIRE = 6;
  const SEUIL_VALIDATION = 8;
  const CIBLE = 10;
  //================================================================
  
  // Filtrer les notes pour cette UE
  const notesUE = notes.filter(note => note.ue_id === ue.ue_id);
  
  // Map des notes par matière
  const notesParMatiere = new Map();
  notesUE.forEach(note => {
    const moyenneCC = calculerMoyenneCC(note.note1, note.note2);
    
    notesParMatiere.set(note.matiere_id, {
      moyenne: parseFloat(note.moyenne) || 0,
      coefficient: parseFloat(note.coefficient) || 1,
      statut: note.statut,
      enseignement_id: note.enseignement_id,
      note1: (note.note1 !== null && note.note1 !== undefined) ? parseFloat(note.note1) : null,
      note2: (note.note2 !== null && note.note2 !== undefined) ? parseFloat(note.note2) : null,
      moyenne_cc: moyenneCC,
      partiel: (note.partiel !== null && note.partiel !== undefined) ? parseFloat(note.partiel) : null
    });
  });
  
  // Résultats par matière (notes originales)
  const matieresOriginales = ue.matieres.map(matiere => {
    const note = notesParMatiere.get(matiere.matiere_id);
    const moyenne = note ? note.moyenne : 0;
    const valide = moyenne >= 10;
    
    // Vérifier si la note est éliminatoire (< 6)
    const estEliminatoire = note && moyenne < SEUIL_ELIMINATOIRE;
    
    return {
      matiere_id: matiere.matiere_id,
      nom: matiere.nom,
      moyenne: moyenne,
      coefficient: matiere.coefficient,
      valide: valide,
      est_eliminatoire: estEliminatoire,
      a_note: !!note,
      enseignement_id: note?.enseignement_id || null,
      note1: note?.note1 !== null && note?.note1 !== undefined ? note.note1 : null,
      note2: note?.note2 !== null && note?.note2 !== undefined ? note.note2 : null,
      moyenne_cc: note?.moyenne_cc !== null && note?.moyenne_cc !== undefined ? note.moyenne_cc : null,
      partiel: note?.partiel !== null && note?.partiel !== undefined ? note.partiel : null,
      moyenne_pro: typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles' 
        ? calculerMoyenneMatiere(
            note?.note1 !== null && note?.note1 !== undefined ? note.note1 : null,
            note?.note2 !== null && note?.note2 !== undefined ? note.note2 : null,
            note?.partiel !== null && note?.partiel !== undefined ? note.partiel : null,
            typeFiliere
          )
        : null
    };
  });
  
  // Calculer la moyenne pondérée de l'UE
  let sommeNotesPonderees = 0;
  let sommeCoefficients = 0;
  let auMoinsUneMatiereAvecNote = false;
  let aNoteEliminatoire = false;
  let creditsValides = 0;
  let creditsTotal = 0;
  
  matieresOriginales.forEach(matiere => {
    creditsTotal += matiere.coefficient;
    
    if (matiere.a_note) {
      auMoinsUneMatiereAvecNote = true;
      
      // Pour les filières professionnelles
      if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
        if (matiere.moyenne_pro !== null) {
          sommeNotesPonderees += matiere.moyenne_pro * matiere.coefficient;
        } else {
          sommeNotesPonderees += matiere.moyenne * matiere.coefficient;
        }
      } else {
        sommeNotesPonderees += matiere.moyenne * matiere.coefficient;
      }
      
      sommeCoefficients += matiere.coefficient;
      
      if (matiere.est_eliminatoire) {
        aNoteEliminatoire = true;
      }
      
      // Compter les crédits des ECUE avec moyenne ≥ 10 (acquis conservés)
      if (matiere.valide) {
        creditsValides += matiere.coefficient;
      }
    }
  });
  
  const moyenneUE = sommeCoefficients > 0 ? 
    sommeNotesPonderees / sommeCoefficients : 0;
  
  // Calculer les crédits totaux de l'UE
  const creditsUE = ue.matieres.reduce((sum, mat) => sum + mat.coefficient, 0);
  
  // Déterminer si l'UE est complètement validée (avec nouveau seuil à 8)
  // Conditions : toutes les notes ≥ SEUIL_ELIMINATOIRE ET moyenne UE ≥ SEUIL_VALIDATION
  const toutesNotesNonEliminatoires = matieresOriginales.every(m => 
    !m.a_note || m.moyenne >= SEUIL_ELIMINATOIRE
  );
  
  let ueValide = false;
  
  if (auMoinsUneMatiereAvecNote && toutesNotesNonEliminatoires && moyenneUE >= SEUIL_VALIDATION) {
    ueValide = true;
    // Si l'UE est validée, tous les crédits sont attribués
    creditsValides = creditsTotal;
  }
  
  // Harmoniser les notes pour l'affichage si l'UE est validée et moyenne < 10
  let matieresAvecHarmonisation = matieresOriginales;
  let moyenneUEHarmonisee = moyenneUE;
  let harmonisationEffectuee = false;
  
  if (ueValide && moyenneUE < CIBLE) {
    // Appliquer l'harmonisation
    const resultatHarmonisation = harmoniserNotesUE(matieresOriginales, moyenneUE);
    matieresAvecHarmonisation = resultatHarmonisation;
    moyenneUEHarmonisee = CIBLE; // La moyenne UE est affichée à 10
    harmonisationEffectuee = true;
  }
  
  // Identifier les ECUE à repasser (moyenne < 10 dans les notes originales)
  const ecueARepasser = matieresOriginales
    .filter(m => m.a_note && m.moyenne < CIBLE)
    .map(m => ({
      nom: m.nom,
      moyenne: m.moyenne,
      coefficient: m.coefficient
    }));
  
  return {
    ue_id: ue.ue_id,
    libelle: ue.libelle,
    moyenne: parseFloat(moyenneUE.toFixed(2)), // Moyenne réelle
    moyenne_affichage: ueValide && moyenneUE < CIBLE ? CIBLE : parseFloat(moyenneUE.toFixed(2)), // Moyenne affichée
    harmonisee: harmonisationEffectuee,
    credits: creditsUE,
    credits_valides: creditsValides, // Crédits réellement obtenus
    valide: ueValide,
    a_note_eliminatoire: aNoteEliminatoire,
    ecue_a_repasser: ecueARepasser,
    matieres: matieresAvecHarmonisation,
    semestre_id: ue.semestre_id
  };
};

/**
 * Calculer les totaux
 */
const calculerTotauxFonction = (ues, typeFiliere, totalCreditsMaquette) => {
  let totalCreditsValides = 0;
  let sommeMoyennesPonderees = 0;
  let totalCoefficients = 0;
  let uesAvecNotes = 0;
  
  ues.forEach(ue => {
    const ueAvecNotes = ue.matieres.some(m => m.a_note);
    
    if (ueAvecNotes) {
      uesAvecNotes++;
      
      // Utiliser credits_valides de l'UE (somme des ECUE avec moyenne ≥ 10)
      totalCreditsValides += ue.credits_valides || 0;
      
      // Pour la moyenne générale (utiliser la moyenne affichée)
      sommeMoyennesPonderees += (ue.moyenne_affichage || ue.moyenne) * ue.credits;
      totalCoefficients += ue.credits;
    }
  });
  
  const moyenneGenerale = totalCoefficients > 0 ? 
    sommeMoyennesPonderees / totalCoefficients : 0;
  
  // Pour les filières professionnelles
  if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
    return {
      moyenneGenerale: parseFloat(moyenneGenerale.toFixed(2)),
      creditsValides: 0,
      creditsTotal: 0,
      uesAvecNotes: uesAvecNotes,
      uesTotal: ues.length
    };
  }
  
  return {
    moyenneGenerale: parseFloat(moyenneGenerale.toFixed(2)),
    creditsValides: totalCreditsValides,
    creditsTotal: totalCreditsMaquette,
    uesAvecNotes: uesAvecNotes,
    uesTotal: ues.length
  };
};

/**
 * Déterminer la décision (ADMIS ou AJOURNÉ uniquement)
 */
const determinerDecisionFonction = (creditsValides, creditsTotal, typeFiliere) => {
  // Pas de notes
  if (creditsTotal === 0) {
    return 'Aucune note';
  }
  
  // Filière universitaire
  if (typeFiliere === 'universitaire' || typeFiliere === 'Universitaire') {
    // ADMIS seulement si tous les crédits sont validés
    if (creditsValides === creditsTotal) {
      return 'ADMIS';
    } else {
      return 'AJOURNÉ';
    }
  } 
  // Filière professionnelle
  else if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
    return creditsValides === creditsTotal ? 'ADMIS' : 'AJOURNÉ';
  }
  
  return 'INDÉTERMINÉ';
};

// ============ FONCTION POUR SERVIR LA PAGE EJS ============

/**
 * Affiche la page HTML du PV
 */
exports.afficherPVPage = async (req, res) => {
    try {
        const { groupeId, semestreId } = req.params;
        
        console.log(`🎓 Affichage page PV pour groupe: ${groupeId}, semestre: ${semestreId}`);
        
        const groupeQuery = `
            SELECT 
                g.id, g.nom, g.classe_id,
                f.nom as filiere, f.sigle,
                tf.libelle as type_filiere,
                aa.annee as annee_academique
            FROM groupe g
            LEFT JOIN etudiant et ON et.groupe_id = g.id AND et.standing = 'Inscrit'
            LEFT JOIN filiere f ON f.id = et.id_filiere
            LEFT JOIN typefiliere tf ON tf.id = f.type_filiere_id
            LEFT JOIN anneeacademique aa ON aa.id = et.annee_academique_id
            WHERE g.id = $1
            LIMIT 1
        `;
        
        const groupeResult = await db.query(groupeQuery, [groupeId]);
        
        if (groupeResult.rows.length === 0) {
            return res.status(404).render('error', { 
                title: 'Erreur',
                message: `Groupe ${groupeId} non trouvé` 
            });
        }
        
        const groupeInfo = groupeResult.rows[0];
        
        const etudiantsQuery = `
            SELECT 
                e.id, e.matricule_iipea, e.nom, e.prenoms, e.groupe_id,
                e.niveau_id, e.annee_academique_id, e.id_filiere,
                s.statut_etudiant
            FROM etudiant e
            LEFT JOIN scolarite s ON s.id = e.scolarite_id
            WHERE e.groupe_id = $1 
            AND e.standing = 'Inscrit'
            ORDER BY e.nom, e.prenoms
        `;
        
        const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
        const etudiants = etudiantsResult.rows;
        
        const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
        const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
        
        const resultatsEtudiants = [];
        const etudiantsAReprendre = [];
        
        for (const etudiant of etudiants) {
            const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
            
            const uesAvecResultats = [];
            for (const ue of structureAcademique.ues) {
                const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
                uesAvecResultats.push(resultatsUE);
            }
            
            const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
            
            const decision = determinerDecisionFonction(
                totaux.creditsValides, 
                totaux.creditsTotal, 
                groupeInfo.type_filiere
            );
            
            const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
            
            // Collecter les ECUE à reprendre
            const ecueAReprendre = [];
            uesAvecResultats.forEach(ue => {
                // Ne considérer que les UE non validées
                if (!ue.valide) {
                    ue.matieres.forEach(matiere => {
                        const moyenneOriginale = matiere.harmonisee ? matiere.moyenne_originale : matiere.moyenne;
                        
                        if (matiere.a_note && moyenneOriginale < 10) {
                            ecueAReprendre.push({
                                ue_libelle: ue.libelle,
                                ue_id: ue.ue_id,
                                ue_valide: ue.valide,
                                ue_moyenne: ue.moyenne,
                                matiere_nom: matiere.nom,
                                matiere_id: matiere.matiere_id,
                                moyenne: moyenneOriginale,
                                coefficient: matiere.coefficient,
                                cc_original: matiere.cc_original || matiere.moyenne_cc,
                                examen_original: matiere.examen_original || matiere.partiel,
                                harmonisee: matiere.harmonisee || false
                            });
                        }
                    });
                }
            });
            
            if (ecueAReprendre.length > 0) {
                etudiantsAReprendre.push({
                    etudiant_id: etudiant.id,
                    matricule_iipea: etudiant.matricule_iipea,
                    nom: etudiant.nom,
                    prenoms: etudiant.prenoms,
                    decision: decision,
                    ecue_a_reprendre: ecueAReprendre,
                    scolarite_soldee: aSoldeScolarite
                });
            }
            
            resultatsEtudiants.push({
                etudiant_id: etudiant.id,
                matricule_iipea: etudiant.matricule_iipea,
                nom: etudiant.nom,
                prenoms: etudiant.prenoms,
                moyenne_generale: totaux.moyenneGenerale,
                credits_valides: totaux.creditsValides,
                credits_total: totaux.creditsTotal,
                decision: decision,
                ues: uesAvecResultats,
                scolarite_soldee: aSoldeScolarite,
                statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI',
                ecue_a_reprendre: ecueAReprendre
            });
        }
        
        if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
            resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
        }
        
        // Compter les admis
        const admisCount = resultatsEtudiants.filter(e => e.decision === 'ADMIS').length;
        
        const pvData = {
            success: true,
            groupe: {
                id: groupeInfo.id,
                nom: groupeInfo.nom,
                annee_academique: groupeInfo.annee_academique
            },
            maquette: {
                id: structureAcademique.maquette_id,
                filiere: groupeInfo.filiere,
                sigle: groupeInfo.sigle,
                parcour: structureAcademique.parcour
            },
            type_filiere: groupeInfo.type_filiere,
            semestre: {
                id: semestreId
            },
            etudiants: resultatsEtudiants,
            etudiants_a_reprendre: etudiantsAReprendre,
            date_generation: new Date().toISOString(),
            statistiques: {
                total_etudiants: etudiants.length,
                total_admis: admisCount,
                total_ajournes: etudiants.length - admisCount,
                total_ue: structureAcademique.ues.length,
                total_credits_maquette: totalCreditsMaquette,
                statistiques_scolarite: {
                    total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
                    total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
                },
                statistiques_reprise: {
                    total_etudiants_a_reprendre: etudiantsAReprendre.length,
                    total_ecue_a_reprendre: etudiantsAReprendre.reduce((sum, e) => sum + e.ecue_a_reprendre.length, 0)
                }
            }
        };
        
        res.render('pv', { 
            title: 'Procès-Verbal',
            data: pvData
        });
        
    } catch (error) {
        console.error('❌ Erreur affichage page PV:', error.message);
        res.status(500).render('error', { 
            title: 'Erreur',
            message: 'Erreur lors de l\'affichage du PV',
            error: error.message
        });
    }
};