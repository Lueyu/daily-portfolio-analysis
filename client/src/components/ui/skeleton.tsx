/**
 * Pulsing gray placeholder used while content loads.
 *
 * Vendored shadcn-style UI primitive (Radix UI + Tailwind CSS).
 */

import { cn } from "@/lib/utils"

/** Pulsing loading placeholder. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
