const express = require('express');
const QRCode = require('qrcode');
const db = require('../config/db.config');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// === FONCTIONS AMÉLIORÉES POUR CERTIFICAT DE FRÉQUENTATION ===

// Fonction pour récupérer tous les étudiants d'un département
async function getAllStudentsByDepartement(departementId) {
    try {
        const query = `
        SELECT id, nom, prenoms, matricule 
        FROM etudiant 
        WHERE departement_id = $1 
        AND standing = 'Inscrit'
        ORDER BY nom ASC, prenoms ASC, matricule ASC
        `;
        const result = await db.query(query, [departementId]);
        return result.rows.map(row => ({
            id: row.id,
            nom: row.nom,
            prenoms: row.prenoms,
            matricule: row.matricule
        }));
    } catch (error) {
        console.error('❌ Erreur récupération étudiants:', error);
        throw error;
    }
}

// NOUVELLE FONCTION : Récupérer les étudiants d'un groupe spécifique
async function getStudentsByGroupe(groupeId) {
    try {
        const query = `
        SELECT 
            e.id,
            e.nom,
            e.prenoms,
            e.matricule,
            e.matricule_iipea,
            e.code_unique,
            e.date_naissance,
            e.lieu_naissance,
            e.telephone,
            e.email,
            e.lieu_residence,
            e.contact_parent,
            e.contact_parent_2,
            e.nationalite,
            e.sexe,
            e.photo_url,
            e.date_inscription,
            e.statut_scolaire,
            f.nom as filiere_nom,
            f.sigle as filiere_sigle,
            n.libelle as niveau_libelle,
            a.annee as annee_academique
        FROM etudiant e
        LEFT JOIN filiere f ON e.id_filiere = f.id
        LEFT JOIN niveau n ON e.niveau_id = n.id
        LEFT JOIN anneeacademique a ON e.annee_academique_id = a.id
        WHERE e.groupe_id = $1
        AND e.standing = 'Inscrit'
        ORDER BY e.nom ASC, e.prenoms ASC, e.matricule ASC
        `;
        const result = await db.query(query, [groupeId]);
        return result.rows;
    } catch (error) {
        console.error('❌ Erreur récupération étudiants du groupe:', error);
        throw error;
    }
}

// Fonction pour récupérer les détails d'un groupe
async function getGroupeDetail(groupeId) {
    try {
        const query = `
        SELECT 
            g.id,
            g.nom,
            g.capacite_max,
            c.nom as classe_nom,
            COUNT(e.id) as effectif,
            CASE 
                WHEN g.capacite_max > 0 
                THEN ROUND((COUNT(e.id) * 100.0 / g.capacite_max), 2)
                ELSE 0 
            END as taux_remplissage
        FROM groupe g
        LEFT JOIN classe c ON g.classe_id = c.id
        LEFT JOIN etudiant e ON e.groupe_id = g.id
        WHERE g.id = $1
        GROUP BY g.id, g.nom, g.capacite_max, c.nom
        `;
        const result = await db.query(query, [groupeId]);
        return result.rows[0] || null;
    } catch (error) {
        console.error('❌ Erreur récupération détail groupe:', error);
        throw error;
    }
}

