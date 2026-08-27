"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/footer";
import {
  LayersIcon,
  Download,
  FolderArchive,
  Compass,
  ToggleRight,
  FolderOpen,
  Pin,
  BookmarkPlus,
  ArrowRightIcon,
  CheckCircle2,
  Globe,
  Sparkles,
  ExternalLink,
  Info,
  LayoutDashboard,
} from "lucide-react";

const STEPS = [
  {
    number: "01",
    title: "Download QueueIt Extension ZIP",
    description: "Click the prominent 'Download QueueIt Extension' button above to save the extension package (queueit-extension.zip) to your computer.",
    icon: Download,
    badge: "Step 1",
  },
  {
    number: "02",
    title: "Extract the ZIP File",
    description: "Locate queueit-extension.zip in your Downloads folder and extract/unzip it. You will get an 'extension' folder containing manifest.json and extension assets.",
    icon: FolderArchive,
    badge: "Step 2",
  },
  {
    number: "03",
    title: "Open chrome://extensions",
    description: (
      <>
        In your Chromium browser (Chrome, Brave, Edge, or Opera), navigate to{" "}
        <code className="bg-secondary/60 px-2 py-0.5 rounded text-primary font-mono text-xs border border-primary/20">
          chrome://extensions
        </code>{" "}
        in the URL address bar.
      </>
    ),
    icon: Compass,
    badge: "Step 3",
  },
  {
    number: "04",
    title: "Enable Developer Mode",
    description: "In the top-right corner of the Extensions page, switch on the 'Developer mode' toggle switch.",
    icon: ToggleRight,
    badge: "Step 4",
  },
  {
    number: "05",
    title: "Click 'Load unpacked'",
    description: "Look at the top-left menu options on the Extensions page and click the 'Load unpacked' button.",
    icon: FolderOpen,
    badge: "Step 5",
  },
  {
    number: "06",
    title: "Select Extracted Extension Folder",
    description: "In the file picker dialog, select the unzipped 'extension' directory that you extracted in Step 2.",
    icon: CheckCircle2,
    badge: "Step 6",
  },
  {
    number: "07",
    title: "Pin QueueIt to Browser Toolbar",
    description: "Click the puzzle piece icon in your browser's top toolbar, find QueueIt, and click the pin icon so it stays visible for 1-click saving.",
    icon: Pin,
    badge: "Step 7",
  },
  {
    number: "08",
    title: "Save Content & Enjoy Queueing",
    description: "Visit any web article, YouTube video, or blog. Click the QueueIt toolbar icon or right-click to instantly add pages to your reading queue!",
    icon: BookmarkPlus,
    badge: "Step 8",
  },
];

export default function ExtensionSetupPage() {
  return (
    <div className="relative min-h-screen bg-background text-foreground overflow-hidden font-sans flex flex-col">
      {/* Background ambient lighting effects */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 -left-40 h-[550px] w-[550px] rounded-full bg-[oklch(0.6_0.22_270_/_12%)] blur-[140px] animate-pulse-slow" />
        <div className="absolute -bottom-40 -right-40 h-[550px] w-[550px] rounded-full bg-[oklch(0.55_0.2_300_/_10%)] blur-[140px] animate-pulse-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[700px] w-[700px] rounded-full bg-[oklch(0.45_0.15_260_/_6%)] blur-[160px]" />

        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0 / 20%) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 20%) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      {/* Top Navigation */}
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

          <div className="flex items-center gap-3">
            <Link href="/">
              <Button variant="ghost" size="sm" className="text-xs font-semibold hover:text-foreground cursor-pointer">
                Home
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="sm" variant="outline" className="glass border-border/30 text-xs font-semibold cursor-pointer gap-1.5 h-9">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-5xl px-6 pt-12 pb-12 text-center flex flex-col items-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary shadow-xs">
            <Globe className="h-3.5 w-3.5" />
            <span>Browser Extension Setup Guide</span>
          </div>

          <h1 className="max-w-3xl text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">
            Install the <span className="gradient-text">QueueIt Extension</span>
          </h1>

          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Save articles, YouTube videos, and web pages directly to your queue with a single click — anywhere on the web.
          </p>

          {/* Download CTA Button */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/extension/queueit-extension.zip" download="queueit-extension.zip">
              <Button
                size="lg"
                className="gradient-primary text-white border-0 px-8 py-6 text-sm font-bold hover:opacity-95 transition-all shadow-xl shadow-primary/25 glow-primary cursor-pointer gap-2.5"
              >
                <Download className="h-5 w-5" />
                Download QueueIt Extension (ZIP)
              </Button>
            </a>
          </div>

          <p className="mt-3 text-xs text-muted-foreground/70 flex items-center justify-center gap-2">
            <span>✓ Compatible with Chrome, Brave, Edge & Opera</span>
            <span>·</span>
            <span>✓ Manifest V3</span>
          </p>
        </section>

        {/* Installation Steps Section */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="glass-strong rounded-3xl p-6 sm:p-10 border border-white/10 shadow-2xl space-y-8">
            <div className="border-b border-border/20 pb-6 text-left space-y-1">
              <h2 className="text-xl font-extrabold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" /> Development Installation Steps
              </h2>
              <p className="text-xs text-muted-foreground">
                Follow these step-by-step instructions to load the QueueIt extension into your browser using Developer Mode.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
              {STEPS.map((step) => {
                const IconComponent = step.icon;
                return (
                  <div
                    key={step.number}
                    className="glass rounded-2xl p-5 border border-white/10 hover:border-primary/30 transition-all flex items-start gap-4"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
                      <IconComponent className="h-5 w-5" />
                    </div>
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                          {step.badge}
                        </span>
                        <span className="text-xs font-mono font-bold text-muted-foreground/50">
                          {step.number}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-foreground">
                        {step.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Tips Box */}
            <div className="rounded-2xl bg-secondary/40 border border-border/30 p-5 flex items-start gap-3.5 text-left">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground space-y-1">
                <h4 className="font-bold text-foreground">How authentication works in the extension</h4>
                <p className="leading-relaxed">
                  The QueueIt extension connects directly to your QueueIt web app session. Make sure you are logged into your QueueIt account in the browser so saved links automatically sync to your dashboard!
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Dashboard CTA Section ONLY AFTER Installation Instructions */}
        <section className="mx-auto max-w-5xl px-6 pb-20 text-center">
          <div className="glass rounded-2xl p-8 border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="text-left space-y-1">
              <h3 className="text-base font-bold text-foreground">Done installing? View your saved items</h3>
              <p className="text-xs text-muted-foreground">
                Head over to your QueueIt dashboard to manage your queue, read AI summaries, and set priorities.
              </p>
            </div>
            <Link href="/dashboard">
              <Button
                variant="outline"
                size="sm"
                className="glass-strong border-border/40 text-xs font-semibold hover:bg-secondary/60 transition-all cursor-pointer gap-2 shrink-0 h-10 px-5"
              >
                <span>Open Dashboard</span>
                <ArrowRightIcon className="h-3.5 w-3.5 text-primary" />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
