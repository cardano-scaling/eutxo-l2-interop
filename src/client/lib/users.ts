/**
 * User management for HTLC + Vesting client
 * Based on offchain user structure from src/offchain/lib/utils.ts
 */

import { getTopologyConfig, TopologyId } from "./topologies"

export type UserName = 'alice' | 'bob' | 'charlie' | 'ida' | 'jon'

export type User = {
  name: UserName
  address: string
  vkHash: string // Verification key hash (hex format)
  skHash: string // Signing key hash (bech32 format for reference)
}

/**
 * User configuration mapping
 */
export const users: Record<UserName, User> = {
  alice: {
    name: 'alice',
    address: 'addr_test1vzqdn97wxxuem2ukec6fswslmknuj2zlcwhuz2wfqvkdcgq9235ym',
    vkHash: '80d997ce31b99dab96ce34983a1fdda7c9285fc3afc129c9032cdc20',
    skHash: 'ed25519_sk1y3gjpn0nx0uw56g3fg4n7pduhsx4er5ysm9ffspqvg74ej5z9czqpvcjja',
  },
  bob: {
    name: 'bob',
    address: 'addr_test1vz5hhyn6ecl66a2ca3cwfnwu8ddnp24hakfq2k37rhk28ysk8g0wz',
    vkHash: 'a97b927ace3fad7558ec70e4cddc3b5b30aab7ed92055a3e1deca392',
    skHash: 'ed25519_sk1h5y66nuce5grupv6kck30f48mystzmvlpmknad4h05723asacytsmxxw96',
  },
  ida: {
    name: 'ida',
    address: 'addr_test1vruw26lgqedpwgfh0gu2qatjr90nccd4an54ew9xgr6v90g7uyt4z',
    // ida's node URL depends on which head they're on
    // This will be determined by the current head context
    vkHash: 'f8e56be8065a1721377a38a07572195f3c61b5ece95cb8a640f4c2bd',
    skHash: 'ed25519_sk1emahhlsxupxwars8p6gtvvl5axchwn9mceymu9uzp9wur0dd4lnquszya6',
  },
  charlie: {
    name: 'charlie',
    address: 'addr_test1vpewv3suua9003u2tav82nl2gx0atkgwdjanh2srxln4z4qahfpfm',
    vkHash: '72e6461ce74af7c78a5f58754fea419fd5d90e6cbb3baa0337e75154',
    skHash: 'ed25519_sk19elca94kqmsusrp0063977k7yh0hkvt7t7dx5rz43suwjl44z3ws3dvqkn',
  },
  jon: {
    name: 'jon',
    address: 'addr_test1vp9n0x2heemntaey6ycygk3wvuxtll2lqpsxc4mjxy34czqpcztw7',
    vkHash: '4b379957ce7735f724d130445a2e670cbffd5f00606c577231235c08',
    skHash: 'ed25519_sk1y5qmgv4yc6ge2t6uc380y8774j9hqg7fd7a6hmdatngt6ydnarusg7yyr7',
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
 */
export function getUserNodeUrl(
  name: UserName,
  topology: TopologyId,
  head: "a" | "b" | "c",
): string {
  const nodeUrl = getTopologyConfig(topology).heads
    .find(({ route }) => route === `head-${head}`)?.nodes[name];
  if (!nodeUrl) {
    throw new Error(`User ${name} not found in topology ${topology} for head ${head}`);
  }
  return nodeUrl;
}
