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
