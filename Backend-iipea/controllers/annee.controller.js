const db = require ('../config/db.config');

exports.getAllAnnees = async (req, res) => {
    try {
        const result = await db.query (`SELECT id, annee, etat FROM anneeacademique`);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erreur lors de la récupération des annees:', error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
}
//===================================
exports.getAllAnneesValide = async (req, res) => {
    try {
        const result = await db.query (`SELECT id, annee, etat FROM anneeacademique Where etat = 'en cour'`);
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erreur lors de la récupération des annees en cours:', error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
}


exports.addAnnee = async (req, res) => {
    try {
        const { annee, etat } = req.body;

        // Vérification s'il existe déjà une année "en cour"
        const check = await db.query(
            `SELECT * FROM anneeacademique WHERE etat = 'en cour'`
        );

        if (etat === 'en cour' && check.rows.length > 0) {
            return res.status(400).json({
                message: "Impossible d'ouvrir une nouvelle année 'en cour' tant que l'année actuelle n'est pas fermée."
            });
        }

        // Ajout de la nouvelle année
        const result = await db.query(
            `INSERT INTO anneeacademique (annee, etat) VALUES ($1, $2) RETURNING *`,
            [annee, etat]
        );

        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Erreur lors de l\'ajout de l\'année académique:', error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
};


exports.closeAnnee = async (req, res) => {
    try {
        const { id } = req.params;
        await db.query(
            `UPDATE anneeacademique SET etat = 'terminée' WHERE id = $1`,
            [id]
        );
        res.status(200).json({ message: "Année fermée avec succès." });
    } catch (error) {
        console.error('Erreur lors de la fermeture:', error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
};

exports.reopenAnnee = async (req, res) => {
    try {
        const { id } = req.params;

        // Vérifier qu'aucune année "en cour" n'existe
        const check = await db.query(
            `SELECT * FROM anneeacademique WHERE etat = 'en cour'`
        );
        if (check.rows.length > 0) {
            return res.status(400).json({ message: "Une année 'en cour' existe déjà." });
        }

        await db.query(
            `UPDATE anneeacademique SET etat = 'en cour' WHERE id = $1`,
            [id]
        );
        res.status(200).json({ message: "Année rouverte avec succès." });
    } catch (error) {
        console.error('Erreur lors de la réouverture:', error);
        res.status(500).json({ message: 'Erreur serveur.' });
    }
};
