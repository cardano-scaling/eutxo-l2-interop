import { useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TopologyDiagram } from "@/components/TopologyDiagram";
import { HeadPanel } from "@/components/HeadPanel";
import { L1Panel } from "@/components/L1Panel";
import { ActionPanel } from "@/components/ActionPanel";
import { EventLog } from "@/components/EventLog";
import { useApi } from "@/hooks/useApi";
import { useWebSocket } from "@/hooks/useWebSocket";

export default function App() {
  const { snapshot, loading, error, fetchSnapshot, callAction } = useApi();
  const { events, connected, clearEvents } = useWebSocket();

  const handleAction = useCallback(async (action: string) => {
    try {
      await callAction(action);
    } catch {
      // error is already in state
    }
  }, [callAction]);

  const phase = snapshot?.phase || "idle";
  const hasL1ScriptUtxos = (snapshot?.l1?.script?.length ?? 0) > 0;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-7xl mx-auto space-y-4">

          {/* Topology Diagram */}
          <TopologyDiagram snapshot={snapshot} />

          {/* Main grid: Heads + L1 + Actions */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Head A */}
            <HeadPanel
              name="Head A (Alice + Ida)"
              head={snapshot?.headA || { status: "Unknown", utxos: [] }}
              wrappedAddress={snapshot?.wrappedAddress || ""}
              color="#6366f1"
              participants={snapshot?.participants}
            />

            {/* Head B */}
            <HeadPanel
              name="Head B (Bob + Ida)"
              head={snapshot?.headB || { status: "Unknown", utxos: [] }}
              wrappedAddress={snapshot?.wrappedAddress || ""}
              color="#8b5cf6"
              participants={snapshot?.participants}
            />

            {/* L1 */}
            <L1Panel snapshot={snapshot || {
              headA: { status: "Unknown", utxos: [] },
              headB: { status: "Unknown", utxos: [] },
              l1: { alice: [], ida: [], bob: [], script: [] },
              participants: {
                alice: { name: "Alice", address: "", pkh: "" },
                ida: { name: "Ida", address: "", pkh: "" },
                bob: { name: "Bob", address: "", pkh: "" },
              },
              wrappedAddress: "",
              phase: "idle",
              busy: false,
              busyAction: "",
              infraReady: false,
            }} />

            {/* Actions */}
            <ActionPanel
              phase={phase}
              loading={loading}
              busy={snapshot?.busy || false}
              busyAction={snapshot?.busyAction || ""}
              hasL1ScriptUtxos={hasL1ScriptUtxos}
              infraReady={snapshot?.infraReady ?? false}
              error={error}
              onAction={handleAction}
              onRefresh={fetchSnapshot}
            />
          </div>

          {/* Event Log */}
          <EventLog events={events} connected={connected} onClear={clearEvents} />
        </div>
      </div>
    </TooltipProvider>
  );
}
