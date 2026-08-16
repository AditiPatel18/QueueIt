<div align="center">

# 🚀 QueueIt

### AI-Powered Knowledge Management & Content Queue

**Save → Understand → Organize → Learn**

<br/>

<img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" />
<img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" />
<img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" />
<img src="https://img.shields.io/badge/Node.js-22-339933?logo=node.js" />
<img src="https://img.shields.io/badge/Express.js-5-000000?logo=express" />
<img src="https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=postgresql" />
<img src="https://img.shields.io/badge/Gemini-AI-4285F4?logo=google" />

</div>

---

## 📌 Overview

**QueueIt** is an AI-powered knowledge management platform that helps users turn saved online content into an organized and actionable learning queue.

People frequently bookmark YouTube videos, articles, PDFs, GitHub repositories, and webpages but rarely return to them. QueueIt addresses this problem by automatically processing saved content, generating AI-powered summaries and tags, organizing resources, estimating reading time, tracking progress, providing analytics, and recommending what to consume next.

Instead of simply **saving more content**, QueueIt helps users **actually consume and learn from it**.

---

## ✨ Core Features

### 📥 Intelligent Content Saving

* Save YouTube videos, articles, webpages, PDFs, and GitHub resources
* Chrome Extension for one-click content saving
* Automatic content extraction and metadata processing
* Content-type detection
* Duplicate-content prevention
* Real-time queue updates

### 🤖 AI-Powered Content Understanding

* Concise AI-generated summaries
* Detailed AI summaries based on the complete extracted content
* Automatic tags
* Smart categorization
* Priority scoring
* AI-powered next-content recommendations
* AI Chat over saved knowledge
* Semantic search using embeddings

### 📚 Knowledge Organization

* Collections and folders
* Favorites
* Search and filtering
* Reading history
* Content status management
* Restore and delete functionality

### 📖 Reading & Progress Tracking

* Estimated reading time
* Reading progress
* Unread → Reading → Completed workflow
* Reading history
* Completion statistics
* Reading streaks

### 🔔 Smart Reminders

* Schedule reminders for saved content
* Email notifications at the selected time
* Reminder history
* Duplicate notification prevention
* Direct **Read Now** links to the selected content
* **View Queue** link to the main QueueIt dashboard

### 📊 Analytics

* Total saved content
* Completed content
* Reading progress
* Time spent reading
* Completion percentage
* Reading streaks
* Content/category statistics
* Personalized activity insights

---

## 🧠 How QueueIt Works

```text
        Save Content
             │
             ▼
      Content Extraction
             │
             ▼
       AI Processing
       ┌─────┼─────┐
       ▼     ▼     ▼
    Summary Tags  Category
       │     │     │
       └─────┼─────┘
             ▼
       Store in Database
             │
             ▼
      Personal Queue
             │
      ┌──────┼──────┐
      ▼      ▼      ▼
    Search  Read  Organize
             │
             ▼
        Track Progress
             │
             ▼
          Analytics
             │
             ▼
      AI Recommendations
```

---

## 🏗️ System Architecture

```text
┌───────────────────────┐
│    Chrome Extension   │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────────────┐
│      Next.js Frontend         │
│ React + TypeScript + Tailwind │
└──────────────┬────────────────┘
               │ REST API
               ▼
┌───────────────────────────────┐
│      Node.js Backend          │
│ Express + TypeScript          │
└──────────────┬────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌──────────────┐  ┌────────────────┐
│   Supabase   │  │  Gemini AI     │
│ PostgreSQL   │  │                │
│ Auth + Data  │  │ Summaries      │
│ Embeddings   │  │ Tags           │
└──────────────┘  │ Classification │
                  │ Recommendations│
                  └────────────────┘
```

---

## 🔄 AI Processing Pipeline

When a user saves content:

```text
URL
 │
 ▼
Validate & Detect Type
 │
 ▼
Extract Actual Content
 │
 ▼
Clean & Normalize
 │
 ▼
Gemini AI
 ├── Generate Summary
 ├── Generate Tags
 ├── Categorize Content
 ├── Calculate Priority
 └── Recommend Related Content
 │
 ▼
Generate Embeddings
 │
 ▼
Store in Supabase
 │
 ▼
Display in Queue
```

QueueIt's summarization is designed to understand the **overall content**, rather than simply copying the title, metadata, description, or opening lines.

---

## 🔎 Search

QueueIt supports both traditional and semantic search.

### Keyword Search

Search across:

* Titles
* Summaries
* Tags
* Content metadata

### Semantic Search

Embeddings allow users to search by **meaning and context**, helping discover relevant content even when the exact search terms do not appear in the saved content.

---

## 🔐 Authentication & Data

QueueIt uses **Supabase Auth** for authentication.

Supported authentication:

* Email/password
* Google OAuth
* Protected routes
* User-specific queues
* User-specific analytics
* User-specific reminders

All application data is associated with the authenticated user.

---

## 🌐 Chrome Extension

The QueueIt Chrome Extension allows users to save content directly while browsing.

```text
Browse Content
      ↓
Open QueueIt Extension
      ↓
Save
      ↓
Backend API
      ↓
Supabase
      ↓
AI Processing
      ↓
Content Available in Queue
```

This removes the need to manually copy URLs into the application.

---

## 🛠️ Technology Stack

