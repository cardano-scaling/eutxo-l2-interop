/**
 * Global slot configuration initialization
 * This must be imported at the top of any file that uses Lucid with Custom network
 * to ensure SLOT_CONFIG_NETWORK is set before any module imports that use it
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SLOT_CONFIG_NETWORK } from '@lucid-evolution/plutus'

// Setup slot config for Custom network - mirror offchain approach exactly
const startupTime = readFileSync(join(process.cwd(), '../infra/startup_time.txt'), 'utf8')
const startupTimeMs = parseInt(startupTime)

// Mutate existing object properties to ensure same object reference across all modules
SLOT_CONFIG_NETWORK["Custom"].zeroTime = startupTimeMs
SLOT_CONFIG_NETWORK["Custom"].zeroSlot = 0
SLOT_CONFIG_NETWORK["Custom"].slotLength = 1000

// Export a function to ensure it's set (can be called multiple times safely)
export function ensureSlotConfig() {
  if (SLOT_CONFIG_NETWORK["Custom"].zeroTime === 0) {
    SLOT_CONFIG_NETWORK["Custom"].zeroTime = startupTimeMs
    SLOT_CONFIG_NETWORK["Custom"].zeroSlot = 0
    SLOT_CONFIG_NETWORK["Custom"].slotLength = 1000
  }
}

// Execute immediately to set it at module load time
ensureSlotConfig()

