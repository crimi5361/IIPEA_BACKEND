const db = require('../config/db.config'); 
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

exports.login = async (req, res) => {
  const { email, mot_de_passe } = req.body;

  try {
    const result = await db.query(
      `SELECT u.id, u.nom, u.email, u.mot_de_passe, r.nom AS role,
              d.id AS departement_id, d.nom AS departement_nom
       FROM utilisateur u
       JOIN role r ON u.role_id = r.id
       JOIN departement d ON u.departement_id = d.id
       WHERE u.email = $1 AND u.statut = 'active'`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Utilisateur non trouvé ou inactif.' });
    }

    const utilisateur = result.rows[0];

    const isMatch = await bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe);
    if (!isMatch) {
      return res.status(401).json({ message: 'Mot de passe incorrect.' });
    }

    const token = jwt.sign(
      { id: utilisateur.id, role: utilisateur.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(200).json({
      token,
      user: {
        id: utilisateur.id,
        nom: utilisateur.nom,
        email: utilisateur.email,
        role: utilisateur.role,
        departement: {
          id: utilisateur.departement_id,
          nom: utilisateur.departement_nom
        }
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};
