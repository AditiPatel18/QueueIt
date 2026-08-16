# QueueIt

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" />
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" />
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-3ECF8E?logo=postgresql" />
  <img src="https://img.shields.io/badge/AI-Google%20Gemini-4285F4?logo=google" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" />
</p>

<p align="center">
  <strong>AI-Powered Knowledge Management & Content Queue Platform</strong>
</p>

<p align="center">
  Save knowledge. Understand it faster. Know what to learn next.
</p>

---

## Overview

**QueueIt** is an AI-powered knowledge management platform designed to solve a common problem: people save large amounts of useful content but rarely return to consume it.

QueueIt turns saved content into an intelligent learning queue.

Users can save YouTube videos, articles, webpages, PDFs, GitHub repositories and other resources. QueueIt extracts the available content, processes it with AI, generates meaningful summaries and tags, estimates reading time, tracks learning progress, and recommends what the user should consume next.

The platform combines **content extraction, AI processing, semantic search, personalized recommendations, analytics, reminders, and browser-based content capture** into a single system.

---

## Key Features

### Intelligent Content Ingestion

- Save YouTube videos
- Save articles and webpages
- Save PDFs
- Save GitHub repositories
- Browser extension for one-click saving
- Automatic metadata extraction
- Duplicate content detection
- Content type detection
- Content processing pipeline

### AI-Powered Understanding

- AI-generated concise summaries
- Detailed AI summaries based on the complete extracted content
- Automatic tag generation
- Smart content categorization
- Priority scoring
- Personalized recommendations
- Semantic search using embeddings
- AI Chat over saved knowledge

### Knowledge Organization

- Collections and folders
- Favorites
- Search and filtering
- Content type filters
- Reading status management
- Reading history
- Automatic organization
- Restore and delete functionality

### Reading & Progress Tracking

- Estimated reading time
- Reading progress tracking
- Unread / Reading / Completed states
- Completion history
- Reading statistics
- Completion streaks

### Smart Reminders

- Schedule reading reminders
- Email notifications
- Reminder history
- Scheduled reminder processing
- Personalized reading recommendations
- Direct "Read Now" links to saved content
- Duplicate notification prevention

### Analytics

- Total saved content
- Completed content
- Reading progress
- Time spent reading
- Completion statistics
- Content distribution
- Reading streaks
- Personalized recommendations

---

# System Architecture

```text
                         ┌─────────────────────┐
                         │   Chrome Extension  │
                         └──────────┬──────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────┐
│                    Next.js Frontend                     │
│                                                         │
│ React • TypeScript • Tailwind CSS • SWR • Framer Motion │
└──────────────────────────┬──────────────────────────────┘
                           │
                       REST APIs
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    FastAPI Backend                      │
│                                                         │
│ Authentication • Content APIs • Search • Analytics      │
│ Reminders • AI Services • Background Processing         │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
                ▼                     ▼
      ┌─────────────────┐   ┌──────────────────────┐
      │ Content         │   │ Google Gemini AI     │
      │ Processing      │   │                      │
      │                 │   │ • Summaries          │
      │ • YouTube       │   │ • Tags               │
      │ • Webpages      │   │ • Classification     │
      │ • PDFs          │   │ • Recommendations    │
      │ • GitHub        │   │ • Priority            │
      └────────┬────────┘   └──────────┬───────────┘
               │                       │
               └───────────┬───────────┘
                           ▼
                 ┌─────────────────────┐
                 │ Supabase PostgreSQL  │
                 │                     │
                 │ Auth + Application  │
                 │ Data + Embeddings   │
                 └─────────────────────┘
