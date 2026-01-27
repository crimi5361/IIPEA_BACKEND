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
        id, matricule, nom, prenoms, groupe_id,
        niveau_id, annee_academique_id, id_filiere
      FROM etudiant 
      WHERE groupe_id = $1 
      AND standing = 'Inscrit'
      ORDER BY nom, prenoms
    `;
    
    const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
    const etudiants = etudiantsResult.rows;
    
    console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés`);
    
    // 3. Récupérer la structure académique (tous semestres)
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, null);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées`);
    
    // 4. Pour chaque étudiant, calculer les résultats
    const resultatsEtudiants = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantFonction(etudiant.id, structureAcademique.maquette_id);
      
      // Calculer les résultats par UE
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEFonction(ue, notes);
        uesAvecResultats.push(resultatsUE);
      }
      
      // Calculer les totaux
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere);
      
      // Déterminer la décision
      const decision = determinerDecisionFonction(
        totaux.moyenneGenerale, 
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere,
        uesAvecResultats
      );
      
      resultatsEtudiants.push({
        etudiant_id: etudiant.id,
        matricule: etudiant.matricule,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        moyenne_generale: totaux.moyenneGenerale,
        credits_valides: totaux.creditsValides,
        credits_total: totaux.creditsTotal,
        decision: decision,
        ues: uesAvecResultats
      });
    }
    
    // 5. Structurer la réponse finale
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
        total_ue: structureAcademique.ues.length
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
    
    // 2. Récupérer tous les étudiants du groupe
    const etudiantsQuery = `
      SELECT 
        id, matricule, nom, prenoms, groupe_id,
        niveau_id, annee_academique_id, id_filiere
      FROM etudiant 
      WHERE groupe_id = $1 
      AND standing = 'Inscrit'
      ORDER BY nom, prenoms
    `;
    
    const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
    const etudiants = etudiantsResult.rows;
    
    console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés`);
    
    // 3. Récupérer la structure académique pour le semestre spécifique
    const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
    console.log(`📚 ${structureAcademique.ues.length} UE trouvées pour le semestre ${semestreId}`);
    
    // 4. Pour chaque étudiant, calculer les résultats
    const resultatsEtudiants = [];
    
    for (const etudiant of etudiants) {
      console.log(`📊 Traitement étudiant: ${etudiant.nom} ${etudiant.prenoms}`);
      
      const notes = await getNotesEtudiantFonction(etudiant.id, structureAcademique.maquette_id);
      
      // Calculer les résultats par UE
      const uesAvecResultats = [];
      for (const ue of structureAcademique.ues) {
        const resultatsUE = await calculerResultatsUEFonction(ue, notes);
        uesAvecResultats.push(resultatsUE);
      }
      
      // Calculer les totaux
      const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere);
      
      // Déterminer la décision
      const decision = determinerDecisionFonction(
        totaux.moyenneGenerale, 
        totaux.creditsValides, 
        totaux.creditsTotal, 
        groupeInfo.type_filiere,
        uesAvecResultats
      );
      
      resultatsEtudiants.push({
        etudiant_id: etudiant.id,
        matricule: etudiant.matricule,
        nom: etudiant.nom,
        prenoms: etudiant.prenoms,
        moyenne_generale: totaux.moyenneGenerale,
        credits_valides: totaux.creditsValides,
        credits_total: totaux.creditsTotal,
        decision: decision,
        ues: uesAvecResultats
      });
    }
    
    // 5. Structurer la réponse finale
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
        total_ue: structureAcademique.ues.length
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
    
    // 1. Récupérer l'étudiant
    const etudiantQuery = `
      SELECT 
        id, matricule, nom, prenoms, groupe_id,
        niveau_id, annee_academique_id, id_filiere
      FROM etudiant 
      WHERE id = $1
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
    
    // 4. Récupérer les notes
    const notes = await getNotesEtudiantFonction(etudiantId, structureAcademique.maquette_id);
    
    // 5. Calculer les résultats par UE
    const uesAvecResultats = [];
    for (const ue of structureAcademique.ues) {
      const resultatsUE = await calculerResultatsUEFonction(ue, notes);
      uesAvecResultats.push(resultatsUE);
    }
    
    // 6. Calculer les totaux
    const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere);
    
    // 7. Déterminer la décision
    const decision = determinerDecisionFonction(
      totaux.moyenneGenerale, 
      totaux.creditsValides, 
      totaux.creditsTotal, 
      groupeInfo.type_filiere,
      uesAvecResultats
    );
    
    // 8. Structurer la réponse
    const pvEtudiant = {
      success: true,
      etudiant: {
        id: etudiant.id,
        matricule: etudiant.matricule,
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
 * Fonction interne pour récupérer les notes d'un étudiant
 */
const getNotesEtudiantFonction = async (etudiantId, maquetteId) => {
  const query = `
    SELECT 
      n.id, n.moyenne, n.statut, n.coefficient,
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
 * Fonction interne pour calculer les résultats d'une UE
 */
