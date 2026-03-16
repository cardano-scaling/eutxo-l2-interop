import { readFileSync } from "node:fs";
import { SLOT_CONFIG_NETWORK } from "@lucid-evolution/plutus";
import { startupTimePath } from "@/lib/runtime-paths";

let initialized = false;
let lastStartupTimeMs = 0;

function readStartupTimeMs(): number {
  const raw = readFileSync(startupTimePath(), "utf8").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid startup_time.txt content: ${raw}`);
  }
  return parsed;
}

export function ensureHydraSlotConfig() {
  const startupTimeMs = readStartupTimeMs();
  if (initialized && startupTimeMs === lastStartupTimeMs) return;
  SLOT_CONFIG_NETWORK.Custom.zeroTime = startupTimeMs;
  SLOT_CONFIG_NETWORK.Custom.zeroSlot = 0;
  SLOT_CONFIG_NETWORK.Custom.slotLength = 1000;
  initialized = true;
  lastStartupTimeMs = startupTimeMs;
}

