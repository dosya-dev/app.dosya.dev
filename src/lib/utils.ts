import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// tailwind-merge does not let an x-axis shorthand (px, mx, inset-x, border-x,
// scroll-mx, scroll-px) override the logical start/end utilities. Without
// this, converting a physical margin utility to its logical form would change which class wins against a
// later `mx-auto` in left-to-right layouts.
const twMerge = extendTailwindMerge({
  extend: {
    conflictingClassGroups: {
      px: ["ps", "pe"],
      mx: ["ms", "me"],
      "inset-x": ["start", "end"],
      "border-w-x": ["border-w-s", "border-w-e"],
      "border-color-x": ["border-color-s", "border-color-e"],
      "scroll-mx": ["scroll-ms", "scroll-me"],
      "scroll-px": ["scroll-ps", "scroll-pe"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
