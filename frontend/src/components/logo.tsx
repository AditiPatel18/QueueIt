import React from "react";
import Link from "next/link";

interface LogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  href?: string;
  className?: string;
}

export function QueueItLogo({
  size = "md",
  showText = true,
  href = "/dashboard",
  className = "",
}: LogoProps) {
  const iconSizes = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-11 w-11",
  };

  const svgSizes = {
    sm: "h-4.5 w-4.5",
    md: "h-5.5 w-5.5",
    lg: "h-7 w-7",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl",
  };

  const LogoContent = (
    <div className={`flex items-center gap-2.5 group shrink-0 select-none ${className}`}>
      {/* Icon Mark: Stylized Q with Stacked Queued Layers */}
      <div
        className={`relative flex ${iconSizes[size]} items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 via-purple-600 to-indigo-600 shadow-md shadow-violet-500/30 transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-violet-500/40 border border-white/20`}
      >
        <svg
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`${svgSizes[size]} transition-transform duration-300 group-hover:translate-x-0.5`}
        >
          {/* Outer 'Q' Ring */}
          <path
            d="M16 4C9.37 4 4 9.37 4 16C4 22.63 9.37 28 16 28C19.12 28 21.97 26.81 24.09 24.85L26.29 27.05C26.68 27.44 27.32 27.44 27.71 27.05C28.1 26.66 28.1 26.03 27.71 25.64L25.27 23.2C26.97 21.22 28 18.73 28 16C28 9.37 22.63 4 16 4ZM6.5 16C6.5 10.75 10.75 6.5 16 6.5C21.25 6.5 25.5 10.75 25.5 16C25.5 18.29 24.69 20.38 23.35 22.03L20.29 18.98C19.9 18.59 19.27 18.59 18.88 18.98C18.49 19.37 18.49 20 18.88 20.39L21.74 23.25C20.17 24.65 18.18 25.5 16 25.5C10.75 25.5 6.5 21.25 6.5 16Z"
            fill="#FFFFFF"
          />

          {/* Stacked Queued Layers (Books / Cards) */}
          <rect
            x="9.5"
            y="10.5"
            width="13"
            height="2.2"
            rx="1.1"
            fill="#FFFFFF"
          />
          <rect
            x="9.5"
            y="14.5"
            width="13"
            height="2.2"
            rx="1.1"
            fill="#FFFFFF"
          />
          <rect
            x="9.5"
            y="18.5"
            width="9"
            height="2.2"
            rx="1.1"
            fill="#FFFFFF"
          />
        </svg>
      </div>

      {/* Brand Text - Full contrast in both Dark and Light themes */}
      {showText && (
        <span className={`${textSizes[size]} font-black tracking-tight flex items-center leading-none`}>
          <span className="text-foreground transition-colors">Queue</span>
          <span className="text-violet-600 dark:text-violet-400 font-black">It</span>
        </span>
      )}
    </div>
  );

  if (href) {
    return <Link href={href} className="inline-flex items-center">{LogoContent}</Link>;
  }

  return LogoContent;
}
