# 🚀 QueueIt

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" />
  <img src="https://img.shields.io/badge/FastAPI-0.115-green?logo=fastapi" />
  <img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase" />
  <img src="https://img.shields.io/badge/Google-Gemini_AI-blue?logo=google" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" />
</p>

<p align="center">
<b>AI-Powered Knowledge Management Platform</b><br>
Save • Organize • Summarize • Learn
</p>

---

# 📖 Overview

QueueIt is an AI-powered knowledge management platform that transforms bookmarks into an intelligent learning system.

Instead of saving hundreds of links that are never revisited, QueueIt automatically extracts content from articles, YouTube videos, PDFs, GitHub repositories and web pages, generates AI-powered summaries, estimates reading time, organizes content into collections, and recommends what to learn next.

The goal is to help users consume knowledge efficiently rather than merely collecting links.

---

# ✨ Highlights

- 🤖 AI-generated short & detailed summaries
- 🎥 YouTube transcript extraction
- 📄 PDF & webpage content extraction
- 🧠 Semantic search using vector embeddings
- 💬 AI Chat with saved knowledge
- 📚 Collections & folders
- 🏷 Automatic AI tagging
- ⏱ Reading time estimation
- 📊 Reading analytics dashboard
- 📈 Progress tracking
- 🎯 AI recommendation engine
- 🌐 Chrome Extension support

---

# 🚀 Features

## Content Ingestion

- Save Articles
- Save YouTube Videos
- Save GitHub Repositories
- Save PDFs
- Save Blogs
- Browser Extension
- Automatic Metadata Extraction

---

## AI Features

- AI Short Summary
- AI Detailed Summary
- Smart Tag Generation
- Automatic Categorization
- Priority Scoring
- AI Recommendations
- Reading Time Estimation
- Semantic Embeddings
- AI Chat over Saved Knowledge

---

## Knowledge Management

- Collections
- Folder Organization
- Favorites
- Read Later
- Search
- Filters
- Progress Tracking
- Reading History

---

## Dashboard

- Queue Statistics
- Estimated Reading Time
- Reading Progress
- AI Recommended Next Item
- Analytics
- Category Distribution

---

# 🏗 System Architecture

```text
                 Chrome Extension
                        │
                        ▼
                Next.js Frontend
                        │
                   REST API
                        │
                        ▼
                 FastAPI Backend
                        │
 ┌─────────────────────────────────────────┐
 │          Content Processing             │
 │                                         │
 │  • Web Extractor                        │
 │  • YouTube Extractor                    │
 │  • PDF Extractor                        │
 │  • GitHub Extractor                     │
 └─────────────────────────────────────────┘
                        │
                        ▼
               Google Gemini AI
          ├── Short Summary
          ├── Detailed Summary
          ├── Smart Tags
          ├── Priority Score
          └── Recommendations
                        │
                        ▼
              Vector Embeddings
                        │
                        ▼
             Supabase PostgreSQL
                        │
                        ▼
                  User Dashboard
```

---

# 🤖 AI Pipeline

```text
User Saves URL
      │
      ▼
Extract Content
      │
      ▼
Clean & Process Text
      │
      ▼
Generate Embeddings
      │
      ▼
Gemini AI
 ├── Summary
 ├── Detailed Summary
 ├── Tags
 ├── Category
 ├── Recommendation
 └── Priority
      │
      ▼
Store in Supabase
      │
      ▼
Display on Dashboard
```

---

# 🛠 Tech Stack

## Frontend

- Next.js 15
- React
- TypeScript
- Tailwind CSS
- SWR
- Framer Motion

## Backend

- FastAPI
- Python
- Pydantic
- AsyncIO

## Database

- Supabase PostgreSQL

## AI

- Google Gemini API
- Vector Embeddings

## Authentication

- Supabase Auth

---

# 📂 Project Structure

```text
QueueIt
│
├── frontend
│   ├── app
│   ├── components
│   ├── hooks
│   ├── lib
│   └── types
│
├── backend
│   ├── api
│   ├── services
│   ├── models
│   ├── schemas
│   ├── utils
│   └── static
│
├── extension
│
├── migrations
│
└── README.md
```

---

# ⚡ Performance Optimizations

- Asynchronous FastAPI backend
- Background AI processing
- Vector embedding search
- SWR client-side caching
- Lazy loading
- Incremental AI generation
- Optimized database queries

---

# 🚀 Local Setup

## Clone Repository

```bash
git clone https://github.com/AditiPatel18/QueueIt.git

cd QueueIt
```

---

## Backend

```bash
cd backend

python -m venv venv

venv\Scripts\activate

pip install -r requirements.txt

uvicorn main:app --reload
```

---

## Frontend

```bash
cd frontend

npm install

npm run dev
```

---

# 🔑 Environment Variables

Backend

```env
SUPABASE_URL=

SUPABASE_ANON_KEY=

SUPABASE_SERVICE_ROLE_KEY=

SUPABASE_JWT_SECRET=

GEMINI_API_KEY=
```

Frontend

```env
NEXT_PUBLIC_SUPABASE_URL=

NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

# 📊 Current Capabilities

- ✅ Authentication
- ✅ Browser Extension
- ✅ AI Summaries
- ✅ Detailed AI Summaries
- ✅ Automatic Tagging
- ✅ Smart Categorization
- ✅ Reading Time Estimation
- ✅ AI Recommendations
- ✅ Collections
- ✅ Reading History
- ✅ Progress Tracking
- ✅ Analytics Dashboard
- ✅ Semantic Search
- ✅ AI Chat

---

# 🎯 Skills Demonstrated

- Full Stack Development
- REST API Design
- Authentication & Authorization
- AI Integration
- Prompt Engineering
- Background Processing
- Database Design
- Vector Search
- React
- Next.js
- FastAPI
- TypeScript
- Python
- PostgreSQL
- Supabase

---

# 🔮 Future Roadmap

- Mobile Application
- OCR Support
- AI Flashcards
- AI Quiz Generation
- Offline Reading
- Team Collaboration
- Calendar Integration
- Notion Import
- Firefox Extension
- Chrome Web Store Release

---

# 📷 Screenshots

Add screenshots for:

- Login Page
- Dashboard
- Queue
- AI Summary
- History
- Analytics
- Chat
- Browser Extension

---

# 👨‍💻 Author

**Aditi Patel**

B.Tech Information Technology

Interested in AI, Full Stack Development, Backend Engineering and Intelligent Knowledge Systems.

GitHub: https://github.com/AditiPatel18

---

# ⭐ Support

If you found this project useful,

⭐ Star the repository

🍴 Fork the repository

💡 Open an issue

🤝 Contributions are welcome!

---

# 📄 License

This project is licensed under the MIT License.
