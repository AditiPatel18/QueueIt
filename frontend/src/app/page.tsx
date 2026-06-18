import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Bookmark,
  LayersIcon,
  ZapIcon,
  ArrowRightIcon,
  PlayCircle,
  NewspaperIcon,
  MessageCircleIcon,
} from "lucide-react";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        {/* Gradient orbs */}
        <div className="absolute -top-40 -left-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.5_0.2_270_/_15%)] blur-[120px] animate-pulse-slow" />
        <div className="absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.45_0.18_300_/_12%)] blur-[120px] animate-pulse-slow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full bg-[oklch(0.4_0.15_250_/_8%)] blur-[150px]" />

        {/* Grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(oklch(1 0 0 / 20%) 1px, transparent 1px), linear-gradient(90deg, oklch(1 0 0 / 20%) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* Navigation */}
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-primary">
            <LayersIcon className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold tracking-tight">QueueIt</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login">
            <Button variant="ghost" className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              Log in
            </Button>
          </Link>
          <Link href="/signup">
            <Button className="gradient-primary text-white border-0 hover:opacity-90 transition-opacity glow-primary cursor-pointer">
              Get Started
              <ArrowRightIcon className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero section */}
      <main className="relative z-10 mx-auto max-w-7xl px-6">
        <section className="flex flex-col items-center pt-20 pb-24 text-center md:pt-32 md:pb-32">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm text-primary">
            <ZapIcon className="h-3.5 w-3.5" />
            <span>Your universal content queue</span>
          </div>

          {/* Headline */}
          <h1 className="max-w-4xl text-5xl font-extrabold leading-[1.1] tracking-tight md:text-7xl">
            Save it.{" "}
            <span className="gradient-text">Queue it.</span>
            <br />
            Consume it.
          </h1>

          {/* Subheadline */}
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            Articles, videos, tweets, podcasts — everything you want to consume
            later, in one beautifully organized queue. Stop losing content in
            browser tabs and scattered bookmarks.
          </p>

          {/* CTA buttons */}
          <div className="mt-10 flex flex-col gap-4 sm:flex-row">
            <Link href="/signup">
              <Button
                size="lg"
                className="gradient-primary text-white border-0 px-8 py-6 text-base font-semibold hover:opacity-90 transition-all glow-primary cursor-pointer"
              >
                Start Queueing — It&apos;s Free
                <ArrowRightIcon className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/login">
              <Button
                size="lg"
                variant="outline"
                className="px-8 py-6 text-base font-semibold border-border/50 hover:bg-accent transition-all cursor-pointer"
              >
                I have an account
              </Button>
            </Link>
          </div>

          {/* Social proof hint */}
          <p className="mt-6 text-sm text-muted-foreground/60">
            No credit card required · Free forever for personal use
          </p>
        </section>

        {/* Features grid */}
        <section className="pb-32">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Feature 1 */}
            <div className="group relative rounded-2xl glass p-8 transition-all duration-300 hover:glow-primary hover:border-primary/20">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                <Bookmark className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">Save Anything</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Articles, YouTube videos, tweets, Reddit posts, podcasts — paste
                any link and we&apos;ll extract the content automatically.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="group relative rounded-2xl glass p-8 transition-all duration-300 hover:glow-primary hover:border-primary/20">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                <LayersIcon className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">Smart Queues</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Auto-categorize by content type. Create custom queues. Tag,
                filter, and prioritize what matters most to you.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="group relative rounded-2xl glass p-8 transition-all duration-300 hover:glow-primary hover:border-primary/20">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110">
                <ZapIcon className="h-6 w-6" />
              </div>
              <h3 className="mb-2 text-lg font-semibold">Consume Anywhere</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Read articles in a clean reader view. Watch videos inline. Your
                queue syncs across all your devices instantly.
              </p>
            </div>
          </div>
        </section>

        {/* Content type showcase */}
        <section className="pb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              One queue for <span className="gradient-text">everything</span>
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              No more switching between apps. QueueIt handles all your content.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            {[
              { icon: NewspaperIcon, label: "Articles", count: "Blog posts, news, essays" },
              { icon: PlayCircle, label: "Videos", count: "YouTube, Vimeo, and more" },
              { icon: MessageCircleIcon, label: "Tweets", count: "Threads and posts" },
              { icon: Bookmark, label: "Bookmarks", count: "Any URL, any content" },
            ].map((item) => (
              <div
                key={item.label}
                className="group flex flex-col items-center gap-3 rounded-xl glass p-6 text-center transition-all duration-300 hover:border-primary/20 hover:bg-primary/5"
              >
                <item.icon className="h-8 w-8 text-primary transition-transform duration-300 group-hover:scale-110" />
                <div>
                  <p className="font-semibold">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.count}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-border/40 py-8 text-center text-sm text-muted-foreground">
          <p>© 2026 QueueIt. Built for content lovers.</p>
        </footer>
      </main>
    </div>
  );
}