const calculerResultatsUEFonction = async (ue, notes) => {
  // Filtrer les notes pour cette UE
  const notesUE = notes.filter(note => note.ue_id === ue.ue_id);
  
  // Créer un map matière → note
  const notesParMatiere = new Map();
  notesUE.forEach(note => {
    notesParMatiere.set(note.matiere_id, {
      moyenne: parseFloat(note.moyenne) || 0,
      coefficient: parseFloat(note.coefficient) || 1,
      statut: note.statut,
      enseignement_id: note.enseignement_id
    });
  });
  
  // Calculer les résultats par matière
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
      enseignement_id: note?.enseignement_id || null
    };
  });
  
  // Calculer la moyenne de l'UE (pondérée)
  let sommeNotesPonderees = 0;
  let sommeCoefficients = 0;
  let toutesMatieresValides = true;
  let auMoinsUneMatiereNonValide = false;
  let auMoinsUneMatiereAvecNote = false;
  
  matieresAvecResultats.forEach(matiere => {
    if (matiere.a_note) {
      auMoinsUneMatiereAvecNote = true;
      sommeNotesPonderees += matiere.moyenne * matiere.coefficient;
      sommeCoefficients += matiere.coefficient;
      
      if (!matiere.valide) {
        toutesMatieresValides = false;
        auMoinsUneMatiereNonValide = true;
      }
    }
  });
  
  const moyenneUE = sommeCoefficients > 0 ? 
    sommeNotesPonderees / sommeCoefficients : 0;
  
  // Appliquer la règle d'harmonisation
  let ueValide = moyenneUE >= 10;
  let harmonisee = false;
  
  if (ueValide && auMoinsUneMatiereNonValide && auMoinsUneMatiereAvecNote) {
    // Harmonisation : toutes les matières non valides deviennent valides avec 10
    harmonisee = true;
    matieresAvecResultats.forEach(matiere => {
      if (!matiere.valide && matiere.a_note) {
        matiere.moyenne = 10;
        matiere.valide = true;
      }
    });
  }
  
  // Si aucune matière n'a de note, l'UE n'est pas validée
  if (!auMoinsUneMatiereAvecNote) {
    ueValide = false;
  }
  
  // Calculer les crédits (par défaut, coefficient = crédits pour simplifier)
  const creditsUE = ue.matieres.reduce((sum, mat) => sum + mat.coefficient, 0);
  
  return {
    ue_id: ue.ue_id,
    libelle: ue.libelle,
    moyenne: parseFloat(moyenneUE.toFixed(2)),
    credits: creditsUE,
    valide: ueValide,
    harmonisee: harmonisee,
    matieres: matieresAvecResultats,
    semestre_id: ue.semestre_id
  };
};

/**
 * Fonction interne pour calculer les totaux
 */