async function getCertificatFrequentationData(studentId) {
    try {
        console.log(`🔍 Récupération données fréquentation pour étudiant: ${studentId}`);
        
        // REQUÊTE PRINCIPALE OPTIMISÉE
        const queryBase = `
            SELECT 
                e.id,
                e.matricule,
                e.nom,
                e.prenoms,
                e.date_naissance,
                e.lieu_naissance,
                e.telephone,
                e.email,
                e.lieu_residence,
                e.contact_parent,
                e.code_unique,
                e.annee_bac,
                e.serie_bac,
                e.etablissement_origine,
                e.photo_url,
                e.date_inscription,
                e.statut_scolaire,
                e.nationalite,
                e.sexe,
                e.contact_etudiant,
                e.contact_parent_2,
                e.matricule_iipea,
                e.pays_naissance,
                e.nom_parent_1,
                e.nom_parent_2,
                
                f.id as filiere_id,
                f.nom as filiere_nom,
                f.sigle as filiere_sigle,
                
                n.id as niveau_id,
                n.libelle as niveau_libelle,
                n.prix_formation as niveau_prix,
                
                a.id as annee_academique_id,
                a.annee as annee_academique,
                a.etat as annee_etat,
                
                g.id as groupe_id,
                g.nom as groupe_nom,
                g.capacite_max as groupe_capacite,
                
                c.id as classe_id,
                c.nom as classe_nom
                
            FROM etudiant e
            LEFT JOIN filiere f ON e.id_filiere = f.id
            LEFT JOIN niveau n ON e.niveau_id = n.id
            LEFT JOIN anneeacademique a ON e.annee_academique_id = a.id
            LEFT JOIN groupe g ON e.groupe_id = g.id
            LEFT JOIN classe c ON g.classe_id = c.id
            WHERE e.id = $1
        `;

        // REQUÊTE POUR L'HISTORIQUE DES ANNÉES
        const queryHistorique = `
            SELECT 
                a.id as annee_id,
                a.annee as annee_academique,
                n.libelle as niveau_libelle,
                f.nom as filiere_nom,
                g.nom as groupe_nom,
                c.nom as classe_nom,
                e.date_inscription
            FROM etudiant e
            LEFT JOIN anneeacademique a ON e.annee_academique_id = a.id
            LEFT JOIN niveau n ON e.niveau_id = n.id
            LEFT JOIN filiere f ON e.id_filiere = f.id
            LEFT JOIN groupe g ON e.groupe_id = g.id
            LEFT JOIN classe c ON g.classe_id = c.id
            WHERE e.id = $1
            ORDER BY a.annee DESC
        `;

        const [resultBase, resultHistorique] = await Promise.all([
            db.query(queryBase, [parseInt(studentId)]),
            db.query(queryHistorique, [parseInt(studentId)])
        ]);

        if (resultBase.rows.length === 0) {
            console.log(`❌ Aucune donnée trouvée pour l'étudiant ${studentId}`);
            return null;
        }

        const etudiantData = resultBase.rows[0];
        
        // STRUCTURATION OPTIMISÉE DE L'HISTORIQUE
        let historiqueAnnees = [];
        
        if (resultHistorique.rows.length > 0) {
            console.log(`📊 Historique académique trouvé: ${resultHistorique.rows.length} année(s)`);
            historiqueAnnees = resultHistorique.rows.map((row, index) => ({
                annee: row.annee_academique || etudiantData.annee_academique,
                annee_id: row.annee_id || etudiantData.annee_academique_id,
                niveau: row.niveau_libelle || etudiantData.niveau_libelle,
                filiere: row.filiere_nom || etudiantData.filiere_nom,
                groupe: row.groupe_nom || etudiantData.groupe_nom,
                classe: row.classe_nom || etudiantData.classe_nom,
                date_inscription: row.date_inscription || etudiantData.date_inscription,
                statut: 'Inscrit',
                ordre: index + 1
            }));
        } else {
            // Données par défaut avec l'année actuelle
            console.log(`⚠️ Aucun historique, utilisation données actuelles`);
            historiqueAnnees = [{
                annee: etudiantData.annee_academique,
                annee_id: etudiantData.annee_academique_id,
                niveau: etudiantData.niveau_libelle,
                filiere: etudiantData.filiere_nom,
                groupe: etudiantData.groupe_nom,
                classe: etudiantData.classe_nom,
                date_inscription: etudiantData.date_inscription,
                statut: 'Inscrit',
                ordre: 1
            }];
        }

        // STRUCTURE FINALE DES DONNÉES
        const studentData = {
            informations_personnelles: {
                id: etudiantData.id,
                matricule: etudiantData.matricule,
                code_unique: etudiantData.code_unique,
                nom: etudiantData.nom,
                prenoms: etudiantData.prenoms,
                date_naissance: etudiantData.date_naissance,
                lieu_naissance: etudiantData.lieu_naissance,
                sexe: etudiantData.sexe,
                nationalite: etudiantData.nationalite,
                telephone: etudiantData.telephone,
                email: etudiantData.email,
                contact_etudiant: etudiantData.contact_etudiant,
                contact_parent: etudiantData.contact_parent,
                contact_parent_2: etudiantData.contact_parent_2,
                lieu_residence: etudiantData.lieu_residence,
                photo_url: etudiantData.photo_url,
                matricule_iipea: etudiantData.matricule_iipea,
                pays_naissance: etudiantData.pays_naissance,
                nom_parent_1: etudiantData.nom_parent_1,
                nom_parent_2: etudiantData.nom_parent_2
            },
            informations_academiques: {
                filiere: {
                    id: etudiantData.filiere_id,
                    nom: etudiantData.filiere_nom,
                    sigle: etudiantData.filiere_sigle
                },
                niveau: {
                    id: etudiantData.niveau_id,
                    libelle: etudiantData.niveau_libelle,
                    prix_formation: etudiantData.niveau_prix
                },
                annee_academique: {
                    id: etudiantData.annee_academique_id,
                    annee: etudiantData.annee_academique,
                    etat: etudiantData.annee_etat
                },
                groupe: {
                    id: etudiantData.groupe_id,
                    nom: etudiantData.groupe_nom,
                    capacite: etudiantData.groupe_capacite
                },
                classe: {
                    id: etudiantData.classe_id,
                    nom: etudiantData.classe_nom
                }
            },
            historique_annees: historiqueAnnees,
            historique: {
                annee_bac: etudiantData.annee_bac,
                serie_bac: etudiantData.serie_bac,
                etablissement_origine: etudiantData.etablissement_origine,
                date_inscription: etudiantData.date_inscription,
                statut_scolaire: etudiantData.statut_scolaire
            }
        };

        console.log(`✅ Données fréquentation préparées avec ${historiqueAnnees.length} année(s) académique(s)`);
        return studentData;

    } catch (error) {
        console.error('💥 Erreur récupération données étudiant (fréquentation):', error);
        throw error;
    }
}

