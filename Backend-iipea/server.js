const express = require('express');
const cors = require('cors');
require('dotenv').config();
const bodyParser = require('body-parser');
const path = require('path');

const app = express();

// Configuration CORS améliorée
const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Authorization', 'Content-Disposition']
};

// Middlewares
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static('uploads'));
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
});

// Logger des requêtes
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
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
  {path: '/api/niveaux', route: require('./routes/niveau.routes')},
  {path: "/api/paiements", route: require('./routes/payement.routes')},
  {path: "/api/data", route: require('./routes/data.routes')},
  {path: "/api/priseEnCharge", route: require('./routes/priseEnCharge.routes')},
  {path: "/api/kit", route: require('./routes/kit.routes')},
  {path: "/api/effectifs", route: require('./routes/effectifs.routes')},
  {path: "/api/classes", route: require('./routes/classes.routes')} ,
  {path: "/api/StatDashboard", route: require('./routes/StatDashboard.routes')},
  {path: "/api/CertificatScolarite", route: require('./routes/CertificatScolarite.routes')},
  {path: "/api/CertificaFrentation", route : require('./routes/CertificatFrequentation.routes')},
  {path:"/api/StatsInscriptions", route: require('./routes/StatsInscriptions.routes')},
  {path:"/api/maquettes", route: require('./routes/maquette.routes')},
  {path:"/api/semestres", route: require('./routes/semestre.routes')},
  {path:"/api/categorie", route: require('./routes/categorie.routes')},
  {path:"/api/ues", route: require('./routes/ue.routes')},
  {path:"/api/matiere", route: require('./routes/matiere.routes')},
  {path:"/api/statistiques", route: require('./routes/StatistiqueGeneral.routes')},
  {path:"/api/donneeespaceetudiant", route: require('./routes/donneeespaceetudiant.routes')},
  {path:"/api/etudiant-payement-espace", route: require('./routes/PaiementEespaceetudiant.routes')},
  {path:"/api/detailaffichageMaquette", route: require('./routes/DetailAffichageMaquette.routes')}, 
  {path:"/api/public", route: require('./routes/public.routes')},
  {path:"/api/emploiDuTemps", route: require('./routes/EDT.routes')},
  // {path: "/api/divisionGroupe", route: require('./routes/divisionGroupe.routes')}


];

apiRoutes.forEach(route => {
  app.use(route.path, route.route);
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Gestion des erreurs
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${err.stack}`);
  res.status(err.status || 500).json({
    error: {
      message: err.message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    }
  });
});

// Démarrer le serveur
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server ready at http://localhost:${PORT}`);
  console.log(`⚙️  Environment: ${process.env.NODE_ENV || 'development'}`);
});