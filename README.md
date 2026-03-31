# Telko — Assistant documentaire interne

Plateforme d'assistance IA pour les employés d'une société de télécom.
Interrogation en langage naturel de la base documentaire interne via streaming SSE.

---

## État actuel de l'architecture

### Route de chat active (`POST /chat`)

```
Frontend (React)
    │
    ▼  POST /chat  (SSE)
Backend FastAPI
    │
    ├─ Supabase REST  ──► table knowledge_documents  (contexte documentaire)
    │
    └─ OpenAI API  ──────► gpt-4o-mini  (génération, streaming)
```

### Pipeline RAG en cours de construction (`core/`)

```
core/
  llm/              ← abstraction LLM provider-agnostique (httpx, Ollama)
  rag_pipeline.py   ← RAGPipeline : Qdrant + Ollama  [non branché sur /chat]
  embeddings.py     ← LocalEmbeddings (nomic-embed-text via Ollama)
  vector_store.py   ← QdrantStore
```

> Le pipeline RAG (Ollama + Qdrant) est fonctionnel mais pas encore connecté à la
> route `/chat`. La route active utilise OpenAI + Supabase.

---

## Prérequis

| Outil | Version |
|---|---|
| Node.js | 18+ |
| Python | 3.11+ |
| Docker + Docker Compose | pour Qdrant (RAG) |
| Ollama | pour le pipeline RAG local |

---

## Variables d'environnement

Fichier `.env` à la racine du dépôt (chargé automatiquement par le backend).

### Obligatoires (route `/chat` active)

```env
OPENAI_API_KEY=sk-...

SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
```

### Optionnelles (pipeline RAG / ingestion)

```env
# Ollama (valeurs par défaut)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_LLM_MODEL=mistral
OLLAMA_EMBED_MODEL=nomic-embed-text

# Qdrant (valeurs par défaut)
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION_NAME=telko_knowledge

# Azure AD + SharePoint
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
SHAREPOINT_SITE_ID=
SHAREPOINT_DRIVE_ID=
```

### CORS

```env
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080
```

---

## Démarrage

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate      # Windows : .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

API disponible sur **http://localhost:8000**.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Application sur **http://localhost:8080**.
Les appels API sont proxifiés vers `http://localhost:8000` via `vite.config.ts`
tant que `VITE_API_URL` n'est pas défini.

### Qdrant (pipeline RAG uniquement)

```bash
docker compose up qdrant -d
```

---

## Déploiement Docker (backend + Qdrant)

```bash
docker compose up --build -d
```

Le backend écoute sur le port **8000**, Qdrant sur **6333**.
Ollama doit tourner sur la machine hôte — accessible depuis Docker via `host.docker.internal`.

---

## Structure du dépôt

```
telko/
├── backend/
│   ├── api/
│   │   └── routes/
│   │       ├── chat.py          # POST /chat — streaming SSE (OpenAI + Supabase)
│   │       ├── embed.py         # POST /embed — ingestion de documents
│   │       ├── documents.py     # Gestion des fichiers
│   │       ├── admin_user.py    # Administration utilisateurs
│   │       └── health.py        # GET /health
│   ├── auth/
│   │   └── azure_ad.py          # Validation tokens Azure AD
│   ├── core/
│   │   ├── llm/                 # Abstraction LLM (OllamaProvider, BaseLLMProvider)
│   │   │   ├── base.py
│   │   │   ├── ollama.py
│   │   │   ├── factory.py
│   │   │   └── __init__.py
│   │   ├── embeddings.py        # LocalEmbeddings (OllamaEmbeddings)
│   │   ├── rag_pipeline.py      # RAGPipeline — Qdrant + Ollama
│   │   ├── vector_store.py      # QdrantStore
│   │   └── llm_legacy.py        # DEPRECATED — ancienne implémentation LangChain
│   ├── ingestion/
│   │   ├── file_parser.py       # PDF, Word, PPTX, OCR (pytesseract)
│   │   ├── sharepoint.py        # Microsoft Graph API
│   │   └── sync_scheduler.py    # APScheduler
│   ├── scripts/
│   │   └── test_llm.py          # Test rapide generate() / stream()
│   ├── config.py                # Settings (pydantic-settings)
│   ├── main.py                  # Point d'entrée FastAPI
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/                    # App React (Vite + shadcn-ui + Tailwind CSS)
├── docker-compose.yml           # Qdrant + backend
├── RUN.md                       # Mémo démarrage rapide
└── README.md
```

---

## Tester la couche LLM (Ollama)

S'assurer qu'Ollama tourne (`ollama serve`) avec le modèle configuré.

```bash
cd backend
source .venv/bin/activate
python -m backend.scripts.test_llm
```

---

## Stack technique

| Couche | Technologie |
|---|---|
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn-ui |
| Backend | FastAPI, Python 3.11, uvicorn |
| LLM actif | OpenAI GPT-4o-mini (via `OPENAI_API_KEY`) |
| LLM RAG (en cours) | Ollama — abstraction httpx native, sans LangChain LLM |
| Base documentaire active | Supabase (`knowledge_documents`) |
| Vector store RAG | Qdrant |
| Embeddings | Ollama nomic-embed-text (via langchain-ollama) |
| Auth | Azure AD |
| Ingestion fichiers | PyMuPDF, python-docx, python-pptx, pytesseract |
| Sync documents | Microsoft Graph API + APScheduler |
| Conteneurisation | Docker, Docker Compose |