// === FONCTIONS UTILITAIRES AMÉLIORÉES ===
function generateQRCodeValueFrequentation(studentData) {
    const data = {
        matricule: studentData.informations_personnelles.matricule,
        code_unique: studentData.informations_personnelles.code_unique,
        nom: studentData.informations_personnelles.nom,
        prenoms: studentData.informations_personnelles.prenoms,
        type: 'certificat de frequentation',
        date_emission: new Date().toISOString().split('T')[0],
        annee_academique: studentData.informations_academiques.annee_academique.annee
    };
    return JSON.stringify(data);
}

function checkPhotoExists(photoUrl) {
    if (!photoUrl || photoUrl === '/public/logo.png') {
        return false;
    }
    
    try {
        const cleanPath = photoUrl.startsWith('/') ? photoUrl.substring(1) : photoUrl;
        const fullPath = path.join(__dirname, '..', cleanPath);
        const exists = fs.existsSync(fullPath);
        if (!exists) {
            console.log(`📸 Photo non trouvée: ${cleanPath}`);
        }
        return exists;
    } catch (error) {
        console.error('❌ Erreur vérification photo:', error);
        return false;
    }
}
// Focnction pour obtenir l'URL complète de la photo 
function getCompletePhotoUrl(originalPhotoUrl) {
    if (originalPhotoUrl && originalPhotoUrl.startsWith('http')) {
        return originalPhotoUrl;
    } else if (originalPhotoUrl && checkPhotoExists(originalPhotoUrl)) {
        const cleanPath = originalPhotoUrl.startsWith('/') ? originalPhotoUrl : `/${originalPhotoUrl}`;
        // Utiliser le chemin relatif correct
        return `${process.env.API_URL || 'http://localhost:5000'}${cleanPath}`;
    } else {
        // Chemin corrigé pour l'image par défaut
        return `${process.env.API_URL || 'http://localhost:5000'}/public/default-avatar.png`;
    }
}

