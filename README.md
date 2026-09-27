# Bob Code Editor — version Electron

Interface desktop moderne inspirée de VS Code, réalisée avec Electron + HTML + CSS + JavaScript.

## Installation

1. Installer Node.js (version LTS recommandée).
2. Ouvrir un terminal dans ce dossier.
3. Exécuter :

```bash
npm install
npm start
```

## Fonctionnalités présentes

- Interface sombre style VS Code
- Barre d'outils
- Explorateur à gauche
- Éditeur de code
- Numéros de lignes
- Indentation avec Tab
- Zone Miroir
- Zone Bibliothèques
- Zone Erreurs / Corrections
- Terminal visuel
- Créer / Ouvrir / Sauvegarder
- Bouton Analyser avec Bob (placeholder, sans appel Bob)

## Prochaine étape

Le branchement Bob pourra remplacer `analyzeWithBob()` dans `renderer.js`.
Le format de réponse prévu est celui du projet :

=== COMMENTAIRES INLINE ===
=== EXPLICATIONS (ZONE MIROIR) ===
=== BIBLIOTHÈQUES NÉCESSAIRES ===
=== ERREURS ET CORRECTIONS ===

## Bobcoins

Aucun appel à Bob n'est réalisé par cette version. Le bouton d'analyse ne consomme donc pas de Bobcoins.
