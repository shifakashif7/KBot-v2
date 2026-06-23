Setup
─────
1. python3 -m venv menv
2. source menv/bin/activate          # Linux/Mac
   .\menv\Scripts\activate           # Windows
3. pip install -r requirements.txt
4. Create a .env file:
   OPENAI_API_KEY=your_key_here

Optional .env vars:
  PERSIST_DIR=KBot Storage                            # path to persisted index
  ALLOWED_ORIGINS=https://site1.com,https://site2.com # defaults to *
  MEMORY_TOKEN_LIMIT=1500                             # ~5-7 message pairs per session

Run (dev)
─────────
uvicorn app:app --reload --port 8000
→ API:  http://localhost:8000
→ Docs: http://localhost:8000/docs

Run (prod)
──────────
gunicorn app:app -w 1 -k uvicorn.workers.UvicornWorker
# Keep -w 1 since sessions are in-memory (not shared across workers)

API
───
GET    /health
POST   /chat                  see below
DELETE /sessions/{session_id}

POST /chat — the only endpoint you need
  Request body:
    { "query": "When do admissions open?" }                 ← first message
    { "query": "What about the fees?", "session_id": "…" } ← follow-up

  Response:
    Content-Type: text/plain  (tokens stream in real time)
    Header: X-Session-Id: <uuid>   ← save this for follow-up messages

Integration example (JavaScript fetch)
───────────────────────────────────────
let sessionId = null;

async function sendMessage(query) {
  const res = await fetch("https://your-api.com/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, session_id: sessionId }),
  });

  // Save session ID from first response
  sessionId = res.headers.get("X-Session-Id");

  // Stream tokens to UI
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process.stdout.write(decoder.decode(value)); // or append to DOM
  }
}

// When user closes chat
async function endSession() {
  if (sessionId) {
    await fetch(`https://your-api.com/sessions/${sessionId}`, { method: "DELETE" });
    sessionId = null;
  }
}
