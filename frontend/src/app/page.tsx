"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/footer";
import {
  Bookmark,
  LayersIcon,
  ZapIcon,
  ArrowRightIcon,
  PlayCircle,
  NewspaperIcon,
  Sparkles,
  Bot,
  Globe,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Flame,
  ShieldCheck,
  Search,
  FolderOpen,
  ArrowUpRight,
  Menu,
  X,
  BookOpen,
  MessageSquare,
  Video,
  GitBranch,
} from "lucide-react";

const HERO_KEYWORDS = [
  "Articles",
  "YouTube Videos",
  "AI Summaries",
  "Tech Blogs",
  "Podcasts",
  "Web Pages",
];

const FAQ_ITEMS = [
  {
    question: "How does QueueIt handle different content types?",
    answer:
      "QueueIt automatically detects the source URL structure (YouTube videos, Medium articles, GitHub repositories, Twitter/X threads, sub-blogs) and extracts full text, metadata, estimated read time, and favicons tailored to that platform.",
  },
  {
    question: "How do I install and use the Browser Extension?",
    answer:
      "You can load our extension into Chrome, Brave, or Edge in Developer Mode under chrome://extensions. Once installed, simply click the QueueIt icon or right-click any page to instantly save it to your queue without leaving your current tab.",
  },
  {
    question: "How does AI Summary generation work?",
    answer:
      "When a new URL is saved, QueueIt's background engine fetches the article or transcript, cleans the markup, and runs advanced AI models to produce concise bulleted summaries, estimated read times, and category tags.",
  },
  {
    question: "Is my queue data private and secure?",
    answer:
      "Yes. All items, reading notes, and folder collections are bound strictly to your authenticated Supabase account. We enforce row-level security and never sell or share user data.",
  },
  {
    question: "What happens when I set progress to 100%?",
    answer:
      "Setting progress to 100% automatically marks the item as 'Completed' and moves it to your History tab. It also credits reading minutes toward your daily goal and reading streak counter.",
  },
  {
    question: "Is QueueIt free to use?",
    answer:
      "Yes! QueueIt is 100% free for individual use. You get unlimited item saving, full AI summary enrichment, analytics, and browser extension support.",
  },
];