const calculerTotauxFonction = (ues, typeFiliere) => {
  let totalCredits = 0;
  let totalCreditsValides = 0;
  let sommeMoyennesPonderees = 0;
  let totalCoefficients = 0;
  let uesAvecNotes = 0;
  
  ues.forEach(ue => {
    totalCredits += ue.credits;
    
    // Compter seulement les UE qui ont au moins une matière avec note
    const ueAvecNotes = ue.matieres.some(m => m.a_note);
    
    if (ueAvecNotes) {
      uesAvecNotes++;
      
      if (ue.valide) {
        totalCreditsValides += ue.credits;
      } else {
        // Pour les UE non validées, compter les crédits par matière valide
        ue.matieres.forEach(matiere => {
          if (matiere.valide && matiere.a_note) {
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
  
  return {
    moyenneGenerale: parseFloat(moyenneGenerale.toFixed(2)),
    creditsValides: totalCreditsValides,
    creditsTotal: totalCredits,
    uesAvecNotes: uesAvecNotes,
    uesTotal: ues.length
  };
};

/**
 * Fonction interne pour déterminer la décision
 */
const determinerDecisionFonction = (moyenneGenerale, creditsValides, creditsTotal, typeFiliere, ues) => {
  // D'abord vérifier s'il y a des notes
  const aDesNotes = ues.some(ue => ue.matieres.some(m => m.a_note));
  if (!aDesNotes) {
    return 'Aucune note';
  }
  
  // Logique pour filière universitaire
  if (typeFiliere === 'universitaire' || typeFiliere === 'Universitaire') {
    const tauxValidation = creditsTotal > 0 ? creditsValides / creditsTotal : 0;
    
    if (tauxValidation >= 1) {
      return 'Admis';
    } else if (tauxValidation >= 0.67 && moyenneGenerale >= 10) {
      // Vérifier s'il y a des matières en session malgré la compensation
      const matieresEnSession = ues.some(ue => 
        ue.matieres.some(m => !m.valide && m.a_note && m.moyenne < 10)
      );
      return matieresEnSession ? 'Session' : 'Admis avec compensation';
    } else {
      // Vérifier s'il y a des matières en session
      const matieresEnSession = ues.some(ue => 
        ue.matieres.some(m => !m.valide && m.a_note && m.moyenne < 10)
      );
      return matieresEnSession ? 'Échec' : 'Session';
    }
  } 
  // Logique pour filière professionnelle
  else if (typeFiliere === 'Professionnelles' || typeFiliere === 'Professionnelles') {
    if (moyenneGenerale >= 10) {
      return 'Admis';
    } else if (moyenneGenerale >= 8) {
      return 'Ratrapage';
    } else {
      return 'Échec';
    }
  }
  
  return 'Indéterminé - Type de filière non reconnu';
};

// fonction pour servir la page ejs de tout ces controller ++++++++++++++++++++++++++++++++++++======================================================
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
        
        // 2. Récupérer tous les étudiants du groupe
        const etudiantsQuery = `
            SELECT 
                id, matricule, nom, prenoms, groupe_id,
                niveau_id, annee_academique_id, id_filiere
            FROM etudiant 
            WHERE groupe_id = $1 
            AND standing = 'Inscrit'
            ORDER BY nom, prenoms
        `;
        
        const etudiantsResult = await db.query(etudiantsQuery, [groupeId]);
        const etudiants = etudiantsResult.rows;
        
        console.log(`👨‍🎓 ${etudiants.length} étudiants trouvés pour la page`);
        
        // 3. Récupérer la structure académique pour le semestre spécifique
        const structureAcademique = await getStructureAcademiqueFonction(groupeId, semestreId);
        console.log(`📚 ${structureAcademique.ues.length} UE trouvées pour le semestre ${semestreId}`);
        
        // 4. Pour chaque étudiant, calculer les résultats
        const resultatsEtudiants = [];
        
        for (const etudiant of etudiants) {
            console.log(`📊 Traitement étudiant page: ${etudiant.nom} ${etudiant.prenoms}`);
            
            const notes = await getNotesEtudiantFonction(etudiant.id, structureAcademique.maquette_id);
            
            // Calculer les résultats par UE
            const uesAvecResultats = [];
            for (const ue of structureAcademique.ues) {
                const resultatsUE = await calculerResultatsUEFonction(ue, notes);
                uesAvecResultats.push(resultatsUE);
            }
            
            // Calculer les totaux
            const totaux = calculerTotauxFonction(uesAvecResultats, groupeInfo.type_filiere);
            
            // Déterminer la décision
            const decision = determinerDecisionFonction(
                totaux.moyenneGenerale, 
                totaux.creditsValides, 
                totaux.creditsTotal, 
                groupeInfo.type_filiere,
                uesAvecResultats
            );
            
            resultatsEtudiants.push({
                etudiant_id: etudiant.id,
                matricule: etudiant.matricule,
                nom: etudiant.nom,
                prenoms: etudiant.prenoms,
                moyenne_generale: totaux.moyenneGenerale,
                credits_valides: totaux.creditsValides,
                credits_total: totaux.creditsTotal,
                decision: decision,
                ues: uesAvecResultats
            });
        }
        
        // 5. Structurer les données pour le template EJS
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
                total_ue: structureAcademique.ues.length
            }
        };
        
        console.log('✅ Données prêtes pour rendu EJS');
        
        // 6. Rendre la vue EJS avec les données
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