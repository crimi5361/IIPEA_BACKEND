// controllers/etudiantController.js
const db = require('../config/db.config');

exports.getStudentProfile = async (req, res) => {
  try {
    const studentId = req.params.id;

    // Requête principale pour récupérer toutes les informations de l'étudiant
    const query = `
      SELECT 
        e.*,
        a.annee as annee_academique,
        a.etat as etat_annee,
        n.libelle as niveau_libelle,
        n.prix_formation,
        n.type_filiere as type_filiere_niveau,
        f.nom as filiere_nom,
        f.sigle as filiere_sigle,
        tf.libelle as type_filiere_libelle,
        tf.description as type_filiere_description,
        d.extrait_naissance,
        d.justificatif_identite,
        d.dernier_diplome,
        d.fiche_orientation,
        c.type_parcours,
        g.id as groupe_id,
        g.nom as groupe_nom,
        g.capacite_max,
        cl.nom as classe_nom,
        cl.description as classe_description,
        s.montant_scolarite,
        s.scolarite_verse,
        s.statut_etudiant as statut_scolarite,
        s.scolarite_restante,
        s.prise_en_charge_id
      FROM etudiant e
      LEFT JOIN anneeacademique a ON e.annee_academique_id = a.id
      LEFT JOIN niveau n ON e.niveau_id = n.id
      LEFT JOIN filiere f ON e.id_filiere = f.id
      LEFT JOIN typefiliere tf ON f.type_filiere_id = tf.id
      LEFT JOIN document d ON e.document_id = d.id
      LEFT JOIN curcus c ON e.curcus_id = c.id
      LEFT JOIN groupe g ON e.groupe_id = g.id
      LEFT JOIN classe cl ON g.classe_id = cl.id
      LEFT JOIN scolarite s ON e.scolarite_id = s.id
      WHERE e.id = $1
    `;

    const result = await db.query(query, [studentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Étudiant non trouvé' });
    }

    const studentData = result.rows[0];

    // Structurer la réponse de manière organisée
    const formattedResponse = {
      informations_personnelles: {
        id: studentData.id,
        matricule: studentData.matricule,
        nom: studentData.nom,
        prenoms: studentData.prenoms,
        date_naissance: studentData.date_naissance,
        lieu_naissance: studentData.lieu_naissance,
        telephone: studentData.telephone,
        email: studentData.email,
        lieu_residence: studentData.lieu_residence,
        contact_parent: studentData.contact_parent,
        contact_parent_2: studentData.contact_parent_2,
        contact_etudiant: studentData.contact_etudiant,
        sexe: studentData.sexe,
        nationalite: studentData.nationalite,
        pays_naissance: studentData.pays_naissance,
        photo_url: studentData.photo_url,
        numero_table: studentData.numero_table
      },
      informations_familiales: {
        nom_parent_1: studentData.nom_parent_1,
        nom_parent_2: studentData.nom_parent_2
      },
      informations_academiques: {
        code_unique: studentData.code_unique,
        annee_bac: studentData.annee_bac,
        serie_bac: studentData.serie_bac,
        etablissement_origine: studentData.etablissement_origine,
        annee_academique: studentData.annee_academique,
        etat_annee: studentData.etat_annee,
        niveau: studentData.niveau_libelle,
        prix_formation: studentData.prix_formation,
        filiere: studentData.filiere_nom,
        sigle_filiere: studentData.filiere_sigle,
        type_filiere: studentData.type_filiere_libelle,
        type_parcours: studentData.type_parcours,
        groupe_id: studentData.groupe_id,
        groupe: studentData.groupe_nom,
        capacite_groupe: studentData.capacite_max,
        classe: studentData.classe_nom
      },
      documents: {
        extrait_naissance: studentData.extrait_naissance,
        justificatif_identite: studentData.justificatif_identite,
        dernier_diplome: studentData.dernier_diplome,
        fiche_orientation: studentData.fiche_orientation,
        statut_documents: {
          complet: studentData.extrait_naissance === 'oui' && 
                  studentData.justificatif_identite === 'oui' && 
                  studentData.dernier_diplome === 'oui' && 
                  studentData.fiche_orientation === 'oui'
        }
      },
      scolarite: {
        montant_total: studentData.montant_scolarite,
        montant_verse: studentData.scolarite_verse,
        montant_restant: studentData.scolarite_restante,
        statut: studentData.statut_scolarite,
        prise_en_charge_id: studentData.prise_en_charge_id
      },
      statut: {
        statut_scolaire: studentData.statut_scolaire,
        standing: studentData.standing,
        date_inscription: studentData.date_inscription,
        inscrit_par: studentData.inscrit_par
      },
      administration: {
        departement_id: studentData.departement_id,
        matricule_iipea: studentData.matricule_iipea,
        ip_ministere: studentData.ip_ministere
      }
    };

    res.status(200).json(formattedResponse);

  } catch (error) {
    console.error('Erreur lors de la récupération du profil étudiant:', error);
    res.status(500).json({ 
      message: 'Erreur serveur lors de la récupération des données',
      error: error.message 
    });
  }
};