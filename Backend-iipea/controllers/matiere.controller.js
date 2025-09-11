const db = require('../config/db.config');

// Créer une matière
exports.createMatiere = async (req, res) => {
  try {
    const {
      nom,
      coefficient,
      ue_id,
      volume_horaire_cm,
      taux_horaire_cm,
      volume_horaire_td,
      taux_horaire_td,
    } = req.body;
    
    // Validation des données
    if (!nom || !coefficient || !ue_id || !volume_horaire_cm || 
        !taux_horaire_cm || !volume_horaire_td || !taux_horaire_td) {
      return res.status(400).json({ 
        success: false, 
        message: 'Tous les champs sont requis' 
      });
    }
    
    const query = `
      INSERT INTO matiere (
        nom, coefficient, ue_id, volume_horaire_cm, 
        taux_horaire_cm, volume_horaire_td, taux_horaire_td
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
    
    const values = [
      nom,
      coefficient,
      ue_id,
      volume_horaire_cm,
      taux_horaire_cm,
      volume_horaire_td,
      taux_horaire_td,
    ];
    
    const result = await db.query(query, values); // Changé pool.query en db.query
    
    res.status(201).json({ 
      success: true, 
      message: 'Matière créée avec succès',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Erreur lors de la création de la matière:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};