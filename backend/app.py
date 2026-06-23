"""
KBot API v2

POST /chat
  - Omit session_id on first message — a new session is created automatically
  - Pass session_id in subsequent messages to continue the conversation
  - Session ID is returned in the X-Session-Id response header
  - Tokens stream in real time as text/plain

GET  /health
GET  /sessions                      — list all sessions (admin)
GET  /sessions/{id}/history         — full message history for a session
DELETE /sessions/{id}               — delete a session and its history

Sessions and chat history are persisted in SQLite (DB_PATH env var).
CORS: set ALLOWED_ORIGINS=https://yoursite.com  (defaults to *)
"""

import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from llama_index.core import StorageContext, load_index_from_storage
from llama_index.core.llms import ChatMessage
from llama_index.core.memory import ChatMemoryBuffer
from pydantic import BaseModel, Field

load_dotenv()
os.environ["OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY")

# ── Config ────────────────────────────────────────────────────────────────────

PERSIST_DIR = os.getenv("PERSIST_DIR", "KBot Storage")
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",")]
MEMORY_TOKEN_LIMIT = int(os.getenv("MEMORY_TOKEN_LIMIT", "1500"))
DB_PATH = os.getenv("DB_PATH", "kbot_sessions.db")

# ── Global state ──────────────────────────────────────────────────────────────

_index = None

# ── Database ──────────────────────────────────────────────────────────────────


def _db():
    return sqlite3.connect(DB_PATH)


def _init_db():
    with _db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL REFERENCES sessions(id),
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)


def _session_exists(session_id: str) -> bool:
    with _db() as db:
        return db.execute("SELECT 1 FROM sessions WHERE id = ?", (session_id,)).fetchone() is not None


def _create_session(session_id: str):
    with _db() as db:
        db.execute("INSERT INTO sessions (id) VALUES (?)", (session_id,))


def _load_history(session_id: str) -> list[ChatMessage]:
    with _db() as db:
        rows = db.execute(
            "SELECT role, content FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [ChatMessage(role=role, content=content) for role, content in rows]


def _save_exchange(session_id: str, user_msg: str, assistant_msg: str):
    with _db() as db:
        db.executemany(
            "INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)",
            [(session_id, "user", user_msg), (session_id, "assistant", assistant_msg)],
        )


# ── Chat engine ───────────────────────────────────────────────────────────────


def _make_engine(chat_history: list[ChatMessage]):
    return _index.as_chat_engine(
        chat_mode="condense_plus_context",
        memory=ChatMemoryBuffer.from_defaults(
            chat_history=chat_history,
            token_limit=MEMORY_TOKEN_LIMIT,
        ),
        verbose=False,
    )


# ── Lifespan ──────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _index
    _init_db()
    storage_context = StorageContext.from_defaults(persist_dir=PERSIST_DIR)
    _index = load_index_from_storage(storage_context)
    yield
    _index = None


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="KBot API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Session-Id"],
)

# ── Models ────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    session_id: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────


@app.post("/sessions/new", status_code=status.HTTP_201_CREATED)
def new_session():
    """Call once when a user opens the chat. Returns a session_id to use in all subsequent /chat requests."""
    session_id = str(uuid.uuid4())
    _create_session(session_id)
    return {"session_id": session_id}


@app.get("/health")
def health():
    with _db() as db:
        total = db.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    return {"status": "ok", "index_loaded": _index is not None, "total_sessions": total}


@app.post("/chat")
def chat(body: ChatRequest):
    session_id = body.session_id

    if session_id:
        if not _session_exists(session_id):
            raise HTTPException(status_code=404, detail="Session not found.")
        chat_history = _load_history(session_id)
    else:
        session_id = str(uuid.uuid4())
        _create_session(session_id)
        chat_history = []

    engine = _make_engine(chat_history)
    streaming_response = engine.stream_chat(body.query)

    def token_generator():
        tokens = []
        for token in streaming_response.response_gen:
            tokens.append(token)
            yield token
        _save_exchange(session_id, body.query, "".join(tokens))

    return StreamingResponse(
        token_generator(),
        media_type="text/plain",
        headers={"X-Session-Id": session_id},
    )


@app.get("/sessions")
def list_sessions():
    with _db() as db:
        rows = db.execute(
            "SELECT id, created_at FROM sessions ORDER BY created_at DESC"
        ).fetchall()
    return [{"session_id": r[0], "created_at": r[1]} for r in rows]


@app.get("/sessions/{session_id}/history")
def session_history(session_id: str):
    if not _session_exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")
    with _db() as db:
        rows = db.execute(
            "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY id",
            (session_id,),
        ).fetchall()
    return [{"role": r[0], "content": r[1], "created_at": r[2]} for r in rows]


@app.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(session_id: str):
    with _db() as db:
        db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
        db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
