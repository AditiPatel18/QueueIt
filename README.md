# QueueIt

A universal content queue platform — save articles, videos, tweets, and other content to consume later.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Python FastAPI
- **Database/Auth**: Supabase (PostgreSQL + Auth)

## Project Structure

```
queueit/
├── frontend/     # Next.js app
├── backend/      # FastAPI app
└── .gitignore
```

## Getting Started

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # macOS/Linux
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Environment Variables

Copy the `.env` templates in both `frontend/.env.local` and `backend/.env` and fill in your Supabase credentials.
