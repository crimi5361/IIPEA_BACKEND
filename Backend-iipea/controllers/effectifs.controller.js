const db = require('../config/db.config');

exports.getEffectifsParFiliereNiveau = async (req, res) => {
  const client = await db.connect();
  
  try {
    const { annee_id } = req.query;
    
    const query = `
      SELECT 
        f.nom as filiere,
        f.sigle as filiere_sigle,
        n.libelle as niveau,
        c.type_parcours as cycle,  -- Récupère le nom du cycle depuis curcus
        COUNT(e.id) as nombre_inscrits
      FROM etudiant e
      JOIN filiere f ON e.id_filiere = f.id
      JOIN niveau n ON e.niveau_id = n.id
      JOIN curcus c ON e.curcus_id = c.id  -- Jointure avec la table curcus
      JOIN anneeacademique aa ON e.annee_academique_id = aa.id
      WHERE aa.id = $1
      GROUP BY f.nom, f.sigle, n.libelle, c.type_parcours
      ORDER BY f.nom, n.libelle
    `;

    const result = await client.query(query, [annee_id || 1]);

    // Also get total students
    const totalQuery = `
      SELECT COUNT(*) as total_inscrits
      FROM etudiant e
      JOIN anneeacademique aa ON e.annee_academique_id = aa.id
      WHERE aa.id = $1
    `;
    
    const totalResult = await client.query(totalQuery, [annee_id || 1]);

    res.status(200).json({
      success: true,
      data: {
        effectifs: result.rows,
        total_inscrits: parseInt(totalResult.rows[0].total_inscrits)
      }
    });

  } catch (error) {
    console.error('Erreur récupération effectifs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des effectifs'
    });
  } finally {
    client.release();
  }
};

exports.getAnneesAcademiques = async (req, res) => {
  const client = await db.connect();
  
  try {
    const query = `
      SELECT id, annee, etat
      FROM anneeacademique
      ORDER BY annee DESC
    `;

    const result = await client.query(query);

    res.status(200).json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Erreur récupération années:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des années académiques'
    });
  } finally {
    client.release();
  }
};