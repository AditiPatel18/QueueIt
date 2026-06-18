import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "QueueIt — Save Anything, Consume Anywhere",
  description:
    "Your universal content queue. Save articles, videos, tweets, GitHub repos, and more to consume later — with AI-powered summaries and smart prioritization.",
  keywords: ["content queue", "read later", "bookmarks", "save articles", "watch later", "AI summarization"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            style: {
              background: "oklch(0.13 0.01 270 / 90%)",
              border: "1px solid oklch(1 0 0 / 12%)",
              color: "oklch(0.95 0.01 270)",
              backdropFilter: "blur(20px)",
            },
          }}
        />
      </body>
    </html>
  );
}
