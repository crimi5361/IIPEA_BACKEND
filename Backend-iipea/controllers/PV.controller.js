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
    
    // 2. Récupérer tous les étudiants du groupe avec leurs informations de scolarité
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
    
    // 3. Récupérer la structure académique (tous semestres)
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, null);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées`);
    
    // Calculer le total des crédits de la maquette (pour tous les étudiants)
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    console.log(`📊 Total crédits maquette: ${totalCreditsMaquette}`);
    
    // 4. Pour chaque étudiant, calculer les résultats avec détails
    const resultatsEtudiants = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
      
      // Calculer les résultats par UE avec détails selon le type de filière
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
        uesAvecResultats.push(resultatsUE);
      }
      
      // Calculer les totaux selon le type de filière
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
      
      // Déterminer la décision selon le type de filière
      const decision = determinerDecisionFonction(
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere,
        uesAvecResultats
      );
      
      // 🔴 Déterminer si l'étudiant a soldé sa scolarité (basé sur statut_etudiant)
      const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
      
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
        // 🔴 Ajout du statut de scolarité
        scolarite_soldee: aSoldeScolarite,
        statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI'
      });
    }
    
    // 5. Trier les étudiants par moyenne générale décroissante pour les filières professionnelles
    if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
      resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
    }
    
    // 6. Structurer la réponse finale
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
      date_generation: new Date().toISOString(),
      statistiques: {
        total_etudiants: etudiants.length,
        total_ue: structureAcademique.ues.length,
        total_credits_maquette: totalCreditsMaquette,
        // 🔴 Ajout des statistiques de scolarité
        statistiques_scolarite: {
          total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
          total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
        }
      }
    };
    
    console.log('✅ PV généré avec succès');
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
    
    // 2. Récupérer tous les étudiants du groupe avec leurs informations de scolarité
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
    
    // 3. Récupérer la structure académique pour le semestre spécifique
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées pour le semestre ${semestreId}`);
    
    // Calculer le total des crédits de la maquette pour ce semestre
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    console.log(`📊 Total crédits maquette semestre ${semestreId}: ${totalCreditsMaquette}`);
    
    // 4. Pour chaque étudiant, calculer les résultats avec détails
    const resultatsEtudiants = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
      
      // Calculer les résultats par UE avec détails selon le type de filière
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
        uesAvecResultats.push(resultatsUE);
      }
      
      // Calculer les totaux selon le type de filière
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
      
      // Déterminer la décision selon le type de filière
      const decision = determinerDecisionFonction(
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere,
        uesAvecResultats
      );
      
      // 🔴 Déterminer si l'étudiant a soldé sa scolarité (basé sur statut_etudiant)
      const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
      
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
        // 🔴 Ajout du statut de scolarité
        scolarite_soldee: aSoldeScolarite,
        statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI'
      });
    }
    
    // 5. Trier les étudiants par moyenne générale décroissante pour les filières professionnelles
    if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
      resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
    }
    
    // 6. Structurer la réponse finale
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
      date_generation: new Date().toISOString(),
      statistiques: {
        total_etudiants: etudiants.length,
        total_ue: structureAcademique.ues.length,
        total_credits_maquette: totalCreditsMaquette,
        // 🔴 Ajout des statistiques de scolarité
        statistiques_scolarite: {
          total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
          total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
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
 * Génère le PV d'un étudiant spécifique
 */
exports.genererPVByEtudiant = async (req, res) => {
  try {
    const { etudiantId } = req.params;
    
    console.log(`🎓 Génération PV pour étudiant: ${etudiantId}`);
    
    // 1. Récupérer l'étudiant avec ses informations de scolarité
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
    
    // 2. Récupérer les informations du groupe
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
    
    // 3. Récupérer la structure académique
    const structureAcademique = await getStructureAcademiqueFonction(etudiant.groupe_id, null);
    
    // Calculer le total des crédits de la maquette
    const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
    
    // 4. Récupérer les notes détaillées
    const notes = await getNotesEtudiantAvecDetailsFonction(etudiantId, structureAcademique.maquette_id);
    
    // 5. Calculer les résultats par UE avec détails selon le type de filière
    const uesAvecResultats = [];
    for (const ue of structureAcademique.ues) {
      const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
      uesAvecResultats.push(resultatsUE);
    }
    
    // 6. Calculer les totaux selon le type de filière
    const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
    
    // 7. Déterminer la décision selon le type de filière
    const decision = determinerDecisionFonction(
      totaux.creditsValides, 
      totaux.creditsTotal, 
      groupeInfo.type_filiere,
      uesAvecResultats
    );
    
    // 🔴 Déterminer si l'étudiant a soldé sa scolarité (basé sur statut_etudiant)
    const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
    
    // 8. Structurer la réponse
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
      // 🔴 Ajout du statut de scolarité
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
 * Fonction interne pour récupérer la structure académique
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
  
  // Structurer les données
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
 * Fonction pour calculer le total des crédits de la maquette
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
 * Fonction interne pour récupérer les notes d'un étudiant avec détails (note1, note2, partiel)
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
 * Fonction pour calculer la moyenne du contrôle continu (note1 et note2)
 */
const calculerMoyenneCC = (note1, note2) => {
  const n1 = (note1 !== null && note1 !== undefined) ? parseFloat(note1) : null;
  const n2 = (note2 !== null && note2 !== undefined) ? parseFloat(note2) : null;
  
  // CORRECTION: Vérifier explicitement la présence des notes
  const aNote1 = n1 !== null;
  const aNote2 = n2 !== null;
  
  // Si les deux notes existent
  if (aNote1 && aNote2) {
    return (n1 + n2) / 2;
  }
  // Si seulement note1 existe
  else if (aNote1) {
    return n1;
  }
  // Si seulement note2 existe
  else if (aNote2) {
    return n2;
  }
  // Aucune note
  return null;
};

/**
 * Fonction pour calculer la moyenne totale d'une matière selon le type de filière
 */
const calculerMoyenneMatiere = (note1, note2, partiel, typeFiliere) => {
  // Pour les filières professionnelles, partiel est considéré comme une note de classe supplémentaire
  if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
    const notes = [];
    
    if (note1 !== null && note1 !== undefined) notes.push(parseFloat(note1));
    if (note2 !== null && note2 !== undefined) notes.push(parseFloat(note2));
    if (partiel !== null && partiel !== undefined) notes.push(parseFloat(partiel));
    
    if (notes.length === 0) return null;
    
    // Moyenne simple de toutes les notes disponibles
    const somme = notes.reduce((a, b) => a + b, 0);
    return somme / notes.length;
  } 
  // Pour les filières universitaires, calcul standard avec CC et examen
  else {
    const moyenneCC = calculerMoyenneCC(note1, note2);
    const noteExamen = (partiel !== null && partiel !== undefined) ? parseFloat(partiel) : null;
    
    if (moyenneCC && noteExamen) {
      // Formule à adapter selon vos règles (ex: 40% CC + 60% Examen)
      // Par défaut, on garde la moyenne existante
      return null; // Retourner null pour utiliser la moyenne déjà calculée
    }
    return null;
  }
};

/**
 * Fonction interne pour calculer les résultats détaillés d'une UE
 */
const calculerResultatsUEAvecDetailsFonction = async (ue, notes, typeFiliere) => {
  // Filtrer les notes pour cette UE
  const notesUE = notes.filter(note => note.ue_id === ue.ue_id);
  
  // Créer un map matière → notes détaillées
  const notesParMatiere = new Map();
  notesUE.forEach(note => {
    const moyenneCC = calculerMoyenneCC(note.note1, note.note2);
    
    notesParMatiere.set(note.matiere_id, {
      moyenne: parseFloat(note.moyenne) || 0,
      coefficient: parseFloat(note.coefficient) || 1,
      statut: note.statut,
      enseignement_id: note.enseignement_id,
      // CORRECTION IMPORTANTE: Préserver la valeur 0
      note1: (note.note1 !== null && note.note1 !== undefined) ? parseFloat(note.note1) : null,
      note2: (note.note2 !== null && note.note2 !== undefined) ? parseFloat(note.note2) : null,
      moyenne_cc: moyenneCC, // Garder la valeur même si 0
      partiel: (note.partiel !== null && note.partiel !== undefined) ? parseFloat(note.partiel) : null
    });
  });
  
  // Calculer les résultats par matière avec détails
  const matieresAvecResultats = ue.matieres.map(matiere => {
    const note = notesParMatiere.get(matiere.matiere_id);
    const moyenne = note ? note.moyenne : 0;
    const valide = moyenne >= 10;
    
    return {
      matiere_id: matiere.matiere_id,
      nom: matiere.nom,
      moyenne: moyenne,
      coefficient: matiere.coefficient,
      valide: valide,
      a_note: !!note,
      enseignement_id: note?.enseignement_id || null,
      // Détails des notes - CORRECTION: Garder la valeur 0
      note1: note?.note1 !== null && note?.note1 !== undefined ? note.note1 : null,
      note2: note?.note2 !== null && note?.note2 !== undefined ? note.note2 : null,
      moyenne_cc: note?.moyenne_cc !== null && note?.moyenne_cc !== undefined ? note.moyenne_cc : null,
      partiel: note?.partiel !== null && note?.partiel !== undefined ? note.partiel : null,
      // Pour les filières professionnelles, on peut calculer une moyenne alternative
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
  
  // Calculer la moyenne de l'UE (pondérée)
  let sommeNotesPonderees = 0;
  let sommeCoefficients = 0;
  let auMoinsUneMatiereAvecNote = false;
  
  matieresAvecResultats.forEach(matiere => {
    if (matiere.a_note) {
      auMoinsUneMatiereAvecNote = true;
      
      // Pour les filières professionnelles, on utilise la moyenne calculée spécialement
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
    }
  });
  
  const moyenneUE = sommeCoefficients > 0 ? 
    sommeNotesPonderees / sommeCoefficients : 0;
  
  // Déterminer si l'UE est valide (sans harmonisation)
  const ueValide = auMoinsUneMatiereAvecNote && moyenneUE >= 10;
  
  // Calculer les crédits (par défaut, coefficient = crédits) - pour professionnelles, les crédits ne sont pas utilisés
  const creditsUE = ue.matieres.reduce((sum, mat) => sum + mat.coefficient, 0);
  
  return {
    ue_id: ue.ue_id,
    libelle: ue.libelle,
    moyenne: parseFloat(moyenneUE.toFixed(2)),
    credits: creditsUE,
    valide: ueValide,
    harmonisee: false,
    matieres: matieresAvecResultats,
    semestre_id: ue.semestre_id
  };
};

/**
 * Fonction interne pour calculer les totaux
 */
const calculerTotauxFonction = (ues, typeFiliere, totalCreditsMaquette) => {
  let totalCreditsValides = 0;
  let sommeMoyennesPonderees = 0;
  let totalCoefficients = 0;
  let uesAvecNotes = 0;
  
  ues.forEach(ue => {
    // Compter seulement les UE qui ont au moins une matière avec note
    const ueAvecNotes = ue.matieres.some(m => m.a_note);
    
    if (ueAvecNotes) {
      uesAvecNotes++;
      
      if (typeFiliere === 'universitaire' || typeFiliere === 'Universitaire') {
        // Pour universitaire: calcul des crédits validés matière par matière
        ue.matieres.forEach(matiere => {
          if (matiere.a_note && matiere.valide) {
            totalCreditsValides += matiere.coefficient;
          }
        });
      }
      
      // Calcul pour la moyenne générale (pondérée par les crédits)
      sommeMoyennesPonderees += ue.moyenne * ue.credits;
      totalCoefficients += ue.credits;
    }
  });
  
  const moyenneGenerale = totalCoefficients > 0 ? 
    sommeMoyennesPonderees / totalCoefficients : 0;
  
  // Pour les filières professionnelles, on n'utilise pas les crédits
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
 * Fonction interne pour déterminer la décision
 */
const determinerDecisionFonction = (creditsValides, creditsTotal, typeFiliere, ues) => {
  // D'abord vérifier s'il y a des notes
  const aDesNotes = ues.some(ue => ue.matieres.some(m => m.a_note));
  if (!aDesNotes) {
    return 'Aucune note';
  }
  
  // Logique pour filière universitaire
  if (typeFiliere === 'universitaire' || typeFiliere === 'Universitaire') {
    // Admis uniquement si tous les crédits sont validés (30/30)
    if (creditsValides === creditsTotal) {
      return 'Admis';
    } else {
      return 'Session';
    }
  } 
  // Logique pour filière professionnelle
  else if (typeFiliere === 'Professionnelles' || typeFiliere === 'professionnelles') {
    // Pour professionnelles, on peut avoir des règles spécifiques
    // Par exemple, admis si moyenne générale >= 10
    const moyenneGenerale = ues.reduce((sum, ue) => sum + ue.moyenne, 0) / ues.length;
    if (moyenneGenerale >= 10) {
      return 'Admis';
    } else {
      return 'Ajourné';
    }
  }
  
  return 'Indéterminé - Type de filière non reconnu';
};

// ============ FONCTION POUR SERVIR LA PAGE EJS ============

/**
 * Affiche la page HTML du PV (rendu avec EJS)
 */
exports.afficherPVPage = async (req, res) => {
    try {
        const { groupeId, semestreId } = req.params;
        
        console.log(`🎓 Affichage page PV pour groupe: ${groupeId}, semestre: ${semestreId}`);
        
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
            return res.status(404).render('error', { 
                title: 'Erreur',
                message: `Groupe ${groupeId} non trouvé` 
            });
        }
        
        const groupeInfo = groupeResult.rows[0];
        
        // 2. Récupérer tous les étudiants du groupe avec leurs informations de scolarité
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
        
        console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés pour la page`);
        
        // 3. Récupérer la structure académique pour le semestre spécifique
        const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
        console.log(`📚 ${structureAcademique.ues.length} UE trouvées pour le semestre ${semestreId}`);
        
        // Calculer le total des crédits de la maquette pour ce semestre
        const totalCreditsMaquette = calculerTotalCreditsMaquette(structureAcademique.ues);
        console.log(`📊 Total crédits maquette semestre ${semestreId}: ${totalCreditsMaquette}`);
        
        // 4. Pour chaque étudiant, calculer les résultats avec détails
        const resultatsEtudiants = [];
        
        for (const etudiant of etudiants) {
            console.log(`📊 Traitement étudiant page: ${etudiant.nom} ${etudiant.prenoms}`);
            
            const notes = await getNotesEtudiantAvecDetailsFonction(etudiant.id, structureAcademique.maquette_id);
            
            // Calculer les résultats par UE avec détails selon le type de filière
            const uesAvecResultats = [];
            for (const ue of structureAcademique.ues) {
                const resultatsUE = await calculerResultatsUEAvecDetailsFonction(ue, notes, groupeInfo.type_filiere);
                uesAvecResultats.push(resultatsUE);
            }
            
            // Calculer les totaux selon le type de filière
            const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere, totalCreditsMaquette);
            
            // Déterminer la décision selon le type de filière
            const decision = determinerDecisionFonction(
                totaux.creditsValides, 
                totaux.creditsTotal, 
                groupeInfo.type_filiere,
                uesAvecResultats
            );
            
            // 🔴 Déterminer si l'étudiant a soldé sa scolarité (basé sur statut_etudiant)
            const aSoldeScolarite = (etudiant.statut_etudiant || '').toUpperCase() === 'SOLDE';
            
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
                // 🔴 Ajout du statut de scolarité
                scolarite_soldee: aSoldeScolarite,
                statut_etudiant: etudiant.statut_etudiant || 'NON_DEFINI'
            });
        }
        
        // 5. Trier les étudiants par moyenne générale décroissante pour les filières professionnelles
        if (groupeInfo.type_filiere === 'Professionnelles' || groupeInfo.type_filiere === 'professionnelles') {
            resultatsEtudiants.sort((a, b) => b.moyenne_generale - a.moyenne_generale);
        }
        
        // 6. Structurer les données pour le template EJS
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
            date_generation: new Date().toISOString(),
            statistiques: {
                total_etudiants: etudiants.length,
                total_ue: structureAcademique.ues.length,
                total_credits_maquette: totalCreditsMaquette,
                // 🔴 Ajout des statistiques de scolarité
                statistiques_scolarite: {
                    total_solde: resultatsEtudiants.filter(e => e.scolarite_soldee).length,
                    total_non_solde: resultatsEtudiants.filter(e => !e.scolarite_soldee).length
                }
            }
        };
        
        console.log('✅ Données prêtes pour rendu EJS');
        
        // 7. Rendre la vue EJS avec les données
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