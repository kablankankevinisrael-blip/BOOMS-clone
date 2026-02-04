# BOOMS Platform - Documentation Technique Complète

🎨 **Plateforme complète de gestion, achat, vente et circulation sécurisée des BOOMs** (œuvres numériques tokenisées)

Cette documentation fournit une vision 360° du système pour tout nouveau développeur.

## 📋 Table des matières
1. [Vue d'ensemble du système](#vue-densemble)
2. [Technologies Stack](#technologies-stack)
3. [Architecture globale](#architecture-globale)
4. [Flux de données](#flux-de-données)
5. [Backend FastAPI](#backend-fastapi)
6. [Admin Web (Next.js)](#admin-web-nextjs)
7. [Frontend Mobile (React Native/Expo)](#frontend-mobile-react-nativeexpo)
8. [Scripts & Outils](#scripts--outils)
9. [Configuration & Environnement](#configuration--environnement)
10. [Démarrage](#démarrage)
11. [Structure des fichiers](#structure-des-fichiers)
12. [Communication inter-services](#communication-inter-services)
13. [Sécurité](#sécurité)
14. [Déploiement](#déploiement)

## Vue d'ensemble

BOOMS est une plateforme distribuée à trois modules:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    🎨 BOOMS PLATFORM - SYSTÈME COMPLET                   │
└──────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  UTILISATEURS FINAUX                                                        │
├─────────────────────────────────────────────────────────────────────────────┤
│  📱 Mobile (Expo)    🖥️  Admin Web (Next.js)   📊 Dashboard              │
└──────────────────┬───────────────────────────┬─────────────────────────────┘
                   │                           │
                   │ HTTP/WebSocket            │ HTTP/WebSocket
                   │ 192.168.1.7:19000         │ 192.168.1.7:3000
                   │                           │
┌──────────────────v───────────────────────────v─────────────────────────────┐
│                    🔌 BACKEND API (FastAPI)                                │
│                    Port: 8000 (192.168.1.7:8000)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Routes RESTAPI (/api/v1/...)                                            │
│  • WebSocket Server (ws://192.168.1.7:8000/ws)                            │
│  • Services Métier (auth, market, wallet, gifts, etc.)                    │
│  • Database Layer (SQLAlchemy)                                             │
│  • JWT Authentication                                                      │
└──────────────────────┬──────────────────────────────────────────────────────┘
                       │
                       │ SQL/Transactions
                       │
           ┌───────────v─────────────┐
           │   🗄️  PostgreSQL DB    │
           │   (booms_db)           │
           │   Port: 5433           │
           └────────────────────────┘
```

### Caractéristiques clés

✅ **Métiers**
- Gestion de catalogue BOOMs (recherche, filtres)
- Marché d'achat/vente/transfert
- Trésorerie & portefeuille utilisateur
- Système de gifts (cadeaux BOOMs)
- Paiements multiples (Stripe, Wave, Orange Money, MTN MoMo)

✅ **Infrastructure**
- API temps réel via WebSocket
- Authentification JWT
- Configuration centralisée via .env
- Base de données PostgreSQL
- Logs métier (ex: mouvements trésorerie)

✅ **Développement**
- Trois applications indépendantes (backend, admin-web, frontend)
- Variables d'environnement pour chaque module
- Structure TypeScript/Python professionnelle
- Code séparation concerns (routes, services, models)

---

## Architecture globale

### Diagramme d'architecture en 3 couches

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  COUCHE PRÉSENTATION (Frontend)                                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  📱 FRONTEND MOBILE                   🖥️  ADMIN WEB                        │
│  ├─ React Native                      ├─ Next.js 14                        │
│  ├─ Expo (19000)                      ├─ TypeScript + React 18             │
│  ├─ Services API Client               ├─ TailwindCSS                       │
│  ├─ WebSocket Client                  ├─ Axios pour API                    │
│  └─ Contextes Redux-like              └─ Pages d'admin/dashboard           │
│                                                                             │
│  Litt les URLs depuis:               │ Lit les URLs depuis:                 │
│  → .env.local EXPO_PUBLIC_API_BASE_URL │ → .env.local NEXT_PUBLIC_API_BASE_URL
│  → .env.local (variables publiques)     │ → .env.local (variables publiques)
└──────────────────┬──────────────────────┬──────────────────────────────────┘
                   │                      │
      HTTP REST (JSON)                    │
      WebSocket                           │
                   │                      │
┌──────────────────v──────────────────────v──────────────────────────────────┐
│  COUCHE APPLICATION (Backend API)                                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🔌 API FASTAPI (Port 8000)                                                │
│  ├─ Routes RESTAPI                                                         │
│  │  ├─ /api/v1/auth       (Authentification - JWT)                        │
│  │  ├─ /api/v1/booms      (Catalogue)                                     │
│  │  ├─ /api/v1/market     (Marché)                                        │
│  │  ├─ /api/v1/wallet     (Portefeuille)                                  │
│  │  ├─ /api/v1/gifts      (Cadeaux BOOMs)                                 │
│  │  ├─ /api/v1/payments   (Paiements)                                     │
│  │  └─ /api/v1/users      (Gestion utilisateurs)                          │
│  │                                                                         │
│  ├─ WebSocket Server (/ws)                                                 │
│  │  └─ Mise à jour temps réel (prix, solde, notifications)                │
│  │                                                                         │
│  ├─ Services Métier                                                        │
│  │  ├─ MarketService (achat/vente/transfert)                              │
│  │  ├─ WalletService (solde, transactions)                                │
│  │  ├─ PaymentService (intégrations paiement)                             │
│  │  ├─ GiftService (transferts cadeaux)                                   │
│  │  ├─ NotificationService (notifications temps réel)                     │
│  │  └─ AuthService (JWT, tokens)                                          │
│  │                                                                         │
│  ├─ Middleware                                                              │
│  │  └─ Security (JWT validation, CORS)                                     │
│  │                                                                         │
│  └─ Config & Env                                                            │
│     └─ Lit depuis backend/.env                                             │
│        (BASE_URL, STRIPE_*, WAVE_*, ORANGE_*, MTN_*, DATABASE_URL)       │
│                                                                             │
└──────────────────────────────────────────────┬─────────────────────────────┘
                                               │
                        SQL Queries (SQLAlchemy ORM)
                        Transactions & Locks
                                               │
┌──────────────────────────────────────────────v─────────────────────────────┐
│  COUCHE DONNÉES (Database)                                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  🗄️  PostgreSQL Database (booms_db)                                         │
│  Port: 5433                                                                │
│                                                                             │
│  Tables:                                                                    │
│  ├─ users (id, phone, email, full_name, kyc_status, password)             │
│  ├─ booms (id, title, artist, image, price, collection, tags)             │
│  ├─ inventory (user_id, boom_id, quantity, rarity)                         │
│  ├─ market_listings (id, user_id, boom_id, price, status)                  │
│  ├─ transactions (id, from_id, to_id, boom_id, type, amount, status)      │
│  ├─ wallet (id, user_id, balance_real, balance_virtual)                    │
│  ├─ gifts (id, from_id, to_id, boom_id, message, accepted_at)             │
│  ├─ payments (id, user_id, provider, reference, amount, status)            │
│  └─ ... (24+ tables)                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Flux de données

### Exemple 1: Achat d'un BOOM

```
USER (Frontend Mobile)
    ↓
    └─ [Clic "Acheter BOOM"]
       └─ POST /api/v1/market/purchase
          Données: { boom_id, quantity, payment_method }
          En-têtes: { Authorization: Bearer <JWT_TOKEN> }

BACKEND
    ↓
    └─ [Route auth_required]
       └─ [MarketService.purchase()]
          ├─ Vérifier solde
          ├─ Verrouiller transaction (lock)
          ├─ Débiter wallet
          ├─ Créer transaction (DB)
          ├─ Ajouter à inventory
          └─ Émettre WebSocket event: "purchase_completed"

DATABASE
    ↓
    └─ INSERT transactions
       ├─ UPDATE wallet (user)
       └─ INSERT inventory

FRONTEND (WebSocket)
    ↓
    └─ Reçoit événement WebSocket
       └─ Rafraîchit: portefeuille, inventaire, marketplace
```

### Exemple 2: Synchronisation temps réel (WebSocket)

```
BACKEND WebSocket
    ↓
    └─ Chaque 5 secondes (ou changement):
       ├─ Calcule prix du marché
       ├─ Met à jour valeurs sociales
       └─ Envoie à tous les clients connectés:
          {
            "type": "market_update",
            "data": {
              "boom_id": 123,
              "current_price": 1500,
              "volume_24h": 50,
              "trending": true
            }
          }

FRONTEND (Admin + Mobile)
    ↓
    └─ Reçoit via WebSocket
       └─ Met à jour UI en temps réel
          (prix, solde, notifications)
```

---

## Backend FastAPI

### Structure

```
backend/
├─ app/
│  ├─ __init__.py
│  ├─ main.py                   # Point d'entrée (FastAPI app + routes)
│  ├─ config.py                 # Configuration (Pydantic settings)
│  ├─ database.py               # SQLAlchemy session, engine
│  │
│  ├─ middleware/
│  │  └─ security.py            # JWT validation, CORS
│  │
│  ├─ models/                    # SQLAlchemy ORM models
│  │  ├─ user.py
│  │  ├─ boom.py
│  │  ├─ transaction.py
│  │  ├─ wallet.py
│  │  └─ ...
│  │
│  ├─ schemas/                   # Pydantic validators
│  │  ├─ user_schema.py
│  │  ├─ boom_schema.py
│  │  └─ ...
│  │
│  ├─ routes/                    # API endpoints (RESTful)
│  │  ├─ auth.py                (POST /login, /register)
│  │  ├─ booms.py               (GET /booms, POST /booms)
│  │  ├─ market.py              (GET/POST /market/*)
│  │  ├─ wallet.py              (GET /wallet, POST /deposit)
│  │  ├─ payments.py            (POST /payments/*)
│  │  └─ ...
│  │
│  ├─ services/                  # Logique métier (DDD pattern)
│  │  ├─ auth_service.py        (auth, JWT, tokens)
│  │  ├─ market_service.py      (achat/vente/transfert)
│  │  ├─ wallet_service.py      (portefeuille)
│  │  ├─ payment_service.py     (paiements Stripe, Wave, etc.)
│  │  ├─ gift_service.py        (cadeaux)
│  │  └─ ...
│  │
│  ├─ websockets/
│  │  └─ manager.py             # WebSocket connection manager
│  │
│  ├─ utils/
│  │  ├─ security.py            # Masking, validation (SECRET KEYS)
│  │  └─ ...
│  │
│  └─ migrations/                # Alembic + scripts manuels
│     ├─ create_user_interactions_table.py
│     ├─ migrate_bom_tables.py
│     └─ ...
│
├─ .env                          # Configuration (DATABASE_URL, STRIPE_*, etc.)
├─ .env.example                  # Template pour dev (commiter ce fichier)
├─ requirements.txt              # Dépendances Python
├─ alembic.ini                   # Alembic config
├─ validate_config.py            # Script de validation .env
├─ check_secrets.py              # Scanner pour secrets exposés
└─ env/                          # Virtual environment (local)
```

### Fonctionnement

1. **Démarrage**
   ```bash
   cd backend
   source env/bin/activate  # ou: env\Scripts\activate (Windows)
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

2. **Configuration** (depuis `backend/.env`)
   - `BASE_URL=http://192.168.1.7:8000` → URL du backend
   - `DATABASE_URL=postgresql://user:password@localhost:5433/booms_db`
   - `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`
   - `WAVE_API_KEY`, `ORANGE_API_KEY`, `MTN_MOMO_API_KEY`
   - `CORS_ORIGINS=["http://192.168.1.7:3000", "http://192.168.1.7:19000"]`

3. **Flux d'une requête**
   ```
   Request → Security Middleware (JWT)
           → Route Handler
           → Service (logique métier)
           → Database (SQLAlchemy ORM)
           → Response JSON
   ```

4. **WebSocket**
   - Client se connecte: `ws://192.168.1.7:8000/ws?token=<JWT>`
   - Backend reçoit événement → broadcast à tous les clients
   - Utilisé pour: prix temps réel, solde, notifications

---

## Admin Web (Next.js)

### Structure

```
admin-web/
├─ src/
│  ├─ pages/
│  │  ├─ _app.tsx              # App wrapper (context, providers)
│  │  ├─ _document.tsx         # HTML shell
│  │  ├─ index.tsx             # Dashboard accueil
│  │  ├─ login.tsx             # Page login
│  │  ├─ dashboard.tsx         # Stats & KPIs
│  │  │
│  │  ├─ booms/               # Gestion catalogue
│  │  │  ├─ index.tsx
│  │  │  └─ [id].tsx
│  │  │
│  │  ├─ users/               # Gestion utilisateurs
│  │  ├─ payments/            # Suivi paiements
│  │  ├─ transactions/        # Historique transactions
│  │  └─ ...
│  │
│  ├─ components/
│  │  ├─ Layout/              # Composants globaux
│  │  ├─ Forms/               # Formulaires réutilisables
│  │  ├─ Tables/              # Tableaux de données
│  │  └─ UI/                  # Boutons, modales, etc.
│  │
│  ├─ services/
│  │  ├─ api.ts               # Instance Axios (résolution URL depuis .env)
│  │  ├─ auth.ts              # Service auth
│  │  └─ ...
│  │
│  ├─ hooks/
│  │  ├─ useAdminResource.ts  # Hook pour fetch data
│  │  └─ useTreasuryWebSocket.ts  # Hook WebSocket trésorerie
│  │
│  └─ styles/
│     └─ globals.css
│
├─ .env.local                  # Config (NEXT_PUBLIC_API_BASE_URL, etc.)
├─ .env.example                # Template (pour commiter)
├─ next.config.js
├─ tsconfig.json
├─ tailwind.config.js
├─ package.json
└─ postcss.config.js
```

### Fonctionnement

1. **Variables d'environnement** (`.env.local`)
   - `NEXT_PUBLIC_API_BASE_URL=http://192.168.1.7:8000/api/v1`
   - `NEXT_PUBLIC_API_WS_URL=ws://192.168.1.7:8000/ws`
   - ✅ Lues au build time → embedded dans le bundle
   - ✅ Accessible au client via `process.env.NEXT_PUBLIC_*`

2. **Démarrage**
   ```bash
   cd admin-web
   npm install
   npm run dev    # http://192.168.1.7:3000
   ```

3. **API Client** (dans `services/api.ts`)
   ```typescript
   const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL 
                                || 'http://localhost:8000/api/v1';
   
   export const api = axios.create({
     baseURL: DEFAULT_API_BASE_URL,
     headers: { Authorization: `Bearer ${token}` }
   });
   ```

4. **Pages principales**
   - **login.tsx**: Form login (POST /auth/login)
   - **dashboard.tsx**: Stats globales (utilisateurs, BOOMs, volume)
   - **booms/**: CRUD catalogue
   - **users/**: Gestion users (KYC, ban, etc.)
   - **payments/**: Historique des paiements
   - **transactions/**: Mouvements (achat, vente, transfer, gift)

---

## Frontend Mobile (React Native/Expo)

### Structure

```
frontend/
├─ src/
│  ├─ screens/
│  │  ├─ CatalogueScreen.tsx        # Liste BOOMs
│  │  ├─ PurchaseScreen.tsx         # Détail + achat
│  │  ├─ InventoryScreen.tsx        # Ma collection
│  │  ├─ SendGiftScreen.tsx         # Envoyer cadeau
│  │  ├─ WalletScreen.tsx           # Portefeuille
│  │  ├─ DashboardScreen.tsx        # Accueil
│  │  └─ ...
│  │
│  ├─ services/
│  │  ├─ api.ts                     # Instance Axios (lit EXPO_PUBLIC_*)
│  │  ├─ auth.ts                    # Auth service
│  │  ├─ market.ts                  # Market calls
│  │  ├─ wallet.ts                  # Wallet calls
│  │  └─ websocket.ts               # WebSocket client
│  │
│  ├─ config/
│  │  └─ env.ts                     # Config (lit process.env.*)
│  │
│  ├─ contexts/
│  │  ├─ AuthContext.tsx            # Auth state
│  │  ├─ WalletContext.tsx          # Wallet state
│  │  └─ ...
│  │
│  ├─ hooks/
│  │  ├─ useAuth.ts                 # Auth hook
│  │  ├─ useWallet.ts               # Wallet hook
│  │  └─ ...
│  │
│  ├─ navigation/
│  │  └─ Navigation.tsx             # React Navigation stack/tab
│  │
│  ├─ components/
│  │  ├─ BoomCard.tsx
│  │  ├─ WalletCard.tsx
│  │  └─ ...
│  │
│  ├─ utils/
│  │  ├─ formatting.ts              # Format devise, prix
│  │  └─ ...
│  │
│  └─ types/
│     └─ index.ts                   # TypeScript types
│
├─ .env.local                       # Config (EXPO_PUBLIC_API_BASE_URL)
├─ .env.example                     # Template
├─ app.config.js                    # Expo config
├─ App.tsx                          # Root component
├─ babel.config.js
├─ tsconfig.json
├─ package.json
└─ index.ts
```

### Fonctionnement

1. **Variables d'environnement** (`.env.local`)
   - `EXPO_PUBLIC_API_BASE_URL=http://192.168.1.7:8000/api/v1`
   - ✅ Préfixe `EXPO_PUBLIC_*` → exposé au client
   - Lues depuis `process.env.EXPO_PUBLIC_API_BASE_URL`

2. **Démarrage**
   ```bash
   cd frontend
   npm install
   npx expo start    # Port 19000
   
   # Puis:
   # - 'i' pour iOS Simulator
   # - 'a' pour Android Emulator
   # - Scanner QR code via Expo Go
   ```

3. **API Client** (dans `services/api.ts`)
   ```typescript
   const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL 
                        || 'http://localhost:8000/api/v1';
   
   export const api = axios.create({
     baseURL: API_BASE_URL
   });
   ```

4. **Écrans principaux**
   - **CatalogueScreen**: Liste/recherche BOOMs
   - **PurchaseScreen**: Détail + achat
   - **InventoryScreen**: Collection personnelle (transferts, cadeaux)
   - **WalletScreen**: Solde, dépôts, retraits
   - **DashboardScreen**: Accueil

---

## Technologies Stack

### 🔙 Backend (FastAPI)

| Composant | Technologie | Version | Utilité |
|-----------|-------------|---------|---------|
| **Framework** | FastAPI | 0.100+ | Framework web async, auto-docs Swagger |
| **ORM** | SQLAlchemy | 2.0+ | Mapping objet-relational (models, queries) |
| **Validation** | Pydantic | 2.0+ | Validation schemas input/output |
| **Database** | PostgreSQL | 13+ | Base de données relationnelle |
| **Server ASGI** | Uvicorn | 0.24+ | Serveur ASGI pour FastAPI |
| **Auth** | Python-jose | 3.3+ | JWT tokens, cryptographie |
| **Hashing** | Bcrypt | 4.0+ | Hachage des passwords |
| **WebSocket** | WebSockets | 10.0+ | Support WebSocket temps réel |
| **Email** | Python-email-validator | 2.0+ | Validation emails |
| **Payments** | Stripe SDK | 5.0+ | Intégration Stripe |
| **Env** | python-dotenv | 1.0+ | Chargement .env |
| **Migrations** | Alembic | 1.12+ | Versioning database schema |
| **Rate Limiting** | SlowAPI | 0.1+ | Rate limiting sur endpoints |

**Python Version**: 3.10+

---

### 💻 Frontend Web (Admin - Next.js)

| Composant | Technologie | Version | Utilité |
|-----------|-------------|---------|---------|
| **Framework** | Next.js | 14+ | React framework avec routing |
| **React** | React | 18+ | UI library (JSX, components) |
| **Langage** | TypeScript | 5.0+ | Type-safe JavaScript |
| **CSS** | TailwindCSS | 3.0+ | Utility-first CSS framework |
| **HTTP Client** | Axios | 1.6+ | Client HTTP (REST API calls) |
| **Forms** | React Hook Form | 7.0+ | Form state management |
| **Icons** | React Icons | 4.0+ | Icon library |
| **Notifications** | React Toastify | 9.0+ | Toast notifications |
| **Date** | date-fns | 2.30+ | Date formatting/parsing |
| **Styling** | PostCSS | 8.0+ | CSS transformation |
| **Linting** | ESLint | 8.0+ | Code quality |
| **Node** | Node.js | 18+ | Runtime JavaScript |
| **Package Manager** | npm | 9+ | Dependency management |

**TypeScript**: Complètement typé

---

### 📱 Frontend Mobile (Expo/React Native)

| Composant | Technologie | Version | Utilité |
|-----------|-------------|---------|---------|
| **Framework** | React Native | 0.72+ | Cross-platform mobile (iOS/Android) |
| **Tooling** | Expo | 49+ | Managed React Native platform |
| **React** | React | 18+ | UI library |
| **Langage** | TypeScript | 5.0+ | Type-safe JavaScript |
| **Navigation** | React Navigation | 6.0+ | Stack/Tab navigation |
| **HTTP Client** | Axios | 1.6+ | REST API calls |
| **Storage** | AsyncStorage | 1.21+ | Local device storage |
| **State** | React Context | - | Global state management |
| **Linting** | ESLint | 8.0+ | Code quality |
| **Node** | Node.js | 18+ | Runtime |
| **Package Manager** | npm | 9+ | Dependencies |

**TypeScript**: Complètement typé  
**Support**: iOS + Android (via Expo)

---

## Scripts & Outils

### Backend Scripts

#### 1. **validate_config.py** - Valider la configuration
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\validate_config.py

📝 Utilité: Vérifie que le fichier .env contient tous les paramètres requis

🚀 Commande:
   cd backend
   python validate_config.py

✅ Output attendu:
   ✅ DATABASE_URL: URL de base de données
   ✅ SECRET_KEY: Clé JWT
   ✅ STRIPE_SECRET_KEY: Clé Stripe secrète
   ... (tous les paramètres vérifiés)

⚠️ Si erreur: Script retourne quels params manquent
```

#### 2. **check_secrets.py** - Scanner secrets exposés
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\check_secrets.py

📝 Utilité: Scanne le code pour trouver clés API hardcodées, mots de passe, etc.

🚀 Commande:
   cd backend
   python check_secrets.py

✅ Output attendu (si rien trouvé):
   ✅ Aucune clé API détectée
   ✅ Aucun mot de passe en dur
   Exit code: 0

❌ Si secrets trouvés:
   ⚠️ Stripe secret key trouvée: app/routes/payments.py:123
   ⚠️ Database password exposée: app/config.py:45
   Exit code: 1

🔒 À faire si détecté:
   - Retirer les secrets du code
   - Ajouter dans .env
   - Utiliser environment variables
```

#### 3. **create_admin.py** - Créer utilisateur admin
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\app\scripts\create_admin.py

📝 Utilité: Crée le premier utilisateur administrateur (après déploiement BD vierge)

🚀 Commande:
   cd backend
   python -m app.scripts.create_admin

📋 Interactif - demande:
   • Phone: +33612345678
   • Email: admin@booms.local
   • Password: (secure input)
   • Full Name: Admin User

✅ Output:
   ✅ Admin créé: ID=1
   ✅ Phone: +33612345678
   ✅ Peut se connecter à POST /api/v1/auth/login

⚠️ Notes:
   - À lancer UNE SEULE fois (DB vierge)
   - Après: utiliser API pour créer autres users
```

#### 4. **clean_demo_data.py** - Nettoyer données de test
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\clean_demo_data.py

📝 Utilité: Supprime toutes les données de test/démo (users, BOOMs, transactions)

🚀 Commande:
   cd backend
   python clean_demo_data.py

⚠️ ATTENTION: Irréversible - fait DELETE de toutes les tables!

📋 Le script supprime:
   • Utilisateurs de test
   • BOOMs de catalogue
   • Transactions
   • Wallets
   • Gifts
   • Listings marketplace

✅ Cas d'usage:
   - Avant production (nettoyer test data)
   - Reset BD après développement
   - Tests d'intégration complets

❌ Ne pas utiliser en production active!
```

#### 5. **fix_enum_migration.py** - Corriger énums DB
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\fix_enum_migration.py

📝 Utilité: Corrige les énumérations PostgreSQL après changements de schema

🚀 Commande:
   cd backend
   python fix_enum_migration.py

✅ Correctionsfaites:
   • Ajoute nouvelles valeurs énums
   • Migre anciennes valeurs
   • Valide la intégrité

⚠️ À lancer après:
   - Modification des enums (UserStatus, BoomRarity, etc.)
   - Déploiement avec breaking changes énums
```

#### 6. **check_userstatus_enum.py** - Vérifier énums utilisateur
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\scripts\check_userstatus_enum.py

📝 Utilité: Vérifie que l'enum UserStatus est correctement défini en BD

🚀 Commande:
   cd backend
   python -m scripts.check_userstatus_enum

✅ Output:
   ✅ UserStatus enum trouvé en BD
   ✅ Valeurs: active, inactive, suspended, banned
   ✅ Tous les users ont valid status

❌ Si erreur:
   ❌ Enum manquant ou invalide
   Conseil: Lancer fix_enum_migration.py
```

#### 7. **Alembic Migrations** - Database versioning
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\alembic\

📝 Utilité: Versioning du schema PostgreSQL

🚀 Commandes principales:

   # Créer nouvelle migration
   cd backend
   alembic revision --autogenerate -m "Add new field to users"
   
   # Appliquer migrations en attente
   alembic upgrade head
   
   # Voir l'historique
   alembic current
   alembic history
   
   # Rollback à version précédente
   alembic downgrade -1

📝 Workflow:
   1. Modifier model: backend/app/models/user.py (ajout champ)
   2. Générer migration: alembic revision --autogenerate
   3. Vérifier fichier: backend/alembic/versions/xxxx_*.py
   4. Appliquer: alembic upgrade head
   5. Tester API
```

#### 8. **pytest** - Tests unitaires/intégration
```bash
📍 Chemin: C:\Users\melly\BOOMS\backend\tests\

📝 Utilité: Tests automatisés (unitaires, intégration)

🚀 Commandes:

   cd backend
   
   # Tous les tests
   pytest
   
   # Tests spécifiques (auth)
   pytest tests/test_auth.py
   
   # Avec verbose
   pytest -v
   
   # Avec couverture (coverage)
   pytest --cov=app
   
   # Tests rapides seulement (skip slow)
   pytest -m "not slow"

✅ Cas de tests courants:
   • Authentication: login, register, token expiry
   • Market: purchase, transfer, listing
   • Wallet: balance, deposit, withdrawal
   • Gifts: send, accept, validation
   • WebSocket: connection, broadcast

💡 À écrire avant:
   - Commit → push
   - Code métier critique
   - Avant production
```

---

### Admin-Web Scripts

#### 1. **npm run dev** - Serveur développement
```bash
📍 Chemin: C:\Users\melly\BOOMS\admin-web\

📝 Utilité: Lance Next.js en mode développement (hot reload)

🚀 Commande:
   cd admin-web
   npm run dev

🌐 Accès:
   • Local: http://localhost:3000
   • Network: http://192.168.1.7:3000

✨ Fonctionnalités:
   • Hot reload (F5 auto si code change)
   • Source maps pour debugging
   • TypeScript errors en temps réel
   • Pages dynamiques auto-routing

📊 Port: 3000
```

#### 2. **npm run build** - Build production
```bash
📍 Chemin: C:\Users\melly\BOOMS\admin-web\

📝 Utilité: Compile pour production (optimisé, minifié)

🚀 Commande:
   cd admin-web
   npm run build

⏱️ Temps: 1-2 min généralement

✅ Output:
   ✅ ./next (artifacts compilés)
   ✅ ./public (assets statiques)
   ✅ ~2MB bundle final

⚠️ À faire:
   - Avant commit si changement pages
   - Vérifier aucune erreur TypeScript
   - Valider liens externes

🚀 Lancer le build:
   npm run start  # Lance le bundle compilé
```

#### 3. **npm run lint** - Linting TypeScript
```bash
📍 Chemin: C:\Users\melly\BOOMS\admin-web\

📝 Utilité: Analyse code TypeScript pour erreurs/warnings

🚀 Commande:
   cd admin-web
   npm run lint

✅ Vérifie:
   • TypeScript errors
   • Unused imports
   • Code style
   • ESLint rules

❌ Si erreurs:
   npm run lint -- --fix  # Auto-fix

💡 Lancer avant chaque commit
```

#### 4. **npm install / npm ci** - Dépendances
```bash
📍 Chemin: C:\Users\melly\BOOMS\admin-web\

📝 Utilité: Installe/met à jour dépendances Node

🚀 Commandes:
   
   # Installation complète
   npm install
   
   # Installation CI (locked versions)
   npm ci
   
   # Ajouter dépendance
   npm install axios@latest
   
   # Mise à jour
   npm update

📦 Localisation: node_modules/ (créé)

⚠️ Ne pas commiter node_modules/!
```

---

### Frontend Scripts

#### 1. **npm start** - Serveur Expo développement
```bash
📍 Chemin: C:\Users\melly\BOOMS\frontend\

📝 Utilité: Lance Expo CLI pour développement mobile

🚀 Commande:
   cd frontend
   npm start

🎯 Options (prompt):
   i → iOS Simulator
   a → Android Emulator
   w → Web preview
   j → Debugger
   q → Quitter

📱 Port: 19000 (Expo Metro bundler)

🔗 QR Code:
   Scanner avec Expo Go app (iOS/Android)
   Ou: exp://192.168.1.7:19000

✨ Features:
   • Hot reload au save
   • Error overlay
   • Debugger Network/Console
```

#### 2. **npx expo build** - Build mobile
```bash
📍 Chemin: C:\Users\melly\BOOMS\frontend\

📝 Utilité: Build APK (Android) ou IPA (iOS) pour store/distribution

🚀 Commande:
   cd frontend
   npx expo build:android    # APK
   npx expo build:ios        # IPA

⏱️ Temps: 5-15 min

📦 Output:
   • APK: app-release.apk (Android)
   • IPA: app.ipa (iOS - nécessite Mac)

⚠️ Prérequis:
   - Compte Expo gratuit
   - app.json bien configuré
   - Certificats signage

🚀 Déployer:
   - Google Play Store (APK)
   - Apple App Store (IPA)
```

#### 3. **npm run lint** - Linting TypeScript
```bash
📍 Chemin: C:\Users\melly\BOOMS\frontend\

📝 Utilité: Analyse code pour errors/style

🚀 Commande:
   cd frontend
   npm run lint

✅ Vérifie:
   • TypeScript errors
   • Unused variables
   • React Hook rules
   • Naming conventions

❌ Auto-fix:
   npm run lint -- --fix
```

#### 4. **npm install** - Dépendances
```bash
📍 Chemin: C:\Users\melly\BOOMS\frontend\

🚀 Commande:
   cd frontend
   npm install

📦 Installe:
   • React Native
   • Expo
   • Navigation
   • Axios
   • ... (50+ packages)

⚠️ Peut prendre 2-3 min
```

---

### Orchestration (Windows)

#### **booms-launcher.bat** - Quick start
```bash
📍 Chemin: C:\Users\melly\BOOMS\booms-launcher.bat

📝 Utilité: Raccourci pour démarrer backend + admin-web

🚀 Double-clic ou:
   .\booms-launcher.bat

🎯 Lance:
   ✅ Terminal 1: Backend (Port 8000)
   ✅ Terminal 2: Admin-Web (Port 3000)
   ✅ (Optional) Terminal 3: Frontend (Port 19000)

⚡ Pour développement rapide
```

#### **booms-manager.bat** - Services manager
```bash
📍 Chemin: C:\Users\melly\BOOMS\booms-manager.bat

📝 Utilité: Menu pour gérer services (start/stop/restart/logs)

🚀 Double-clic ou:
   .\booms-manager.bat

📋 Menu options:
   1. Start all services
   2. Stop all services
   3. Restart backend
   4. View logs
   5. Health check
   6. Exit

🔧 Menu interactif
```

---

## Configuration & Environnement

### Architecture de configuration

Chaque module lit ses variables depuis un fichier `.env` spécifique:

```
┌─────────────────────────────────────────────────────────┐
│  BACKEND (.env)                                         │
├─────────────────────────────────────────────────────────┤
│  • BASE_URL=http://192.168.1.7:8000                    │
│  • DATABASE_URL=postgresql://...                       │
│  • STRIPE_SECRET_KEY=sk_test_*                         │
│  • WAVE_API_KEY=dev_*                                  │
│  • CORS_ORIGINS=[...]                                  │
│  Lues au DÉMARRAGE du processus Python               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  ADMIN-WEB (.env.local)                                │
├─────────────────────────────────────────────────────────┤
│  • NEXT_PUBLIC_API_BASE_URL=http://192.168.1.7:8000    │
│  • NEXT_PUBLIC_API_WS_URL=ws://192.168.1.7:8000/ws     │
│  Lues au BUILD de Next.js                             │
│  Embedding dans le bundle JavaScript                  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  FRONTEND (.env.local)                                 │
├─────────────────────────────────────────────────────────┤
│  • EXPO_PUBLIC_API_BASE_URL=http://192.168.1.7:8000    │
│  Lues au RUNTIME par Expo                             │
│  Accessible via process.env.EXPO_PUBLIC_*             │
└─────────────────────────────────────────────────────────┘

    ↓ Toutes les URLs lues depuis .env ↓
    (Une seule source de vérité)
    
┌─────────────────────────────────────────────────────────┐
│  BACKEND (Port 8000)                                    │
│  http://192.168.1.7:8000                               │
│  ws://192.168.1.7:8000/ws                              │
└─────────────────────────────────────────────────────────┘
```

### Fichiers .env

**Chaque module a 2 fichiers .env:**

1. **.env** (ou **.env.local** pour frontend)
   - Fichier RÉEL avec vraies valeurs
   - ❌ JAMAIS commité (dans .gitignore)
   - ✅ Local development uniquement

2. **.env.example**
   - Template avec valeurs PLACEHOLDER
   - ✅ Commité en git
   - Autres devs copient: `cp .env.example .env` et remplissent

**Pour démarrer le projet:**

```bash
# Backend
cd backend
cp .env.example .env
# Éditer .env avec vraies valeurs
source env/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

# Admin-Web
cd admin-web
cp .env.example .env.local
# Éditer .env.local
npm run dev

# Frontend
cd frontend
cp .env.example .env.local
# Éditer .env.local
npx expo start
```

---

## Démarrage

### Commandes de démarrage rapide

**Terminal 1 - Backend (Port 8000)**
```bash
cd C:\Users\melly\BOOMS\backend
env\Scripts\activate
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 - Admin Web (Port 3000)**
```bash
cd C:\Users\melly\BOOMS\admin-web
npm run dev
```

**Terminal 3 - Frontend Mobile (Port 19000)**
```bash
cd C:\Users\melly\BOOMS\frontend
npm start
```

**Accès:**
- 🖥️ Admin Web: `http://192.168.1.7:3000`
- 📱 Frontend: `http://192.168.1.7:19000` (QR code)
- 🔧 API Swagger: `http://192.168.1.7:8000/docs`

---

## Structure des fichiers (Vue complète)

```
BOOMS/
├─ backend/               # API FastAPI + services métiers
│  ├─ app/               # Code applicatif
│  │  ├─ main.py         # Point d'entrée FastAPI
│  │  ├─ config.py       # Configuration depuis .env
│  │  ├─ models/         # ORM SQLAlchemy (24+ tables)
│  │  ├─ routes/         # Endpoints RESTAPI
│  │  ├─ services/       # Logique métier
│  │  ├─ middleware/     # JWT, CORS, security
│  │  ├─ websockets/     # Manager WebSocket
│  │  └─ migrations/     # Scripts migration DB
│  ├─ .env               # Config réelle (sécurisée)
│  ├─ .env.example       # Template (commité)
│  ├─ requirements.txt   # Dépendances Python
│  └─ env/               # Virtual environment
│
├─ admin-web/            # Admin Next.js
│  ├─ src/
│  │  ├─ pages/          # Pages Next.js (/booms, /users, etc.)
│  │  ├─ components/     # Composants réutilisables
│  │  ├─ services/       # API client (axios)
│  │  ├─ hooks/          # Hooks custom
│  │  └─ styles/         # TailwindCSS
│  ├─ .env.local         # Config réelle (sécurisée)
│  ├─ .env.example       # Template (commité)
│  ├─ next.config.js
│  ├─ tsconfig.json
│  ├─ package.json
│  └─ node_modules/
│
├─ frontend/             # App mobile React Native/Expo
│  ├─ src/
│  │  ├─ screens/        # Pages (Catalogue, Wallet, etc.)
│  │  ├─ services/       # API client (axios), WebSocket
│  │  ├─ contexts/       # State management
│  │  ├─ hooks/          # Hooks custom
│  │  ├─ navigation/     # React Navigation
│  │  ├─ components/     # Composants réutilisables
│  │  └─ types/          # TypeScript types
│  ├─ .env.local         # Config réelle (sécurisée)
│  ├─ .env.example       # Template (commité)
│  ├─ app.config.js      # Expo config
│  ├─ App.tsx            # Root component
│  ├─ tsconfig.json
│  ├─ package.json
│  └─ node_modules/
│
├─ env/                  # Virtual environment Python (optionnel)
├─ booms-launcher.bat    # Raccourci démarrage Windows
├─ booms-manager.bat     # Manager services Windows
├─ LICENSE
├─ README.md             # Cette documentation
└─ logs/                 # Journaux application
```

---

## Communication inter-services

### 1. Frontend → Backend

```
Frontend (Client)
    ↓ HTTP REST
    └─ GET /api/v1/booms?search=art
       GET /api/v1/wallet
       POST /api/v1/market/purchase { boom_id, quantity }
       ↑ Avec JWT:
         Headers: { Authorization: "Bearer <token>" }

Backend
    ├─ Middleware Security: Valide JWT
    ├─ Route Handler: Exécute la logique
    └─ Services: Appel métier
       └─ Database: SQL via SQLAlchemy
           ↓ Retour JSON
       
Frontend: Met à jour UI
```

### 2. WebSocket (Temps réel)

```
Frontend
    ↓ ws://192.168.1.7:8000/ws?token=<JWT>
    
Backend
    ├─ Accepte connexion
    ├─ Enregistre client
    └─ À chaque changement:
       ├─ Calcule les deltas
       └─ Broadcast à tous
          {
            "type": "price_update",
            "data": { "boom_id": 123, "price": 1500 }
          }

Frontend
    └─ Reçoit via WebSocket
       └─ Met à jour state
```

---

## Sécurité

### 🔒 Points clés

**1. Authentification JWT**
- Endpoint: `POST /api/v1/auth/login` → `access_token`
- Header: `Authorization: Bearer <token>`
- Validation: Middleware `security.py` sur chaque requête

**2. Secrets & API Keys**
- ❌ JAMAIS hardcodés
- ✅ Toujours dans `.env` (protégé par `.gitignore`)
- ✅ Lus au runtime depuis variables d'environnement

**3. CORS & WebSocket Origins**
- Backend: `CORS_ORIGINS=["http://192.168.1.7:3000", "http://192.168.1.7:19000"]`
- Seulement ces origines peuvent faire des requêtes

**4. Données sensibles**
- Passwords: hachés (bcrypt)
- Tokens: JWT valides 24h
- API Keys (Stripe, Wave): masquées dans logs

---

## Déploiement

### Pre-déploiement (Checklist)

Avant production, vérifier:

✅ **Backend**
```bash
cd backend
python validate_config.py      # Doit succéder
python check_secrets.py         # Doit retourner 0 violations
```

✅ **Secrets**
- ENVIRONMENT=production (backend/.env)
- DEBUG=False
- Nouvelles clés Stripe LIVE (pk_live_, sk_live_)
- Vraies clés Wave, Orange Money, MTN MoMo

✅ **Database**
```bash
# Backup
pg_dump booms_db > backup.sql
# Migrations
cd backend
alembic upgrade head
```

✅ **HTTPS & Certificats**
- SSL certificates (Let's Encrypt)
- NGINX reverse proxy
- Redirection HTTP → HTTPS

### Architecture production

```
Internet (HTTPS)
    ↓
NGINX Reverse Proxy
    ├─ Load Balancing
    ├─ SSL Termination
    ├─ Cache static
    └─ Route /api/* → FastAPI
       Route / → Next.js
       Route /ws → WebSocket
    ↓
┌─────────────────┐  ┌──────────────┐
│ FastAPI (8000)  │  │ Next.js      │
│ (instances)     │  │ (via Node)   │
└────────┬────────┘  └────────┬─────┘
         └──────────┬─────────┘
                    ↓
            PostgreSQL (prod)
```

---

## Troubleshooting

### ❌ "Cannot GET /api/v1/booms"

**Cause**: Frontend ne peut pas atteindre backend

**Solution**:
```bash
# Vérifier backend tourne
curl http://192.168.1.7:8000/docs

# Vérifier .env.local
cat admin-web/.env.local | grep API_BASE_URL
cat frontend/.env.local | grep API_BASE_URL

# Vérifier port 8000 écoute
netstat -an | findstr 8000
```

### ❌ "WebSocket connection failed"

**Cause**: WebSocket pas accessible

**Solution**:
```bash
# Vérifier backend accepte WebSocket
curl -i -N -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  http://192.168.1.7:8000/ws

# Vérifier firewall autorise port 8000
# Vérifier JWT token est inclus
```

### ❌ "Database connection refused"

**Cause**: PostgreSQL pas accessible

**Solution**:
```bash
# Vérifier PostgreSQL tourne
psql -U postgres -c "SELECT 1"

# Vérifier DATABASE_URL
cat backend/.env | grep DATABASE_URL

# Tester connexion
psql postgresql://user:pass@localhost:5433/booms_db
```

---

## Bonnes pratiques

✅ **Code**
- Services: Séparer logique métier des routes
- Models: Utiliser SQLAlchemy ORM
- Validation: Pydantic schemas pour input/output
- Erreurs: Utiliser les exceptions prédéfinies

✅ **Tests**
- Tester flux critiques (achat, vente, transfert, retrait)
- Backend: `pytest`
- Frontend: Tests composants React

✅ **Git & Commits**
- `.env` et `.env.local` dans `.gitignore`
- Commiter `.env.example` et `.env.example`
- Commits atomiques avec messages clairs
- Brancher pour features (`feature/xxx`)

✅ **Performance**
- WebSocket pour updates temps réel (pas polling)
- Transactions DB pour atomicité
- Caching des données statiques
- Rate limiting sur endpoints sensibles

✅ **Monitoring**
- Logs métier (`logs/treasury_movements.csv`)
- Erreurs critiques (wallet, transactions)
- Alertes sur changes d'état importants

---

## Contact & Support

- **Questions**: Consulter ce README
- **Bugs**: Issues GitHub avec logs + reproduction
- **Contributions**: PR bienvenues, respecter la structure
- **Sécurité**: Issues privées (security@booms.local)

---

**Dernière mise à jour**: Février 2026  
**Version**: 1.0 - Production Ready  
**Mainteneurs**: BOOMS Development Team