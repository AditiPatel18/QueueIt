"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { QueueItLogo } from "@/components/logo";
import { useAuth } from "@/components/auth-provider";
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
  const router = useRouter();
  const { user } = useAuth();

  const handleDownload = (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (!user) {
      const nextUrl = encodeURIComponent("/extension?download=true");
      router.push(`/login?next=${nextUrl}`);
      return;
    }
    const link = document.createElement("a");
    link.href = "/api/extension/download";
    link.download = "queueit-extension.zip";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (typeof window !== "undefined" && user) {
      const params = new URLSearchParams(window.location.search);
      if (params.get("download") === "true") {
        handleDownload();
        const newUrl = window.location.pathname;
        window.history.replaceState({}, "", newUrl);
      }
    }
  }, [user]);

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
          <QueueItLogo href={user ? "/dashboard" : "/"} />

          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard">
                <Button size="sm" variant="outline" className="glass border-border/30 text-xs font-semibold cursor-pointer gap-1.5 h-9">
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button variant="ghost" size="sm" className="text-xs font-semibold hover:text-foreground cursor-pointer">
                    Sign in
                  </Button>
                </Link>
                <Link href="/signup">
                  <Button size="sm" className="gradient-primary text-white text-xs font-bold shadow-md cursor-pointer h-9 px-4">
                    Create account
                  </Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1">
        {/* Hero Section */}
        <section className="mx-auto max-w-5xl px-6 pt-12 pb-8 text-center flex flex-col items-center">
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

          {/* Download CTA Buttons */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button
              size="lg"
              onClick={handleDownload}
              className="gradient-primary text-white border-0 px-8 py-6 text-sm font-bold hover:opacity-95 transition-all shadow-xl shadow-primary/25 glow-primary cursor-pointer gap-2.5"
            >
              <Download className="h-5 w-5" />
              Download QueueIt Extension (ZIP)
            </Button>
            {!user ? (
              <Link href={"/signup?next=" + encodeURIComponent("/extension?download=true")}>
                <Button
                  size="lg"
                  variant="outline"
                  className="glass-strong border-border/40 text-sm font-bold hover:bg-secondary/60 transition-all cursor-pointer px-6 py-6"
                >
                  Create Free Account
                </Button>
              </Link>
            ) : null}
          </div>

          <p className="mt-4 text-xs text-muted-foreground/70 flex items-center justify-center gap-2">
            <span>✓ Compatible with Chrome, Brave, Edge & Opera</span>
            <span>·</span>
            <span>✓ Developer Mode (Load Unpacked)</span>
          </p>
        </section>

        {/* Visual Workflow Demo Card */}
        <section className="mx-auto max-w-5xl px-6 pb-12">
          <div className="glass rounded-3xl p-6 border border-white/10 shadow-xl space-y-4">
            <h3 className="text-xs font-bold text-center uppercase tracking-wider text-primary">
              How it works — 5-Second Workflow
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 text-center">
              <div className="glass-strong rounded-xl p-3 border border-white/10 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">1</span>
                <span className="text-xs font-bold">Install ZIP</span>
                <span className="text-[10px] text-muted-foreground">Load unpacked in Chrome</span>
              </div>
              <div className="glass-strong rounded-xl p-3 border border-white/10 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">2</span>
                <span className="text-xs font-bold">Pin QueueIt</span>
                <span className="text-[10px] text-muted-foreground">Pin to browser toolbar</span>
              </div>
              <div className="glass-strong rounded-xl p-3 border border-white/10 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">3</span>
                <span className="text-xs font-bold">Open Webpage</span>
                <span className="text-[10px] text-muted-foreground">Any article or YouTube video</span>
              </div>
              <div className="glass-strong rounded-xl p-3 border border-white/10 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">4</span>
                <span className="text-xs font-bold">Click QueueIt</span>
                <span className="text-[10px] text-muted-foreground">Open popup & click Save</span>
              </div>
              <div className="glass-strong rounded-xl p-3 border border-white/10 flex flex-col items-center gap-1.5">
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">5</span>
                <span className="text-xs font-bold">Read & Summarize</span>
                <span className="text-[10px] text-muted-foreground">Synced to your dashboard</span>
              </div>
            </div>
          </div>
        </section>

        {/* Developer Mode Explanation & Installation Steps Section */}
        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="glass-strong rounded-3xl p-6 sm:p-10 border border-white/10 shadow-2xl space-y-8">
            <div className="border-b border-border/20 pb-6 text-left space-y-2">
              <div className="inline-flex items-center gap-2 text-xs font-bold text-primary bg-primary/10 px-3 py-1 rounded-full border border-primary/20">
                <ToggleRight className="h-4 w-4" /> Chrome Developer Mode Required
              </div>
              <h2 className="text-xl font-extrabold text-foreground">
                Step-by-Step Unpacked Extension Installation
              </h2>
              <p className="text-xs text-muted-foreground">
                Chrome requires enabling <strong className="text-foreground">Developer mode</strong> to load local extensions using <strong className="text-foreground">Load unpacked</strong>. Follow the numbered steps below:
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
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/login">
                <Button variant="ghost" size="sm" className="text-xs font-semibold hover:text-foreground cursor-pointer">
                  Sign in
                </Button>
              </Link>
              <Link href="/dashboard">
                <Button
                  variant="outline"
                  size="sm"
                  className="glass-strong border-border/40 text-xs font-semibold hover:bg-secondary/60 transition-all cursor-pointer gap-2 h-10 px-5"
                >
                  <span>Open Dashboard</span>
                  <ArrowRightIcon className="h-3.5 w-3.5 text-primary" />
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
