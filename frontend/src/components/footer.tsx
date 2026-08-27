"use client";

import Link from "next/link";
import { LayersIcon, GitBranch, Globe, Mail, ShieldCheck, FileText, ArrowUpRight } from "lucide-react";

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-border/30 bg-card/40 backdrop-blur-lg mt-auto">
      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-8 pb-10 border-b border-border/20">
          {/* Brand Column */}
          <div className="md:col-span-2 space-y-3">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl gradient-primary shadow-md shadow-primary/20 transition-transform group-hover:scale-105">
                <LayersIcon className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-extrabold tracking-tight gradient-text">
                QueueIt
              </span>
            </Link>
            <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-sm">
              Your universal intelligent queue for articles, videos, podcasts, and web pages. Save from anywhere, enrich with AI, and consume at your pace.
            </p>
          </div>

          {/* Product Links */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/90">Navigation</h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>
                <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
              </li>
              <li>
                <Link href="/analytics" className="hover:text-foreground transition-colors">Analytics</Link>
              </li>
              <li>
                <Link href="/history" className="hover:text-foreground transition-colors">History</Link>
              </li>
              <li>
                <Link href="/chat" className="hover:text-foreground transition-colors">AI Assistant</Link>
              </li>
            </ul>
          </div>

          {/* Resources */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/90">Resources</h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>
                <Link href="/extension" className="hover:text-foreground transition-colors flex items-center gap-1">
                  Extension Guide <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </li>
              <li>
                <Link href="/#faq" className="hover:text-foreground transition-colors flex items-center gap-1">
                  FAQ & Support <ArrowUpRight className="h-3 w-3 opacity-60" />
                </Link>
              </li>
              <li>
                <Link href="/profile" className="hover:text-foreground transition-colors">Profile & Settings</Link>
              </li>
            </ul>
          </div>

          {/* Security & Trust */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-foreground/90">Security</h4>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5 text-emerald-400 font-medium">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>Row Level Security</span>
              </li>
              <li className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Privacy Preserved</span>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} QueueIt SaaS. All rights reserved.</p>
          <div className="flex items-center gap-5">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <span className="hover:text-foreground transition-colors cursor-pointer">Privacy Policy</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
