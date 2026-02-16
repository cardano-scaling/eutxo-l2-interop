import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DemoPhase } from "@/lib/types";
import { PHASE_LABELS } from "@/lib/types";

interface Props {
  phase: DemoPhase;
  loading: boolean;
  busy: boolean;
  busyAction: string;
  hasL1ScriptUtxos: boolean;
  error: string | null;
  onAction: (action: string) => void;
  onRefresh: () => void;
}

interface ActionDef {
  action: string;
  label: string;
  description: string;
  enabledPhases: DemoPhase[];
  variant: "default" | "destructive" | "outline" | "secondary";
}

const ACTION_LABELS: Record<string, string> = {
  connect: "Connecting…",
  commit: "Committing…",
  wrap: "Wrapping…",
  unwrap: "Unwrapping…",
  dispute: "Disputing…",
  close: "Closing…",
  merge: "Merging…",
};

const ACTIONS: ActionDef[] = [
  {
    action: "connect",
    label: "🔌 Connect",
    description: "Load credentials & connect to Hydra heads",
    enabledPhases: ["idle"],
    variant: "default",
  },
  {
    action: "commit",
    label: "📥 Commit",
    description: "Init + commit L1 funds into both heads",
    enabledPhases: ["initializing"],
    variant: "default",
  },
  {
    action: "wrap",
    label: "📦 Wrap",
    description: "Lock 5 ADA in both heads (Alice in A, Ida in B)",
    enabledPhases: ["heads_open"],
    variant: "default",
  },
  {
    action: "unwrap",
    label: "🔓 Unwrap",
    description: "Owner reclaims funds in-head",
    enabledPhases: ["wrapped"],
    variant: "outline",
  },
  {
    action: "dispute",
    label: "⚡ Dispute",
    description: "Mark wrapped UTXOs as disputed",
    enabledPhases: ["wrapped"],
    variant: "destructive",
  },
  {
    action: "close",
    label: "🚪 Close Heads",
    description: "Close & fanout both heads, wait for L1 settlement",
    enabledPhases: ["disputed", "unwrapped"],
    variant: "default",
  },
  {
    action: "merge",
    label: "🔗 Merge on L1",
    description: "Merge disputed UTXOs back to owners on L1",
    enabledPhases: ["closed"],
    variant: "default",
  },
];

export function ActionPanel({ phase, loading, busy, busyAction, hasL1ScriptUtxos, error, onAction, onRefresh }: Props) {
  const blocked = loading || busy;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Actions</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{PHASE_LABELS[phase]}</Badge>
            <Button variant="ghost" size="sm" onClick={onRefresh} disabled={blocked}>
              🔄
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {ACTIONS.map(({ action, label, description, enabledPhases, variant }) => {
          // Merge is always available when there are script UTXOs on L1
          const phaseMatch = action === "merge"
            ? (enabledPhases.includes(phase) || hasL1ScriptUtxos)
            : enabledPhases.includes(phase);
          const enabled = phaseMatch && !blocked;
          const isRunning = busy && busyAction === action;
          return (
            <div key={action}>
              <Button
                variant={variant}
                size="sm"
                className="w-full justify-start"
                disabled={!enabled}
                onClick={() => onAction(action)}
              >
                {isRunning ? `⏳ ${ACTION_LABELS[action] || "Working…"}` : label}
              </Button>
              <p className="text-xs text-muted-foreground mt-0.5 ml-1">{description}</p>
            </div>
          );
        })}

        {busy && (
          <div className="mt-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded text-sm text-yellow-700 dark:text-yellow-400 flex items-center gap-2">
            <span className="animate-spin">⏳</span>
            <span>{ACTION_LABELS[busyAction] || "Action in progress…"}</span>
          </div>
        )}

        {error && (
          <div className="mt-3 p-2 bg-destructive/10 rounded text-sm text-destructive">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
