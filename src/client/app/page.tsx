"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TopologySelector } from "@/components/topology-selector";
import {
  getHydraHeads,
  getSelectedTopology,
  validateTopology,
  clearSelectedTopology,
  TopologyId,
} from "@/lib/config";
import { getTopologyConfig } from "@/lib/topologies";
import { formatId } from "@/lib/utils";

export default function Home() {
  const [hydraHeads, setHydraHeads] = React.useState(getHydraHeads());
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [isValidating, setIsValidating] = React.useState(true);
  const [hasValidTopology, setHasValidTopology] = React.useState(false);

  // Check topology on mount
  React.useEffect(() => {
    checkTopology();
  }, []);

  const checkTopology = async () => {
    setIsValidating(true);
    const topologyId = getSelectedTopology();

    if (!topologyId) {
      // No topology selected, show dialog (non-dismissible)
      setDialogOpen(true);
      setHasValidTopology(false);
      setIsValidating(false);
      return;
    }

    // Validate the selected topology
    const config = getTopologyConfig(topologyId);
    const result = await validateTopology(config.heads);

    if (result.valid) {
      // Topology is valid, load heads
      setHydraHeads(getHydraHeads());
      setHasValidTopology(true);
      setDialogOpen(false);
    } else {
      // Topology is invalid, clear and show dialog
      clearSelectedTopology();
      setHydraHeads([]);
      setHasValidTopology(false);
      setDialogOpen(true);
    }

    setIsValidating(false);
  };

  const handleValidSelection = (topologyId: TopologyId) => {
    // Reload heads and close dialog
    setHydraHeads(getHydraHeads());
    setHasValidTopology(true);
    setDialogOpen(false);
    setIsValidating(false);
  };

  // Show loading state while validating
  if (isValidating) {
    return (
      <main className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
          <div className="text-lg text-muted-foreground">Validating topology...</div>
        </div>
      </main>
    );
  }

  // Determine if dialog should be non-dismissible (no valid topology exists)
  const nonDismissible = !hasValidTopology;

  return (
    <>
      <main className="p-6 max-w-6xl mx-auto">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-semibold leading-tight">
                  HTLC Multihead Topologies Demo
                </h1>
                <p className="text-muted-foreground">
                  Select a Hydra head to open its dashboard.
                </p>
              </div>
            </div>
          </div>

          {hydraHeads.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2">
              {hydraHeads.map((head) => (
                <Card key={head.headId} className="hover:shadow-md transition-shadow">
                  <CardContent className="flex flex-col items-center space-y-4 p-6">
                    <p className="text-base font-semibold">{head.name}</p>
                    <div className="text-center space-y-1">
                      <div className="text-base text-muted-foreground">
                        Head ID: {formatId(head.headId)}
                      </div>
                      <div className="text-base text-muted-foreground">
                        Status:{" "}
                        <span className={head.tag === "Open" ? "text-green-600" : ""}>
                          {head.tag}
                        </span>
                      </div>
                    </div>
                    <Button asChild className="w-full">
                      <Link href={`/${head.route}`}>Join</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
              <div className="text-lg text-muted-foreground">
                No topology selected or nodes are not running.
              </div>
              <Button onClick={() => setDialogOpen(true)} variant="outline">
                Select Topology
              </Button>
            </div>
          )}
        </div>
      </main>

      <TopologySelector
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onValidSelection={handleValidSelection}
        nonDismissible={nonDismissible}
      />
    </>
  );
}
