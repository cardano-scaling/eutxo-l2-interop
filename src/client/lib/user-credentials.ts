/**
 * Helper functions to load user credentials from files
 * Used in API routes (server-side only)
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CML } from '@lucid-evolution/lucid'
import { UserName } from './users'

/**
 * Load user's private key from credentials file
 */
export function loadUserPrivateKey(name: UserName): CML.PrivateKey {
  // In Next.js API routes, process.cwd() is the client directory (src/client)
  // Go up one level to src/, then into infra/credentials
  const skPath = join(process.cwd(), '../infra/credentials', name, `${name}-funds.sk`)
  const sk = JSON.parse(readFileSync(skPath, 'utf8'))
  const skBytes = Buffer.from(sk.cborHex, 'hex')
  return CML.PrivateKey.from_normal_bytes(skBytes.subarray(2))
}

/**
 * Load user's public key from credentials file
 */
export function loadUserPublicKey(name: UserName): CML.PublicKey {
  // In Next.js API routes, process.cwd() is the client directory (src/client)
  // Go up one level to src/, then into infra/credentials
  const vkPath = join(process.cwd(), '../infra/credentials', name, `${name}-funds.vk`)
  const vk = JSON.parse(readFileSync(vkPath, 'utf8'))
  const vkBytes = Buffer.from(vk.cborHex, 'hex')
  return CML.PublicKey.from_bytes(vkBytes.subarray(2))
}
