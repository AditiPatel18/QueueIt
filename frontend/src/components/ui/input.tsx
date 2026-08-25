import * as React from "react"
import { cn } from "@/lib/utils"

function Input({ className, type, value, defaultValue, ...props }: React.ComponentProps<"input">) {
  const isControlled = value !== undefined;
  const safeValue = isControlled ? (value ?? "") : undefined;
  const safeDefaultValue = isControlled ? undefined : defaultValue;

  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input/60 bg-secondary/10 px-3 py-1.5 text-sm transition-all outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:bg-input/20 dark:border-white/10 dark:focus-visible:border-primary/50 dark:focus-visible:ring-primary/20",
        className
      )}
      value={safeValue}
      defaultValue={safeDefaultValue}
      {...props}
    />
  )
}

export { Input }
