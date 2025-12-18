import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatId(value: string, head = 6, tail = 6) {
  if (!value) return ""
  if (value.length <= head + tail) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}
