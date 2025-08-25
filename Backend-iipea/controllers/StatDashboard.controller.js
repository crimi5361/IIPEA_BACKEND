// controllers/dashboardController.js
const db = require('../config/db.config');

exports.getDashboardStats = async (req, res) => {
  const { anneeAcademiqueId } = req.query;
  const departementId = req.user.departement_id;

  try {
    const results = {};

    // 1. Nombre d'étudiants - CORRIGÉ: "Inscrit" au lieu de "inscrit"
    const nbEtudiants = await db.query(`
      SELECT COUNT(*) AS total
      FROM etudiant
      WHERE annee_academique_id = $1 AND departement_id = $2 AND standing = 'Inscrit'
    `, [anneeAcademiqueId, departementId]);
    results.totalEtudiants = parseInt(nbEtudiants.rows[0].total);

    // 2. Montant total scolarité
    const scolariteTotale = await db.query(`
      SELECT COALESCE(SUM(s.montant_scolarite), 0) AS total
      FROM scolarite s
      JOIN etudiant e ON s.id = e.scolarite_id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
    `, [anneeAcademiqueId, departementId]);
    results.totalScolarite = parseFloat(scolariteTotale.rows[0].total);

    // 3. Montant total versé
    const scolariteVersee = await db.query(`
      SELECT COALESCE(SUM(s.scolarite_verse), 0) AS total
      FROM scolarite s
      JOIN etudiant e ON s.id = e.scolarite_id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
    `, [anneeAcademiqueId, departementId]);
    results.totalVerse = parseFloat(scolariteVersee.rows[0].total);

    // 4. Montant restant
    const scolariteRestante = await db.query(`
      SELECT COALESCE(SUM(s.scolarite_restante), 0) AS total
      FROM scolarite s
      JOIN etudiant e ON s.id = e.scolarite_id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
    `, [anneeAcademiqueId, departementId]);
    results.totalRestant = parseFloat(scolariteRestante.rows[0].total);

    // 5. Nombre de classes
    const nbClasses = await db.query(`
      SELECT COUNT(DISTINCT c.id) AS total_classes
      FROM etudiant e
      JOIN groupe g ON e.groupe_id = g.id
      JOIN classe c ON g.classe_id = c.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
    `, [anneeAcademiqueId, departementId]);
    results.totalClasses = parseInt(nbClasses.rows[0].total_classes);

    // 6. Montant total kits perçus - CORRIGÉ: "Inscrit"
    const totalKits = await db.query(`
      SELECT COALESCE(SUM(k.montant), 0) AS total
      FROM kit k
      JOIN etudiant e ON k.etudiant_id = e.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit' AND k.deposer = true
    `, [anneeAcademiqueId, departementId]);
    results.totalKits = parseFloat(totalKits.rows[0].total);

    // 7. Nombre total de kits perçus - NOUVEAU
    const nbKits = await db.query(`
      SELECT COUNT(*) AS total
      FROM kit k
      JOIN etudiant e ON k.etudiant_id = e.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit' AND k.deposer = true
    `, [anneeAcademiqueId, departementId]);
    results.nbKits = parseInt(nbKits.rows[0].total);

    // 8. Montant total réduction (prise en charge) - CORRIGÉ: "Inscrit"
    const totalReduction = await db.query(`
      SELECT COALESCE(SUM(p.montant_reduction), 0) AS total
      FROM prise_en_charge p
      JOIN etudiant e ON p.etudiant_id = e.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit' AND p.statut = 'valide'
    `, [anneeAcademiqueId, departementId]);
    results.totalReduction = parseFloat(totalReduction.rows[0].total);

    // 9. Nombre total de prises en charge valides - NOUVEAU
    const nbPrisesEnCharge = await db.query(`
      SELECT COUNT(*) AS total
      FROM prise_en_charge p
      JOIN etudiant e ON p.etudiant_id = e.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit' AND p.statut = 'valide'
    `, [anneeAcademiqueId, departementId]);
    results.nbPrisesEnCharge = parseInt(nbPrisesEnCharge.rows[0].total);

    // 10. Répartition par filière - CORRIGÉ: "Inscrit"
    const repartitionFiliere = await db.query(`
      SELECT f.nom AS filiere, COUNT(e.id) AS total
      FROM etudiant e
      JOIN filiere f ON e.id_filiere = f.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
      GROUP BY f.nom
      ORDER BY f.nom
    `, [anneeAcademiqueId, departementId]);
    results.repartitionFiliere = repartitionFiliere.rows;

    // 11. Répartition par cursus - CORRIGÉ: "Inscrit"
    const repartitionCurcus = await db.query(`
      SELECT c.type_parcours AS curcus, COUNT(e.id) AS total
      FROM etudiant e
      JOIN curcus c ON e.curcus_id = c.id
      WHERE e.annee_academique_id = $1 AND e.departement_id = $2 AND e.standing = 'Inscrit'
      GROUP BY c.type_parcours
      ORDER BY c.type_parcours
    `, [anneeAcademiqueId, departementId]);
    results.repartitionCurcus = repartitionCurcus.rows;

    console.log('Statistiques calculées:', results);
    res.json(results);

  } catch (error) {
    console.error('Erreur détaillée:', error);
    res.status(500).json({ 
      message: 'Erreur serveur',
      error: error.message 
    });
  }
};