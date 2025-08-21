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