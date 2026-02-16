import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DemoSnapshot } from "@/lib/types";

interface Props {
  snapshot: DemoSnapshot;
}

function lovelaceToAda(utxos: Array<{ assets: Record<string, string> }>): string {
  const total = utxos.reduce((sum, u) => sum + BigInt(u.assets?.lovelace || "0"), 0n);
  return (Number(total) / 1_000_000).toFixed(2);
}

function truncate(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function ParticipantRow({ name, utxos, color }: { name: string; utxos: Array<{ txHash: string; outputIndex: number; assets: Record<string, string> }>; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color }}>{name}</span>
        <span className="text-sm font-mono">{lovelaceToAda(utxos)} ₳</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {utxos.length} UTXO{utxos.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}

export function L1Panel({ snapshot }: Props) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base text-slate-500">Cardano L1</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ParticipantRow name="Alice" utxos={snapshot.l1.alice} color="#ef4444" />
        <ParticipantRow name="Ida" utxos={snapshot.l1.ida} color="#14b8a6" />
        <ParticipantRow name="Bob" utxos={snapshot.l1.bob} color="#f97316" />

        {snapshot.l1.script.length > 0 && (
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-purple-500">🔒 Script</span>
              <span className="text-sm font-mono">{lovelaceToAda(snapshot.l1.script)} ₳</span>
            </div>
            {snapshot.l1.script.map((u, i) => (
              <div key={i} className="text-xs text-muted-foreground ml-2">
                {truncate(u.txHash)}#{u.outputIndex}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
