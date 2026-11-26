# AYIFIN — Ayiti Finans v4

Application de microfinance **multi-entreprise** (GitHub Pages + Supabase).
Développée par ING. Worvensky-Wadson PIERRE.

## Rôles
| Rôle | Droits |
|---|---|
| **SUPERADMIN** (vous) | Crée/modifie/suspend les entreprises, fixe plan, limite d'utilisateurs, date de fin de contrat, logo. Crée les admins, active/désactive tout utilisateur, voit le journal global. |
| **ADMIN** (entreprise) | Tout dans son entreprise + **seul à pouvoir approuver/rejeter un prêt**, gère les utilisateurs (dans la limite du contrat), produits, logo, alertes, journal. |
| **AGENT** | Clients, comptes, dépôts/retraits, demandes de prêt, paiements, rapports. |
| **CAISSIER** | Ouverture de compte, dépôts, retraits, paiements de prêt. |

Chaque opération d'un non-admin génère une **alerte temps réel** pour l'admin + une ligne dans le **journal d'audit**.

## Installation (dans cet ordre)
1. **Supabase → Authentication → Providers → Email** : désactivez **« Confirm email »**
   (obligatoire : la création d'utilisateurs par l'admin ne fonctionne pas sinon).
2. **Authentication → URL Configuration** : *Site URL* = l'adresse GitHub Pages de l'app (pour la réinitialisation de mot de passe).
3. **Authentication → Users → Add user** : `admin@ayifin.com` + **un NOUVEAU mot de passe fort** + « Auto Confirm User ».
   ⚠️ L'ancien mot de passe était écrit dans le code public GitHub : changez-le impérativement.
4. **SQL Editor** : collez tout `schema.sql` → **Run** (⚠️ efface les anciennes tables AYIFIN).
   La dernière section promeut `admin@ayifin.com` en SUPERADMIN. Si vous créez l'utilisateur après, relancez seulement cette dernière section.
5. Remplacez sur GitHub : `index.html`, `app.js`, `supabase.js`, `style.css`, `README.md` (`manifest.json` et `icon.svg` ne changent pas).
6. Connectez-vous → **Entreprises → + Nouvelle entreprise** (avec son administrateur). L'admin crée ensuite ses agents/caissiers.

## Règles financières appliquées (côté base de données)
- Toutes les opérations d'argent passent par des fonctions SQL atomiques (aucune écriture directe possible sur comptes, dépôts, retraits, prêts, paiements).
- Intérêt simple mensuel : `total = capital + capital × taux × durée` ; taux imposé par le type de prêt (l'agent ne peut pas le changer).
- Frais de dossier retenus au décaissement ; frais d'ouverture de compte retenus sur le dépôt initial.
- Approbation : ADMIN seulement, vérifie la caisse ; l'échéancier démarre à la date de décaissement.
- Paiement : intérêts d'abord puis capital, refus de sur-paiement, échéances marquées PAYÉ automatiquement, retard détecté automatiquement.
- Retrait refusé si solde ou caisse insuffisants ; clôture refusée si prêt actif ; un client en retard ne peut pas obtenir un nouveau prêt.
- Un client ayant des comptes/prêts ne peut pas être supprimé.
