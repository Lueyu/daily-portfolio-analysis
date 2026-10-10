/**
 * Small animated loading spinner icon.
 *
 * Vendored shadcn-style UI primitive (Radix UI + Tailwind CSS).
 */

import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Animated loading spinner. */
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
