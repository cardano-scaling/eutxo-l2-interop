import { cookies } from 'next/headers'
import { TopologyId, getTopologyConfig } from './topologies'
import { HydraHeadConfig } from './config'

const COOKIE_NAME = 'hydra-topology'

/**
 * Get the current topology ID from cookies (server-side only)
 * Returns null if no valid topology is found
 */
export async function getTopologyFromCookie(): Promise<TopologyId | null> {
  const cookieStore = await cookies()
  const topology = cookieStore.get(COOKIE_NAME)?.value as TopologyId | undefined
  
  if (!topology || !['two-heads', 'single-path', 'hub-and-spoke'].includes(topology)) {
    return null
  }
  
  return topology
}

/**
 * Get the head config for a specific route from the topology cookie
 * Returns null if topology or head not found
 */
export async function getHeadConfigFromCookie(headRoute: string): Promise<{ topologyId: TopologyId; headConfig: HydraHeadConfig } | null> {
  const topologyId = await getTopologyFromCookie()
  
  if (!topologyId) {
    return null
  }
  
  const topology = getTopologyConfig(topologyId)
  const headConfig = topology.heads.find((head) => head.route === headRoute)
  
  if (!headConfig) {
    return null
  }
  
  return { topologyId, headConfig }
}

/**
 * Get the first available node URL from a head config
 * Since all nodes in a head share the same state, any node can be used
 */
export function getHeadNodeUrl(headConfig: HydraHeadConfig): string {
  const nodeEntries = Object.entries(headConfig.nodes)
  const firstNode = nodeEntries.find(([_, url]) => url)
  
  if (!firstNode || !firstNode[1]) {
    throw new Error(`No node URL found for head ${headConfig.name}`)
  }
  
  return firstNode[1]
}
