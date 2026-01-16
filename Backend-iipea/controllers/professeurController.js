const db = require('../config/db.config');

// 1. Récupérer TOUS les professeurs (ACTIFS seulement par défaut)
exports.getAllProfesseurs = async (req, res) => {
    try {
        // Option: Récupérer seulement les actifs, ou tous avec paramètre
        const showInactifs = req.query.showInactifs === 'true';
        
        let query = `
            SELECT 
                p.id,
                p.nom,
                p.prenom,
                p.date_creation,
                p.id_matiere,
                p.statut,
                CASE 
                    WHEN p.id_matiere IS NULL THEN 'Non assigné'
                    ELSE 'Assigné'
                END as statut_assignation
            FROM professeur p
            WHERE 1=1
        `;
        
        const params = [];
        
        if (!showInactifs) {
            query += ` AND p.statut = 'Actif'`;
        }
        
        query += ` ORDER BY 
            CASE WHEN p.id_matiere IS NULL THEN 1 ELSE 0 END,
            p.nom, p.prenom
        `;
        
        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// 2. Ajouter un professeur
exports.createProfesseur = async (req, res) => {
    try {
        const { nom, prenom } = req.body;
        
        if (!nom || !prenom) {
            return res.status(400).json({ error: 'Nom et prénom requis' });
        }
        
        const query = `
            INSERT INTO professeur (nom, prenom, statut)
            VALUES ($1, $2, 'Actif')
            RETURNING *
        `;
        
        const result = await db.query(query, [nom.trim(), prenom.trim()]);
        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// 3. Mettre à jour un professeur
exports.updateProfesseur = async (req, res) => {
    try {
        const { id } = req.params;
        const { nom, prenom } = req.body;
        
        const query = `
            UPDATE professeur 
            SET nom = $1, prenom = $2
            WHERE id = $3 AND statut != 'Inactif'
            RETURNING *
        `;
        
        const result = await db.query(query, [nom.trim(), prenom.trim(), id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Professeur non trouvé ou déjà inactif' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// 4. SOFT DELETE - Désactiver un professeur
exports.softDeleteProfesseur = async (req, res) => {
    try {
        const { id } = req.params;
        
        // Vérifier si le professeur existe et est actif
        const checkQuery = await db.query(
            'SELECT id FROM professeur WHERE id = $1 AND statut = $2',
            [id, 'Actif']
        );
        
        if (checkQuery.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Professeur non trouvé ou déjà inactif' 
            });
        }
        
        // Soft delete: marquer comme inactif
        const query = `
            UPDATE professeur 
            SET statut = 'Inactif'
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await db.query(query, [id]);
        
        // Si le professeur était assigné à une matière, la libérer
        await db.query(
            'UPDATE matiere SET id_professeur = NULL WHERE id_professeur = $1',
            [id]
        );
        
        res.json({ 
            message: 'Professeur désactivé avec succès',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// 5. Réactiver un professeur
exports.activateProfesseur = async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            UPDATE professeur 
            SET statut = 'Actif'
            WHERE id = $1 AND statut = 'Inactif'
            RETURNING *
        `;
        
        const result = await db.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: 'Professeur non trouvé ou déjà actif' 
            });
        }
        
        res.json({ 
            message: 'Professeur réactivé avec succès',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};

// 6. Récupérer les professeurs inactifs (pour l'admin)
exports.getInactifsProfesseurs = async (req, res) => {
    try {
        const query = `
            SELECT 
                p.id,
                p.nom,
                p.prenom,
                p.date_creation,
                p.statut
            FROM professeur p
            WHERE p.statut = 'Inactif'
            ORDER BY p.nom, p.prenom
        `;
        
        const result = await db.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
};