function formatDate(dateString) {
    if (!dateString) return 'Non spécifié';
    try {
        return new Date(dateString).toLocaleDateString('fr-FR');
    } catch (error) {
        console.error('❌ Erreur formatage date:', error);
        return 'Date invalide';
    }
}

function formatNationalite(nationalite) {
    if (!nationalite) return 'Non spécifiée';
    const nationalites = {
        'CI': 'IVOIRIENNE',
        'BF': 'BURKINABÉ',
        'ML': 'MALIENNE',
        'SN': 'SÉNÉGALAISE',
        'GN': 'GUINÉENNE',
        'NE': 'NIGÉRIENNE',
        'TG': 'TOGOLAISE',
        'BJ': 'BÉNINOISE'
    };
    return nationalites[nationalite] || nationalite;
}

async function prepareTemplateDataFrequentation(studentData) {
    let qrCodeImage = null;
    
    try {
        const qrCodeValue = generateQRCodeValueFrequentation(studentData);
        if (qrCodeValue) {
            qrCodeImage = await QRCode.toDataURL(qrCodeValue, {
                width: 120,
                margin: 1,
                errorCorrectionLevel: 'M'
            });
        }
    } catch (error) {
        console.error('❌ Erreur génération QR Code:', error);
    }

    // Gestion optimisée des photos
    const originalPhotoUrl = studentData.informations_personnelles.photo_url;
    const photoUrlComplete = getCompletePhotoUrl(originalPhotoUrl);

    if (photoUrlComplete.includes('default-avatar')) {
        console.log(`🔄 Photo par défaut pour: ${studentData.informations_personnelles.nom}`);
    }

    return {
        ...studentData,
        date_naissance_formatee: formatDate(studentData.informations_personnelles.date_naissance),
        date_inscription_formatee: formatDate(studentData.historique.date_inscription),
        nationalite_formatee: formatNationalite(studentData.informations_personnelles.nationalite),
        photo_url_complete: photoUrlComplete,
        date_emission: new Date().toLocaleDateString('fr-FR'),
        baseUrl: process.env.API_URL || 'http://localhost:5000',
        qrCodeImage: qrCodeImage,
        historique_annees_formate: studentData.historique_annees.map(annee => ({
            ...annee,
            date_inscription_formatee: formatDate(annee.date_inscription)
        }))
    };
}

// === MIDDLEWARE POUR TRAITER LE TOKEN ===
router.use('/certificats-frequentation/html/masse', (req, res, next) => {
    try {
        const token = req.body.token || req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token manquant'
            });
        }
        
        req.headers.authorization = `Bearer ${token}`;
        next();
    } catch (error) {
        console.error('❌ Erreur middleware token:', error);
        return res.status(401).json({
            success: false,
            message: 'Token invalide'
        });
    }
});

router.use('/certificats-frequentation/html/masse/groupe', (req, res, next) => {
    try {
        const token = req.body.token || req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Token manquant'
            });
        }
        
        req.headers.authorization = `Bearer ${token}`;
        next();
    } catch (error) {
        console.error('❌ Erreur middleware token:', error);
        return res.status(401).json({
            success: false,
            message: 'Token invalide'
        });
    }
});

// === ROUTES AMÉLIORÉES ===

