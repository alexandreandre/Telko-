import sqlite3
import time
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "feedback.db"


class FeedbackStore:
    """
    Stocke les feedbacks utilisateur dans SQLite.
    Colonnes :
      id                INTEGER PRIMARY KEY AUTOINCREMENT
      created_at        REAL (timestamp unix)
      provider          TEXT
      model             TEXT
      prompt            TEXT
      response          TEXT
      rating            INTEGER (1-10)
      response_time_ms  INTEGER
      cost_estimate_usd REAL (nullable)
      conversation_id   TEXT
      user_id           TEXT
    """

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS feedbacks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    created_at REAL NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    response TEXT NOT NULL,
                    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 10),
                    response_time_ms INTEGER,
                    cost_estimate_usd REAL,
                    conversation_id TEXT,
                    user_id TEXT
                )
            """)
            conn.commit()

    def save(
        self,
        provider: str,
        model: str,
        prompt: str,
        response: str,
        rating: int,
        response_time_ms: int | None = None,
        cost_estimate_usd: float | None = None,
        conversation_id: str | None = None,
        user_id: str | None = None,
    ) -> int:
        """Sauvegarde un feedback. Retourne l'id inséré."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                """INSERT INTO feedbacks
                   (created_at, provider, model, prompt, response,
                    rating, response_time_ms, cost_estimate_usd,
                    conversation_id, user_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    time.time(), provider, model, prompt, response,
                    rating, response_time_ms, cost_estimate_usd,
                    conversation_id, user_id,
                ),
            )
            conn.commit()
            return cursor.lastrowid

    def get_all(self, limit: int = 100, offset: int = 0) -> list[dict]:
        """Retourne les feedbacks les plus récents."""
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM feedbacks ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_stats(self) -> dict:
        """
        Retourne les stats agrégées par (provider, model) :
        - count               : nombre de feedbacks
        - avg_rating          : note moyenne
        - avg_response_time_ms: temps moyen
        - total_cost_usd      : coût total estimé
        - satisfaction_rate   : % de notes >= 7
        """
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute("""
                SELECT
                    provider,
                    model,
                    COUNT(*) as count,
                    ROUND(AVG(rating), 2) as avg_rating,
                    ROUND(AVG(response_time_ms)) as avg_response_time_ms,
                    ROUND(SUM(COALESCE(cost_estimate_usd, 0)), 6) as total_cost_usd,
                    ROUND(100.0 * SUM(CASE WHEN rating >= 7 THEN 1 ELSE 0 END) / COUNT(*), 1) as satisfaction_rate
                FROM feedbacks
                GROUP BY provider, model
                ORDER BY avg_rating DESC
            """).fetchall()
            return [dict(row) for row in rows]


# Singleton
_store: FeedbackStore | None = None


def get_feedback_store() -> FeedbackStore:
    global _store
    if _store is None:
        _store = FeedbackStore()
    return _store
