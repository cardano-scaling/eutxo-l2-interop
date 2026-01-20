"use client";

import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getAllTopologies, TopologyConfig } from "@/lib/topologies";
import { validateTopology } from "@/lib/validate-topology";
import { setSelectedTopology as saveSelectedTopology, TopologyId } from "@/lib/config";

type TopologySelectorProps = {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  onValidSelection: (topologyId: TopologyId) => void;
  nonDismissible?: boolean;
};

export function TopologySelector({
  open,
  onOpenChange,
  onValidSelection,
  nonDismissible = false,
}: TopologySelectorProps) {
  const [selectedTopology, setSelectedTopology] = React.useState<TopologyId | null>(null);
  const [isValidating, setIsValidating] = React.useState(false);
  const [validationErrors, setValidationErrors] = React.useState<string[]>([]);

  const topologies = getAllTopologies();

  const handleSelectTopology = (topologyId: TopologyId) => {
    setSelectedTopology(topologyId);
    setValidationErrors([]);
  };

  const handleValidate = async () => {
    if (!selectedTopology) return;

    const topology = topologies.find((t) => t.id === selectedTopology);
    if (!topology) return;

    setIsValidating(true);
    setValidationErrors([]);

    try {
      const result = await validateTopology(topology.heads);

      if (result.valid) {
        // Save to cookie (backend) and localStorage (frontend)
        await fetch('/api/topology', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topology: selectedTopology }),
        });
        saveSelectedTopology(selectedTopology);
        
        // Dispatch custom event to notify other components
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('topology-changed'));
        }
        
        onValidSelection(selectedTopology);
        
        // Close dialog only if dismissible
        if (!nonDismissible && onOpenChange) {
          onOpenChange(false);
        }
      } else {
        // Show errors, stay in dialog
        setValidationErrors(result.errors);
      }
    } catch (error) {
      setValidationErrors([
        error instanceof Error
          ? `Validation error: ${error.message}`
          : "Unknown error occurred during validation",
      ]);
    } finally {
      setIsValidating(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    // Only allow closing if not non-dismissible
    if (nonDismissible && !newOpen) {
      return;
    }
    if (onOpenChange) {
      onOpenChange(newOpen);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        showCloseButton={!nonDismissible}
      >
        <DialogHeader>
          <DialogTitle>Select Topology</DialogTitle>
          <DialogDescription>
            Choose a Hydra topology to connect to. The selected topology will be
            validated to ensure all nodes are running.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {topologies.map((topology) => {
              const isSelected = selectedTopology === topology.id;
              const isSelectedAndValidating = isSelected && isValidating;

              return (
                <Card
                  key={topology.id}
                  className={`cursor-pointer transition-all ${
                    isSelected
                      ? "border-primary shadow-md ring-2 ring-primary/20"
                      : "hover:border-muted-foreground/50 hover:shadow-sm"
                  } ${isSelectedAndValidating ? "opacity-75" : ""}`}
                  onClick={() => !isValidating && handleSelectTopology(topology.id)}
                >
                  <CardHeader>
                    <CardTitle className="text-base">{topology.name}</CardTitle>
                    <CardDescription className="text-xs">
                      {topology.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm text-muted-foreground">
                      {topology.heads.length} head{topology.heads.length !== 1 ? "s" : ""}
                    </div>
                    {isSelectedAndValidating && (
                      <div className="mt-2 text-sm text-muted-foreground">
                        Validating...
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {validationErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="mb-2 text-sm font-semibold text-destructive">
                Validation failed:
              </div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-destructive/90">
                {validationErrors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
              <div className="mt-3 text-xs text-muted-foreground">
                Please ensure the Docker containers are running for this topology.
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleValidate}
            disabled={!selectedTopology || isValidating}
            className="w-full sm:w-auto"
          >
            {isValidating ? "Validating..." : "Confirm Selection"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

