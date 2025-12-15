/**
 * User management for HTLC + Vesting client
 * Based on offchain user structure from src/offchain/lib/utils.ts
 */

export type UserName = 'alice' | 'bob' | 'ida'

export type User = {
  name: UserName
  address: string
  nodeUrl: string
  vkHash: string // Verification key hash (hex format)
  skHash: string // Signing key hash (bech32 format for reference)
}

/**
 * User configuration mapping
 * Node URLs match the offchain structure:
 * - alice: http://127.0.0.1:4001
 * - bob: http://127.0.0.1:4002
 * - ida: depends on head (4003 for head 1, 4004 for head 2)
 * 
 * Credentials from adhoc:verify output
 */
export const users: Record<UserName, User> = {
  alice: {
    name: 'alice',
    address: 'addr_test1vzqdn97wxxuem2ukec6fswslmknuj2zlcwhuz2wfqvkdcgq9235ym',
    nodeUrl: 'http://127.0.0.1:4001',
    vkHash: '80d997ce31b99dab96ce34983a1fdda7c9285fc3afc129c9032cdc20',
    skHash: 'ed25519_sk1y3gjpn0nx0uw56g3fg4n7pduhsx4er5ysm9ffspqvg74ej5z9czqpvcjja',
  },
  bob: {
    name: 'bob',
    address: 'addr_test1vz5hhyn6ecl66a2ca3cwfnwu8ddnp24hakfq2k37rhk28ysk8g0wz',
    nodeUrl: 'http://127.0.0.1:4002',
    vkHash: 'a97b927ace3fad7558ec70e4cddc3b5b30aab7ed92055a3e1deca392',
    skHash: 'ed25519_sk1h5y66nuce5grupv6kck30f48mystzmvlpmknad4h05723asacytsmxxw96',
  },
  ida: {
    name: 'ida',
    address: 'addr_test1vruw26lgqedpwgfh0gu2qatjr90nccd4an54ew9xgr6v90g7uyt4z',
    // ida's node URL depends on which head they're on
    // This will be determined by the current head context
    nodeUrl: 'http://127.0.0.1:4003', // Default to head 1
    vkHash: 'f8e56be8065a1721377a38a07572195f3c61b5ece95cb8a640f4c2bd',
    skHash: 'ed25519_sk1emahhlsxupxwars8p6gtvvl5axchwn9mceymu9uzp9wur0dd4lnquszya6',
  },
}

/**
 * Get user by name
 */
export function getUser(name: UserName): User {
  return users[name]
}

/**
 * Get all users
 */
export function getAllUsers(): User[] {
  return Object.values(users)
}

/**
 * Get user's node URL for a specific head
 * For ida, the node URL depends on the head number
 */
export function getUserNodeUrl(name: UserName, headNumber: 1 | 2 = 1): string {
  if (name === 'ida') {
    return headNumber === 1
      ? 'http://127.0.0.1:4003'
      : 'http://127.0.0.1:4004'
  }
  return users[name].nodeUrl
}
