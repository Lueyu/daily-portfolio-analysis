"use client"

/**
 * Box that maintains a fixed width-to-height ratio for media (Radix AspectRatio wrapper).
 *
 * Vendored shadcn-style UI primitive (Radix UI + Tailwind CSS).
 */

import * as AspectRatioPrimitive from "@radix-ui/react-aspect-ratio"

/** Container that keeps a fixed aspect ratio. */
function AspectRatio({
  ...props
}: React.ComponentProps<typeof AspectRatioPrimitive.Root>) {
  return <AspectRatioPrimitive.Root data-slot="aspect-ratio" {...props} />
}

export { AspectRatio }
