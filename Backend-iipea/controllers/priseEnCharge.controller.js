const db = require('../config/db.config');

exports.getActivePECByEtudiant = async (req, res) => {
  try {
    const { id } = req.params;
    
    const pecResult = await db.query(
      `SELECT * FROM prise_en_charge 
       WHERE etudiant_id = $1 AND statut = 'valide'`,
      [id]
    );
    
    if (pecResult.rows.length === 0) {
      return res.json({ 
        success: true, 
        data: null 
      });
    }
    
    res.json({ 
      success: true, 
      data: pecResult.rows[0] 
    });
  } catch (error) {
    console.error('Erreur récupération PEC:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération de la prise en charge' 
    });
  }
};

///========================================================================

// Récupérer toutes les PEC en attente avec les infos étudiant
exports.getPECEnAttente = async (req, res) => {
  const client = await db.connect();
  
  try {
    const query = `
      SELECT 
        p.id as pec_id,
        p.type_pec,
        p.pourcentage_reduction,
        p.reference,
        p.date_demande,
        p.statut,
        e.id as etudiant_id,
        e.matricule_iipea,
        e.nom,
        e.prenoms,
        e.telephone,
        e.email,
        f.nom as filiere,
        f.sigle as filiere_sigle,
        n.libelle as niveau,
        s.montant_scolarite,
        s.scolarite_verse,
        s.scolarite_restante,
        s.statut_etudiant,
        (s.montant_scolarite * p.pourcentage_reduction / 100) as reduction_calculee
      FROM prise_en_charge p
      JOIN etudiant e ON p.etudiant_id = e.id
      JOIN filiere f ON e.id_filiere = f.id
      JOIN niveau n ON e.niveau_id = n.id
      JOIN scolarite s ON e.scolarite_id = s.id
      WHERE p.statut = 'en_attente'
      ORDER BY p.date_demande DESC
    `;

    const result = await client.query(query);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Erreur récupération PEC en attente:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des prises en charge'
    });
  } finally {
    client.release();
  }
};