| Layer               | Technology                      |
| ------------------- | ------------------------------- |
| Frontend            | Next.js 15, React, TypeScript   |
| Styling             | Tailwind CSS                    |
| State/Data Fetching | SWR                             |
| Backend             | Node.js, Express.js, TypeScript |
| Database            | PostgreSQL via Supabase         |
| Authentication      | Supabase Auth                   |
| AI                  | Google Gemini API               |
| Semantic Search     | Vector Embeddings               |
| Email               | SMTP                            |
| Browser Integration | Chrome Extension                |
| Version Control     | Git & GitHub                    |

---

## 📂 Project Structure

```text
QueueIt/
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   └── types/
│   ├── public/
│   └── package.json
│
├── backend_node/
│   ├── src/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── middleware/
│   │   └── ...
│   └── package.json
│
├── extension/
│   ├── manifest.json
│   └── ...
│
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

* Node.js 18+
* npm
* Supabase project
* Google Gemini API key

### 1. Clone

```bash
git clone https://github.com/AditiPatel18/QueueIt.git
cd QueueIt
```

### 2. Backend

```bash
cd backend_node
npm install
npm run dev
```

Backend runs on:

```text
http://localhost:8001
```

### 3. Frontend

Open another terminal:

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on:

```text
http://localhost:3000
```

### 4. Environment Variables

#### Backend

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=

SMTP_HOST=
SMTP_PORT=
SMTP_USERNAME=
SMTP_PASSWORD=
```

#### Frontend

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_API_URL=http://localhost:8001
```

> ⚠️ Never commit `.env` files, API keys, service-role keys, or SMTP credentials to GitHub.

---

## 📊 Current Status

| Feature                   | Status |
| ------------------------- | :----: |
| 🔐 Email Authentication   |    ✅   |
| 🔵 Google OAuth           |    ✅   |
| 📥 Content Saving         |    ✅   |
| 🎥 YouTube Extraction     |    ✅   |
| 🌐 Web Content Extraction |    ✅   |
| 📄 PDF Processing         |    ✅   |
| 💻 GitHub Content         |    ✅   |
| 🤖 AI Summaries           |    ✅   |
| 🏷️ AI Tagging            |    ✅   |
| 📂 Smart Categorization   |    ✅   |
| 🎯 Priority Scoring       |    ✅   |
| 💡 AI Recommendations     |    ✅   |
| 🔎 Keyword Search         |    ✅   |
| 🧠 Semantic Search        |    ✅   |
| 💬 AI Chat                |    ✅   |
| 📁 Collections            |    ✅   |
| ⭐ Favorites               |    ✅   |
| 📖 Reading Progress       |    ✅   |
| 🕒 Reading History        |    ✅   |
| 📊 Analytics              |    ✅   |
| 🔥 Reading Streaks        |    ✅   |
| 🔔 Smart Reminders        |    ✅   |
| 📧 Email Notifications    |    ✅   |
| 🌐 Chrome Extension       |    ✅   |
| 🚫 Duplicate Prevention   |    ✅   |

---

## 🎯 Engineering Highlights

QueueIt demonstrates practical experience with:

* Full-stack application architecture
* REST API development
* Type-safe development with TypeScript
* Authentication and protected resources
* PostgreSQL database design
* AI API integration
* Prompt engineering
* Content extraction pipelines
* Vector embeddings and semantic search
* Background processing
* Scheduled jobs
* SMTP email automation
* Browser extension development
* Real-time UI updates
* Duplicate detection
* Analytics and progress tracking
* User-specific data isolation
* Error handling and API validation

---

## 🔮 Future Roadmap

* 📱 Mobile application
* 🧠 AI-generated flashcards
* 📝 AI quiz generation
* 📷 OCR-based document processing
* 📡 Offline reading
* 👥 Collaborative knowledge spaces
* 📅 Calendar integration
* 📝 Notion integration
* 🦊 Firefox Extension
* 🌐 Chrome Web Store release

---

## 📸 Screenshots

Recommended screenshots for the repository:

| Screen              | Description                        |
| ------------------- | ---------------------------------- |
| 🏠 Dashboard        | Personalized content overview      |
| 📚 Queue            | Saved content and reading progress |
| 🤖 AI Summary       | AI-generated content understanding |
| 📊 Analytics        | Reading and completion insights    |
| 🔔 Smart Reminders  | Scheduled reading reminders        |
| 🌐 Chrome Extension | One-click content saving           |

---

## 💡 Why QueueIt?

Traditional bookmarking answers:

> **"Where did I save this?"**

QueueIt answers:

> **"What should I consume next, and why?"**

It combines **content ingestion, AI understanding, knowledge organization, semantic search, personalized recommendations, reading tracking, analytics, and reminders** into one workflow.

```text
Save
  ↓
Understand
  ↓
Organize
  ↓
Prioritize
  ↓
Read
  ↓
Track
  ↓
Learn
```

---

## 👨‍💻 Author

<div align="center">

### Aditi Patel

**B.Tech Information Technology**

Dharmsinh Desai University, Gujarat, India

Full-Stack Development • AI • Backend Engineering • Intelligent Systems

[GitHub](https://github.com/AditiPatel18)

</div>

---

## 📄 License

This project is licensed under the **MIT License**.

---

<div align="center">

⭐ **If you find QueueIt useful, consider starring the repository!**

Built with ❤️ using **Next.js • Node.js • Express • PostgreSQL • Supabase • Google Gemini**

</div>
