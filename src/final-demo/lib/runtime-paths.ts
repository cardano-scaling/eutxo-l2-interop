import { join } from "node:path";

export function configPath(...parts: string[]): string {
  return join(process.cwd(), "config", ...parts);
}

export function credentialsPath(actor: string, filename: string): string {
  return join(process.cwd(), "credentials", actor, filename);
}

export function startupTimePath(): string {
  return join(process.cwd(), "startup_time.txt");
}

