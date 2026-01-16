const express = require('express');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

const app = express();

// Middleware pour parser JSON SEULEMENT pour les requêtes non-multipart
app.use((req, res, next) => {
  if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
    express.json({ limit: '50mb' })(req, res, next);
  } else {
    next();
  }
});

// === CONFIGURATION EJS ===
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'Views'));

// Configuration CORS
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['Authorization', 'Content-Disposition', 'Content-Length']
};

// Middleware CORS en premier
app.use(cors(corsOptions));

// === SERVIR LES FICHIERS STATIQUES EN PREMIER ===
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Middleware pour détecter FormData et éviter body-parser
app.use((req, res, next) => {
  console.log(`\n${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  console.log(' Content-Type:', req.headers['content-type']);
  
  // Si c'est FormData, on désactive le parsing automatique
  const contentType = req.headers['content-type'];
  if (contentType && contentType.includes('multipart/form-data')) {
    console.log('🛡️ FormData détecté - désactivation body parsing');
    // On ne parse pas le body ici, multer s'en chargera
    next();
  } else {
    // Pour les autres requêtes, on parse JSON
    express.json({ limit: '50mb' })(req, res, next);
  }
});

// Middleware pour URL encoded (uniquement pour non-FormData)
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


// === CHARGEMENT DES ROUTES API ===
console.log('🔍 Chargement des routes...');

// Routes API (COMMENTEZ temporairement la route /api/public)
const apiRoutes = [
  { path: '/api/auth', route: require('./routes/auth.routes') },
  { path: '/api/permissions', route: require('./routes/permission.routes') },
  { path: '/api/rolepermissions', route: require('./routes/rolePermission.routes') },
  { path: '/api/roles', route: require('./routes/role.routes') },
  { path: '/api/utilisateurs', route: require('./routes/user.routes') },
  { path: '/api/departements', route: require('./routes/departement.routes') },
  { path: '/api/typesfiliere', route: require('./routes/typesFiliere.routes') },
  { path: '/api/filieres', route: require('./routes/filieres.routes') },
  { path: '/api/annees', route: require('./routes/anne.routes') },
  { path: '/api/curcus', route: require('./routes/curcus.routes') },
  { path: '/api/etudiants', route: require('./routes/etudiant.routes') },
  { path: '/api/niveaux', route: require('./routes/niveau.routes') },
  { path: "/api/paiements", route: require('./routes/payement.routes') },
  { path: "/api/data", route: require('./routes/data.routes') },
  { path: "/api/priseEnCharge", route: require('./routes/priseEnCharge.routes') },
  { path: "/api/kit", route: require('./routes/kit.routes') },
  { path: "/api/effectifs", route: require('./routes/effectifs.routes') },
  { path: "/api/classes", route: require('./routes/classes.routes') },
  { path: "/api/StatDashboard", route: require('./routes/StatDashboard.routes') },
  { path: "/api/CertificatScolarite", route: require('./routes/CertificatScolarite.routes') },
  { path: "/api/CertificaFrentation", route: require('./routes/CertificatFrequentation.routes') },
  { path: "/api/StatsInscriptions", route: require('./routes/StatsInscriptions.routes') },
  { path: "/api/maquettes", route: require('./routes/maquette.routes') },
  { path: "/api/semestres", route: require('./routes/semestre.routes') },
  { path: "/api/categorie", route: require('./routes/categorie.routes') },
  { path: "/api/ues", route: require('./routes/ue.routes') },
  { path: "/api/matiere", route: require('./routes/matiere.routes') },
  { path: "/api/statistiques", route: require('./routes/StatistiqueGeneral.routes') },
  { path: "/api/donneeespaceetudiant", route: require('./routes/donneeespaceetudiant.routes') },
  { path: "/api/etudiant-payement-espace", route: require('./routes/PaiementEespaceetudiant.routes') },
  { path: "/api/detailaffichageMaquette", route: require('./routes/DetailAffichageMaquette.routes') }, 
  { path: "/api/public", route: require('./routes/public.routes') }, // ← COMMENTÉE TEMPORAIREMENT
  { path: "/api/emploiDuTemps", route: require('./routes/EDT.routes') },
  { path: "/api/Certificat_Scolarite", route: require('./routes/Certificat_scolarite.routes') },
  { path: "/api/certificats-frequentation", route: require('./routes/Certificat_frequentation.routes') },
  { path: "/api/notes", route: require('./routes/notes.routes') },
  { path: "/api/professeur", route: require('./routes/professeur.routes')},

];

// Chargement des routes
apiRoutes.forEach(route => {
  app.use(route.path, route.route);
  console.log(`✅ Route chargée: ${route.path}`);
});

console.log('🎉 Routes API chargées avec succès!');

// Avant les autres routes, ajouter ce test endpoint
app.post('/api/test-formdata', (req, res) => {
  console.log('🧪 Test FormData endpoint appelé');
  console.log('📋 Content-Type:', req.headers['content-type']);
  console.log('📦 Raw body (premier 1000 chars):', 
    req.rawBody ? req.rawBody.substring(0, 1000) : 'Pas de raw body'
  );
  
  res.json({
    success: true,
    message: 'Test endpoint fonctionne',
    contentType: req.headers['content-type'],
    bodyKeys: Object.keys(req.body),
    hasFile: !!req.file
  });
});

// Routes de base
// Dans app.js, ajoutez cette route
app.get('/test-images', (req, res) => {
    res.json({
        logo: `${process.env.API_URL || 'http://localhost:5000'}/public/logo.png`,
        photoroom: `${process.env.API_URL || 'http://localhost:5000'}/public/IIPEA-Photoroom.png`,
        baseUrl: process.env.API_URL || 'http://localhost:5000'
    });
});

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.stack}`);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
  console.log(`✅ Serveur démarré sur le port ${PORT}`);
});