const db = require('../config/db.config');
const bcrypt = require('bcrypt');

 // Récupérer toutes les roles
exports.getAllUsers = async (req, res) => {
  try {
    const result = await db.query(`SELECT 
            u.id,
            u.nom,
            u.email,
            d.nom AS departement, -- jointure pour le nom du département
            r.nom AS role,         -- jointure pour le nom du rôle
            u.statut
            FROM public.utilisateur u
            JOIN public.departement d ON u.departement_id = d.id
            JOIN public.role r ON u.role_id = r.id
`);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Erreur lors de la récupération des roles:', error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};


//============================================================================================================

// Ajouter un nouvel utilisateur
exports.createUser = async (req, res) => {
  const { nom, email, departement_id, role_id } = req.body;

  // Validation minimale
  if (!nom || !email || !departement_id || !role_id) {
    return res.status(400).json({ message: 'Champs requis manquants.' });
  }

  try {
    // Vérifie si l'utilisateur existe déjà
    const existingUser = await db.query(
      'SELECT * FROM public.utilisateur WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ message: "L'utilisateur existe déjà." });
    }

    // Hasher le mot de passe par défaut
    const hashedPassword = await bcrypt.hash('@elites@', 10); // sel de 10

    // Insérer l'utilisateur
    const result = await db.query(
      `INSERT INTO public.utilisateur (nom, email, mot_de_passe, departement_id, role_id, statut)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nom, email, hashedPassword, departement_id, role_id, 'active']
    );

    res.status(201).json({
      message: 'Utilisateur ajouté avec succès.',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Erreur lors de la création de l’utilisateur:', error);
    res.status(500).json({ message: 'Erreur serveur lors de la création de l’utilisateur.' });
  }
};
