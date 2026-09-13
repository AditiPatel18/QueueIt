import Link from "next/link";
import { Footer } from "@/components/footer";
import { QueueItLogo } from "@/components/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col min-h-screen bg-background text-foreground">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0">
        <div className="absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-[oklch(0.5_0.2_270_/_12%)] blur-[120px] animate-pulse-slow" />
        <div className="absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-[oklch(0.45_0.18_300_/_10%)] blur-[100px] animate-pulse-slow" />
      </div>

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo */}
          <div className="mb-8 flex justify-center">
            <QueueItLogo size="lg" href="/" />
          </div>

          {children}
        </div>
      </div>

      <Footer />
    </div>
  );
}