// Route pour un certificat individuel
router.get('/certificat-frequentation/etudiant/:id', async (req, res) => {
    let startTime = Date.now();
    
    try {
        const { id } = req.params;
        
        if (!id || isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: "ID étudiant invalide"
            });
        }

        console.log(`🎯 Génération certificat fréquentation individuel pour étudiant: ${id}`);
        
        const studentData = await getCertificatFrequentationData(id);
        if (!studentData) {
            return res.status(404).json({
                success: false,
                message: "Étudiant non trouvé"
            });
        }

        // Logs détaillés pour débogage
        console.log(`📋 Données fréquentation récupérées:`, {
            nom: `${studentData.informations_personnelles.nom} ${studentData.informations_personnelles.prenoms}`,
            nbAnnees: studentData.historique_annees?.length || 0,
            annees: studentData.historique_annees?.map(a => a.annee)
        });

        const templateData = await prepareTemplateDataFrequentation(studentData);
        const executionTime = Date.now() - startTime;

        console.log(`✅ Certificat individuel généré en ${executionTime}ms`);

        res.render('Certificat_frequentation', {
            data: templateData,
            stats: {
                temps_execution: executionTime
            }
        });

    } catch (error) {
        console.error('💥 Erreur génération certificat de fréquentation individuel:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la génération du certificat de fréquentation',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// === NOUVELLE ROUTE : GÉNÉRATION PAR GROUPE ===
router.post('/certificats-frequentation/html/masse/groupe', async (req, res) => {
    let startTime = Date.now();
    
    try {
        const { departement_id, groupe_id } = req.body;
        
        console.log('🚀 Début génération certificats de fréquentation HTML en masse PAR GROUPE');
        console.log('📊 Paramètres:', { departement_id, groupe_id });

        // Validation des paramètres
        if (!departement_id || !groupe_id) {
            return res.status(400).json({
                success: false,
                message: 'Les paramètres departement_id et groupe_id sont obligatoires'
            });
        }

        // Récupérer les informations du groupe
        const groupe = await getGroupeDetail(groupe_id);
        if (!groupe) {
            return res.status(404).json({
                success: false,
                message: 'Groupe non trouvé'
            });
        }

        // Récupérer les étudiants du groupe triés par ordre alphabétique
        const students = await getStudentsByGroupe(groupe_id);
        console.log(`📋 ${students.length} étudiants trouvés pour le groupe ${groupe.nom}`);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Aucun étudiant trouvé dans ce groupe'
            });
        }

        // Afficher l'ordre alphabétique dans les logs
        console.log('📝 Ordre alphabétique des étudiants du groupe:');
        students.forEach((student, index) => {
            console.log(`  ${index + 1}. ${student.nom} ${student.prenoms} (${student.matricule})`);
        });

        const certificatsData = [];
        let succesCount = 0;
        let echecCount = 0;
        let photosTrouvees = 0;
        let photosDefaut = 0;
        let totalAnnees = 0;

        // Préparer les données pour chaque étudiant avec gestion de la concurrence
        const promises = students.map(async (student, index) => {
            try {
                console.log(`🔄 ${index + 1}/${students.length}: ${student.nom} ${student.prenoms}`);
                
                const studentData = await getCertificatFrequentationData(student.id);
                if (!studentData) {
                    console.log(`❌ Données manquantes pour ${student.nom} ${student.prenoms}`);
                    echecCount++;
                    return null;
                }

                // Préparer les données du template
                const templateData = await prepareTemplateDataFrequentation(studentData);
                
                // Compter les statistiques
                totalAnnees += templateData.historique_annees?.length || 0;
                
                if (templateData.photo_url_complete.includes('default-avatar')) {
                    photosDefaut++;
                } else {
                    photosTrouvees++;
                }
                
                succesCount++;
                return templateData;

            } catch (error) {
                console.error(`❌ Erreur étudiant ${student.nom} ${student.prenoms}:`, error.message);
                echecCount++;
                return null;
            }
        });

        // Attendre que toutes les promesses soient résolues
        const results = await Promise.allSettled(promises);
        
        // Filtrer les résultats valides
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                certificatsData.push(result.value);
            }
        });

        // Vérifier si des certificats ont été générés
        if (certificatsData.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Aucun certificat de fréquentation généré avec succès pour ce groupe'
            });
        }

        // Calculer le temps d'exécution
        const executionTime = Date.now() - startTime;

        console.log('\n🎉 RÉSULTATS DE LA GÉNÉRATION PAR GROUPE (FRÉQUENTATION):');
        console.log(`🏫 Groupe: ${groupe.nom}`);
        console.log(`👥 Effectif: ${groupe.effectif} étudiants`);
        console.log(`✅ ${succesCount} certificats générés avec succès`);
        console.log(`❌ ${echecCount} échecs de génération`);
        console.log(`📊 Total années académiques: ${totalAnnees}`);
        console.log(`📸 Photos: ${photosTrouvees} trouvées, ${photosDefaut} par défaut`);
        console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
        console.log(`📈 Taux de réussite: ${((succesCount / students.length) * 100).toFixed(1)}%`);

        // Rendre le template EJS avec tous les certificats
        res.render('Certificat_frequentation_multiple', {
            certificats: certificatsData,
            type_certificat: 'frequentation',
            groupe: {
                nom: groupe.nom,
                classe_nom: groupe.classe_nom,
                effectif: groupe.effectif,
                taux_remplissage: groupe.taux_remplissage
            },
            stats: {
                total: students.length,
                succes: succesCount,
                echec: echecCount,
                photos_trouvees: photosTrouvees,
                photos_defaut: photosDefaut,
                total_annees: totalAnnees,
                temps_execution: executionTime
            }
        });

    } catch (error) {
        console.error('💥 Erreur génération HTML masse par groupe (fréquentation):', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la génération des certificats de fréquentation du groupe',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Route pour affichage HTML en masse avec tri alphabétique (département)
router.post('/certificats-frequentation/html/masse', async (req, res) => {
    let startTime = Date.now();
    
    try {
        const { departement_id } = req.body;
        
        console.log('🚀 Début génération certificats de fréquentation HTML en masse');
        console.log('📊 Paramètres:', { departement_id });

        // Validation des paramètres
        if (!departement_id) {
            return res.status(400).json({
                success: false,
                message: 'Le paramètre departement_id est obligatoire'
            });
        }

        // Récupérer tous les étudiants triés par ordre alphabétique
        const students = await getAllStudentsByDepartement(departement_id);
        console.log(`📋 ${students.length} étudiants trouvés pour le département ${departement_id}`);

        if (students.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Aucun étudiant trouvé pour ce département'
            });
        }

        // Afficher l'ordre alphabétique dans les logs
        console.log('📝 Ordre alphabétique des étudiants:');
        students.forEach((student, index) => {
            console.log(`  ${index + 1}. ${student.nom} ${student.prenoms} (${student.matricule})`);
        });

        const certificatsData = [];
        let succesCount = 0;
        let echecCount = 0;
        let photosTrouvees = 0;
        let photosDefaut = 0;
        let totalAnnees = 0;

        // Préparer les données pour chaque étudiant avec gestion de la concurrence
        const promises = students.map(async (student, index) => {
            try {
                console.log(`🔄 ${index + 1}/${students.length}: ${student.nom} ${student.prenoms}`);
                
                const studentData = await getCertificatFrequentationData(student.id);
                if (!studentData) {
                    console.log(`❌ Données manquantes pour ${student.nom} ${student.prenoms}`);
                    echecCount++;
                    return null;
                }

                // Préparer les données du template
                const templateData = await prepareTemplateDataFrequentation(studentData);
                
                // Compter les statistiques
                totalAnnees += templateData.historique_annees?.length || 0;
                
                if (templateData.photo_url_complete.includes('default-avatar')) {
                    photosDefaut++;
                } else {
                    photosTrouvees++;
                }
                
                succesCount++;
                return templateData;

            } catch (error) {
                console.error(`❌ Erreur étudiant ${student.nom} ${student.prenoms}:`, error.message);
                echecCount++;
                return null;
            }
        });

        // Attendre que toutes les promesses soient résolues
        const results = await Promise.allSettled(promises);
        
        // Filtrer les résultats valides
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                certificatsData.push(result.value);
            }
        });

        // Vérifier si des certificats ont été générés
        if (certificatsData.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'Aucun certificat de fréquentation généré avec succès'
            });
        }

        // Calculer le temps d'exécution
        const executionTime = Date.now() - startTime;

        console.log('\n🎉 RÉSULTATS DE LA GÉNÉRATION (FRÉQUENTATION):');
        console.log(`✅ ${succesCount} certificats générés avec succès`);
        console.log(`❌ ${echecCount} échecs de génération`);
        console.log(`📊 Total années académiques: ${totalAnnees}`);
        console.log(`📸 Photos: ${photosTrouvees} trouvées, ${photosDefaut} par défaut`);
        console.log(`⏱️ Temps d'exécution: ${executionTime}ms`);
        console.log(`📈 Taux de réussite: ${((succesCount / students.length) * 100).toFixed(1)}%`);

        // Rendre le template EJS avec tous les certificats
        res.render('Certificat_frequentation_multiple', {
            certificats: certificatsData,
            type_certificat: 'frequentation',
            stats: {
                total: students.length,
                succes: succesCount,
                echec: echecCount,
                photos_trouvees: photosTrouvees,
                photos_defaut: photosDefaut,
                total_annees: totalAnnees,
                temps_execution: executionTime
            }
        });

    } catch (error) {
        console.error('💥 Erreur génération HTML masse (fréquentation):', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la génération des certificats de fréquentation',
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Route de vérification de certificat de fréquentation
router.get('/verify-certificat-frequentation', async (req, res) => {
    try {
        const { id, code_unique, matricule } = req.query;
        
        if (!id || !code_unique) {
            return res.status(400).json({
                success: false,
                message: 'Les paramètres id et code_unique sont obligatoires'
            });
        }

        const studentData = await getCertificatFrequentationData(id);
        if (!studentData) {
            return res.status(404).json({
                success: false,
                message: 'Certificat de fréquentation non trouvé'
            });
        }

        if (studentData.informations_personnelles.code_unique !== code_unique) {
            return res.status(401).json({
                success: false,
                message: 'Code de vérification invalide'
            });
        }

        if (matricule && studentData.informations_personnelles.matricule !== matricule) {
            return res.status(401).json({
                success: false,
                message: 'Matricule invalide'
            });
        }

        res.json({
            success: true,
            message: 'Certificat de fréquentation vérifié avec succès',
            data: {
                ...studentData,
                date_verification: new Date().toISOString(),
                type: 'frequentation'
            }
        });

    } catch (error) {
        console.error('❌ Erreur vérification certificat fréquentation:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la vérification du certificat de fréquentation',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Route pour obtenir la liste des étudiants triés par département
router.get('/etudiants-frequentation/departement/:departement_id', async (req, res) => {
    try {
        const { departement_id } = req.params;
        
        const students = await getAllStudentsByDepartement(departement_id);
        
        res.json({
            success: true,
            data: students,
            count: students.length,
            type: 'frequentation'
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération étudiants (fréquentation):', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des étudiants'
        });
    }
});

// NOUVELLE ROUTE : Obtenir les étudiants d'un groupe pour la fréquentation
router.get('/etudiants-frequentation/groupe/:groupe_id', async (req, res) => {
    try {
        const { groupe_id } = req.params;
        
        const students = await getStudentsByGroupe(groupe_id);
        
        res.json({
            success: true,
            data: students,
            count: students.length,
            type: 'frequentation'
        });
        
    } catch (error) {
        console.error('❌ Erreur récupération étudiants du groupe (fréquentation):', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de la récupération des étudiants du groupe'
        });
    }
});

// Route de santé du module fréquentation
router.get('/health-frequentation', (req, res) => {
    res.json({
        success: true,
        message: 'Module certificats de fréquentation opérationnel',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

module.exports = router;