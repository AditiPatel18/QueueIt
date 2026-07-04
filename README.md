# 🚀 QueueIt

> AI-powered Read Later & Knowledge Management Platform.

QueueIt is a full-stack productivity application that lets users save articles, YouTube videos, PDFs and webpages into a personal knowledge queue. It automatically extracts content, generates AI summaries, estimates reading time, organizes content into collections, performs semantic search using embeddings, and recommends what to consume next.

---

## ✨ Features

- 🤖 AI-powered short & detailed summaries (Google Gemini)
- 📚 Save YouTube, Articles, PDFs & Webpages
- 🏷 Smart AI tagging & collections
- 🔍 Semantic Search (Vector Embeddings)
- ⏱ Accurate reading/watch time estimation
- 📈 Reading history & analytics
- 🎯 AI recommendation engine
- 💬 AI Chat over saved knowledge
- 🔐 Secure authentication (Supabase Auth)
- 🌙 Modern responsive UI
- ⚡ Background ingestion pipeline
- 🔄 Automatic recovery of interrupted jobs

---

## 🏗 Architecture

```
Next.js + React
        │
 FastAPI Backend
        │
 ├── Gemini AI
 ├── Supabase
 ├── Vector Embeddings
 └── Background Workers
```

---

## 🛠 Tech Stack

### Frontend

- Next.js 15
- React
- TypeScript
- TailwindCSS
- SWR

### Backend

- FastAPI
- Python
- AsyncIO
- Pydantic

### Database

- Supabase PostgreSQL

### AI

- Google Gemini
- Vector Embeddings
- Semantic Search

---

## 📸 Screenshots

| Dashboard | AI Summary |
|-----------|------------|
| Add screenshot | Add screenshot |

| History | AI Chat |
|----------|---------|
| Add screenshot | Add screenshot |

---

## ⚙️ Installation

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

---

## Environment Variables

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
GEMINI_API_KEY=
FRONTEND_URL=http://localhost:3000
```

---

## Folder Structure

```
frontend/
backend/
migrations/
database/
```

---

## Highlights

- AI-driven knowledge management
- Background ingestion architecture
- Vector search implementation
- Modular FastAPI services
- Production-ready API design
- Responsive modern UI

---

## Roadmap

- Mobile App
- Browser Extension Improvements
- Flashcards
- AI Quiz Generation
- Offline Mode
- Multi-language Summaries

---

## License

MIT License

---

### Developed by

**Aditi**
