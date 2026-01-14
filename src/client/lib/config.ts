import { TopologyId, getTopologyConfig } from "./topologies";
import { validateTopology } from "./validate-topology";

// Re-export for convenience
export type { TopologyId } from "./topologies";

export type HydraHeadConfig = {
  name: string;
  route: string;
  headId: string;
  tag: string;
  httpUrl: string;
};

const STORAGE_KEY = "hydra-topology";

/**
 * Get the selected topology ID from localStorage
 */
export function getSelectedTopology(): TopologyId | null {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && (stored === "two-heads" || stored === "single-path" || stored === "hub-and-spoke")) {
    return stored as TopologyId;
  }
  return null;
}

/**
 * Set the selected topology ID in localStorage
 */
export function setSelectedTopology(topologyId: TopologyId): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, topologyId);
  // Dispatch custom event to notify components about topology change
  window.dispatchEvent(new Event('topology-changed'));
}

/**
 * Clear the selected topology from localStorage
 */
export function clearSelectedTopology(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  // Dispatch custom event to notify components about topology change
  window.dispatchEvent(new Event('topology-changed'));
}

/**
 * Get the current hydra heads configuration based on selected topology
 * Returns empty array if no topology is selected
 */
export function getHydraHeads(): HydraHeadConfig[] {
  const topologyId = getSelectedTopology();
  if (!topologyId) {
    return [];
  }
  const config = getTopologyConfig(topologyId);
  return config.heads;
}

// Export validateTopology for convenience
export { validateTopology } from "./validate-topology";