export default function LandingPage() {
  const [keywordIndex, setKeywordIndex] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Auto-rotating headline keywords
  useEffect(() => {
    const interval = setInterval(() => {
      setKeywordIndex((prev) => (prev + 1) % HERO_KEYWORDS.length);
    }, 2400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden font-sans">
      {/* Background ambient lighting effects */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 -left-40 h-[550px] w-[550px] rounded-full bg-[oklch(0.6_0.22_270_/_12%)] blur-[140px] animate-pulse-slow" />
        <div className="absolute -bottom-40 -right-40 h-[550px] w-[550px] rounded-full bg-[oklch(0.55_0.2_300_/_10%)] blur-[140px] animate-pulse-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[700px] w-[700px] rounded-full bg-[oklch(0.45_0.15_260_/_6%)] blur-[160px]" />
        
        {/* Fine background grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0 / 20%) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 20%) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      {/* Top Header Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-border/30 glass">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl gradient-primary shadow-md shadow-primary/25 transition-transform group-hover:scale-105">
              <LayersIcon className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-extrabold tracking-tight gradient-text">
              QueueIt
            </span>
          </Link>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-xs font-semibold text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">Workflow</a>
            <a href="#extension" className="hover:text-foreground transition-colors">Extension</a>
            <a href="#faq" className="hover:text-foreground transition-colors">FAQ</a>
          </nav>

          {/* Header Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login">
              <Button variant="ghost" size="sm" className="text-xs font-semibold hover:text-foreground cursor-pointer">
                Log in
              </Button>
            </Link>
            <Link href="/signup">
              <Button size="sm" className="gradient-primary text-white border-0 hover:opacity-95 transition-all shadow-md shadow-primary/20 glow-primary cursor-pointer text-xs font-semibold gap-1.5 h-9">
                Get Started
                <ArrowRightIcon className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>

          {/* Mobile menu toggle */}
          <div className="md:hidden flex items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="h-9 w-9 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/20 glass-strong px-6 py-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
            <nav className="flex flex-col gap-3 text-xs font-semibold text-muted-foreground">
              <a href="#features" onClick={() => setMobileMenuOpen(false)} className="hover:text-foreground py-1">Features</a>
              <a href="#how-it-works" onClick={() => setMobileMenuOpen(false)} className="hover:text-foreground py-1">Workflow</a>
              <a href="#extension" onClick={() => setMobileMenuOpen(false)} className="hover:text-foreground py-1">Extension Guide</a>
              <a href="#faq" onClick={() => setMobileMenuOpen(false)} className="hover:text-foreground py-1">FAQ</a>
            </nav>
            <div className="pt-3 border-t border-border/15 flex flex-col gap-2">
              <Link href="/signup" onClick={() => setMobileMenuOpen(false)}>
                <Button className="w-full gradient-primary text-white border-0 text-xs h-9 font-semibold gap-1.5 shadow-md shadow-primary/20">
                  Get Started Free
                  <ArrowRightIcon className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <Link href="/login" onClick={() => setMobileMenuOpen(false)}>
                <Button variant="outline" size="sm" className="w-full h-9 text-xs glass border-border/30">
                  Log in
                </Button>
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* Main Hero Section */}
      <main className="relative z-10">
        <section className="mx-auto max-w-7xl px-6 pt-16 pb-24 md:pt-28 md:pb-32 text-center flex flex-col items-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary shadow-xs animate-in fade-in duration-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Universal Reading Queue & AI Summarizer</span>
          </div>

          {/* Auto-Rotating Headline */}
          <h1 className="max-w-4xl text-4xl font-extrabold leading-[1.12] tracking-tight sm:text-6xl md:text-7xl">
            Queue your{" "}
            <span key={keywordIndex} className="gradient-text inline-block min-w-[280px] sm:min-w-[380px] text-left animate-in fade-in slide-in-from-bottom-2 duration-300">
              {HERO_KEYWORDS[keywordIndex]}
            </span>
            <br />
            seamlessly.
          </h1>

          {/* Subtitle */}
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg md:text-xl">
            Articles, videos, tweets, podcasts — everything you want to read or watch later, organized in one intelligent queue with instant AI summaries. Stop drowning in browser tabs.
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-col gap-3.5 sm:flex-row items-center justify-center">
            <Link href="/signup">
              <Button
                size="lg"
                className="gradient-primary text-white border-0 px-8 py-6 text-sm font-bold hover:opacity-95 transition-all shadow-xl shadow-primary/25 glow-primary cursor-pointer gap-2"
              >
                Start Queueing Free
                <ArrowRightIcon className="h-4 w-4" />
              </Button>
            </Link>
            <a href="#extension">
              <Button
                size="lg"
                variant="outline"
                className="glass-strong border-border/40 px-7 py-6 text-sm font-semibold hover:bg-secondary/60 transition-all cursor-pointer gap-2"
              >
                <Globe className="h-4 w-4 text-primary" />
                Browser Extension
              </Button>
            </a>
          </div>

          {/* Micro trust line */}
          <p className="mt-4 text-xs text-muted-foreground/70 flex items-center justify-center gap-3">
            <span>✓ No credit card required</span>
            <span>·</span>
            <span>✓ Chrome/Edge extension supported</span>
            <span>·</span>
            <span>✓ AI enriched</span>
          </p>

          {/* Live Interactive Queue Mockup Card Preview */}
          <div className="mt-14 w-full max-w-5xl rounded-2xl glass-strong border border-white/10 p-3 sm:p-5 shadow-2xl relative overflow-hidden group">
            {/* Header bar of preview */}
            <div className="flex items-center justify-between border-b border-border/20 pb-3 mb-4 px-2">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-rose-500/80" />
                <div className="h-3 w-3 rounded-full bg-amber-500/80" />
                <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
                <span className="ml-2 text-xs font-semibold text-muted-foreground/80 font-mono">QueueIt Dashboard — Live Preview</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-primary bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Flame className="h-3 w-3 fill-primary" /> 5 Day Streak
                </span>
              </div>
            </div>

            {/* Simulated Queue Items Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
              {/* Item Card 1 */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-3 hover:border-primary/30 transition-all">
                <div className="flex justify-between items-center text-xs">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20 text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <BookOpen className="h-3 w-3" /> Article
                  </span>
                  <span className="text-primary text-[11px] font-bold">95 Priority</span>
                </div>
                <h4 className="font-bold text-sm leading-snug line-clamp-2">
                  Building Scalable Microservices with Rust & Node.js
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  Deep dive into zero-cost abstractions, asynchronous I/O loops, and memory safety for low latency APIs...
                </p>
                <div className="pt-2 border-t border-border/15 flex justify-between items-center text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 12 min read</span>
                  <span className="text-emerald-400 font-bold">65% Read</span>
                </div>
              </div>

              {/* Item Card 2 */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-3 hover:border-primary/30 transition-all">
                <div className="flex justify-between items-center text-xs">
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-400 font-bold border border-rose-500/20 text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <Video className="h-3 w-3" /> YouTube
                  </span>
                  <span className="text-primary text-[11px] font-bold">88 Priority</span>
                </div>
                <h4 className="font-bold text-sm leading-snug line-clamp-2">
                  Understanding Transformer Neural Networks & Attention Mechanisms
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  Visual breakdown of multi-head self-attention, positional encoding, and token embeddings...
                </p>
                <div className="pt-2 border-t border-border/15 flex justify-between items-center text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 18 min watch</span>
                  <span className="text-amber-400 font-bold">20% Watch</span>
                </div>
              </div>

              {/* Item Card 3 */}
              <div className="rounded-xl glass border border-white/10 p-4 space-y-3 hover:border-primary/30 transition-all">
                <div className="flex justify-between items-center text-xs">
                  <span className="px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20 text-[10px] uppercase tracking-wider flex items-center gap-1">
                    <GitBranch className="h-3 w-3" /> GitHub
                  </span>
                  <span className="text-primary text-[11px] font-bold">78 Priority</span>
                </div>
                <h4 className="font-bold text-sm leading-snug line-clamp-2">
                  State of Web Architecture & Server Actions in 2026
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  Architecture patterns for reactive web apps, streaming server components, and edge caching strategies...
                </p>
                <div className="pt-2 border-t border-border/15 flex justify-between items-center text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> 8 min read</span>
                  <span className="text-primary font-bold">Unread</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Features Grid Section */}
        <section id="features" className="mx-auto max-w-7xl px-6 py-24 border-t border-border/20">
          <div className="text-center mb-16 space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Engineered for Focus</span>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
              Everything you need to <span className="gradient-text">master your queue</span>
            </h2>
            <p className="text-muted-foreground text-base max-w-xl mx-auto">
              QueueIt combines intelligent metadata extraction, AI key takeaways, and gamified reading analytics into one seamless platform.
            </p>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {/* Feature 1 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">AI Summaries & Takeaways</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Get concise key takeaways and executive summaries extracted automatically from long articles, technical blogs, and YouTube videos.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Bookmark className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Universal Ingestion</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Save content from Medium, Dev.to, Substack, YouTube, Twitter/X, GitHub, or any web URL with full metadata parsing and favicons.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <FolderOpen className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Smart Folders & Collections</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Organize items into customized color-coded folders like Work, Learn, Research, or Tech. Filter and sort by priority with drag & drop.
              </p>
            </div>

            {/* Feature 4 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Flame className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Reading Velocity & Streaks</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Track your daily reading time, completed items, velocity heatmap, and maintain your reading streak with gamified statistics.
              </p>
            </div>

            {/* Feature 5 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Clock className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">Scheduled Reminders</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Set custom reminder popovers or email digests for high-priority items so you never forget essential saved research.
              </p>
            </div>

            {/* Feature 6 */}
            <div className="glass-card rounded-2xl p-7 space-y-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Bot className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold">AI Assistant / Chat</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Ask questions across your entire saved queue. Query specific topics, ask for recommendations, or synthesize research instantly.
              </p>
            </div>
          </div>
        </section>

        {/* How it Works / Workflow Section */}
        <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-24 border-t border-border/20">
          <div className="text-center mb-16 space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Simple & Powerful</span>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
              How <span className="gradient-text">QueueIt</span> works in 3 steps
            </h2>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            {/* Step 1 */}
            <div className="glass p-8 rounded-2xl space-y-4 relative border border-white/10">
              <span className="text-4xl font-extrabold text-primary/30 font-mono">01</span>
              <h3 className="text-lg font-bold">Save from Anywhere</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Click the QueueIt Chrome Extension icon or paste any web URL into your dashboard. QueueIt handles the rest automatically.
              </p>
            </div>

            {/* Step 2 */}
            <div className="glass p-8 rounded-2xl space-y-4 relative border border-white/10">
              <span className="text-4xl font-extrabold text-primary/30 font-mono">02</span>
              <h3 className="text-lg font-bold">AI Enriches & Organizes</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Background pipelines extract full text, calculate read time, generate AI summaries, suggest folders, and assign priority scores.
              </p>
            </div>

            {/* Step 3 */}
            <div className="glass p-8 rounded-2xl space-y-4 relative border border-white/10">
              <span className="text-4xl font-extrabold text-primary/30 font-mono">03</span>
              <h3 className="text-lg font-bold">Consume & Track Growth</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Read or watch content in clean distraction-free mode. Update progress sliders to build your streak and export CSV reports anytime.
              </p>
            </div>
          </div>
        </section>

        {/* Browser Extension How-To & Setup Guide Section */}
        <section id="extension" className="mx-auto max-w-7xl px-6 py-24 border-t border-border/20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
                <Globe className="h-4 w-4" /> Browser Extension Guide
              </div>
              <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
                Save content in <span className="gradient-text">1 click</span> without leaving your tab
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Our lightweight browser extension integrates directly into Chrome, Brave, and Edge. Save articles, YouTube videos, and research papers instantly into your queue.
              </p>

              <div className="space-y-3 pt-2">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">1-Click Popup Saving</h4>
                    <p className="text-xs text-muted-foreground">Click the toolbar extension icon to preview auto-extracted titles, tags, and save instantly.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Right-Click Context Menu</h4>
                    <p className="text-xs text-muted-foreground">Right-click any link or page to select "Save to QueueIt".</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Automatic Token Sync</h4>
                    <p className="text-xs text-muted-foreground">Seamlessly syncs with your logged-in QueueIt web session securely.</p>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Link href="/signup">
                  <Button className="gradient-primary text-white border-0 px-6 py-5 text-xs font-bold hover:opacity-95 shadow-md shadow-primary/20 cursor-pointer gap-2">
                    <Globe className="h-4 w-4" /> Install Extension Now
                  </Button>
                </Link>
              </div>
            </div>

            {/* Installation Instructions Box */}
            <div className="glass-strong rounded-2xl p-6 sm:p-8 border border-white/10 space-y-5">
              <h3 className="text-base font-bold flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" /> Extension Setup Instructions
              </h3>
              
              <ol className="space-y-4 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
                <li className="pl-1">
                  <strong className="text-foreground">Download Extension Files:</strong> Locate the <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-primary font-mono">extension/</code> folder in the QueueIt project repository.
                </li>
                <li className="pl-1">
                  <strong className="text-foreground">Open Chrome Extensions:</strong> Navigate to <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-primary font-mono">chrome://extensions</code> in your browser.
                </li>
                <li className="pl-1">
                  <strong className="text-foreground">Enable Developer Mode:</strong> Toggle the Developer Mode switch in the upper right corner.
                </li>
                <li className="pl-1">
                  <strong className="text-foreground">Load Unpacked:</strong> Click <em>"Load unpacked"</em> and select the <code className="bg-secondary/50 px-1.5 py-0.5 rounded text-primary font-mono">extension/</code> folder.
                </li>
                <li className="pl-1">
                  <strong className="text-foreground">Start Saving:</strong> Click the QueueIt extension icon on any webpage to save directly into your queue!
                </li>
              </ol>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section id="faq" className="mx-auto max-w-4xl px-6 py-24 border-t border-border/20">
          <div className="text-center mb-16 space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Got Questions?</span>
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
              Frequently Asked <span className="gradient-text">Questions</span>
            </h2>
          </div>

          <div className="space-y-3">
            {FAQ_ITEMS.map((faq, idx) => {
              const isOpen = openFaqIndex === idx;
              return (
                <div
                  key={idx}
                  className="glass rounded-xl border border-white/10 overflow-hidden transition-all duration-200"
                >
                  <button
                    onClick={() => setOpenFaqIndex(isOpen ? null : idx)}
                    className="w-full flex items-center justify-between p-5 text-left font-bold text-sm hover:text-primary transition-colors cursor-pointer"
                  >
                    <span>{faq.question}</span>
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4 text-primary shrink-0" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed animate-in fade-in duration-200 border-t border-border/10 pt-3">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Bottom CTA Banner */}
        <section className="mx-auto max-w-7xl px-6 pb-24">
          <div className="rounded-3xl gradient-primary p-10 sm:p-16 text-center space-y-6 text-white shadow-2xl relative overflow-hidden">
            <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight">
              Ready to organize your content queue?
            </h2>
            <p className="text-white/80 text-base max-w-xl mx-auto">
              Join content creators, developers, researchers, and tech leaders who rely on QueueIt to save and consume knowledge efficiently.
            </p>
            <div className="pt-4 flex justify-center gap-4">
              <Link href="/signup">
                <Button size="lg" className="bg-white text-slate-950 hover:bg-white/90 border-0 px-8 py-6 text-sm font-extrabold shadow-xl cursor-pointer">
                  Get Started for Free
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
