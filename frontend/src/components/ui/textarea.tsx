// src/components/ui/textarea.tsx

import * as React from "react";

export interface TextareaProps
    extends React.TextareaHTMLAttributes<HTMLTextAreaElement> { }

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ className = "", ...props }, ref) => {
        return (
            <textarea
                ref={ref}
                className={`flex min-h-[80px] w-full rounded-md border px-3 py-2 text-sm ${className}`}
                {...props}
            />
        );
    }
);

Textarea.displayName = "Textarea";

export { Textarea };