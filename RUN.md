# Lancer le backend

Ouvrir un terminal :

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   
pip install -r requirements.txt
```

Si déjà fait :

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload
```

En général : 
```bash
uvicorn main:app --reload
```

# Lancer le frontend

Depuis un autre terminal :

```bash
cd frontend
npm install
npm run dev
```

L’app Vite écoute sur **http://localhost:8080**. Les appels API vers le FastAPI passent par un **proxy** vers `http://127.0.0.1:8000` tant que `VITE_API_URL` n’est pas défini (voir `frontend/vite.config.ts`). Sinon, définis `VITE_API_URL` dans le `.env` à la racine du dépôt (chargé automatiquement).
