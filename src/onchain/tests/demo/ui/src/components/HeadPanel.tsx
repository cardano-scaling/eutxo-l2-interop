import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { HeadState, UtxoInfo, DemoSnapshot } from "@/lib/types";

interface Props {
  name: string;
  head: HeadState;
  wrappedAddress: string;
  color: string;
  participants?: DemoSnapshot["participants"];
}

function truncate(s: string, n = 16): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function lovelaceDisplay(lovelace: string): string {
  const n = Number(BigInt(lovelace)) / 1_000_000;
  return n.toFixed(1) + " ₳";
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Open": return "default";
    case "Closed": case "Final": return "destructive";
    default: return "secondary";
  }
}

/** Try to detect disputed flag from inline datum (CBOR hex). Very simple heuristic. */
function isDatumDisputed(datum?: string): boolean {
  if (!datum) return false;
  // The datum contains "disputed: bool" — in Plutus Data encoding,
  // Constructor(1,[]) = true is encoded as d87a80 in CBOR hex.
  // We look for the disputed=true pattern. This is a lightweight check
  // that avoids pulling in a full CBOR decoder on the frontend.
  // A more robust approach: backend could enrich UTXOs with parsed datum info.
  // For now we use the fact that disputed=true appears late in the datum.
  // Actually let's just check if the datum hex contains "d87a80" which is True.
  // The non-disputed datum contains "d87980" for False at the disputed position.
  // Since disputed is one of the last fields, we check the last portion.
  return datum.includes("d87a80");
}

function ownerName(
  address: string,
  participants?: DemoSnapshot["participants"],
): string | null {
  if (!participants) return null;
  if (address === participants.alice.address) return "Alice";
  if (address === participants.ida.address) return "Ida";
  if (address === participants.bob.address) return "Bob";
  return null;
}

const OWNER_COLORS: Record<string, string> = {
  Alice: "#ef4444",
  Ida: "#14b8a6",
  Bob: "#f97316",
};

export function HeadPanel({ name, head, wrappedAddress, color, participants }: Props) {
  const scriptUtxos = head.utxos.filter(u => u.address === wrappedAddress);
  const walletUtxos = head.utxos.filter(u => u.address !== wrappedAddress);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" style={{ color }}>{name}</CardTitle>
          <Badge variant={statusVariant(head.status)}>{head.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {head.utxos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No UTXOs</p>
        ) : (
          <>
            {scriptUtxos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-purple-500 mb-1">🔒 Wrapped ({scriptUtxos.length})</p>
                {scriptUtxos.map((u: UtxoInfo, i: number) => {
                  const disputed = isDatumDisputed(u.datum);
                  return (
                    <div key={i} className="text-xs text-muted-foreground ml-2 flex items-center gap-1">
                      <span>{truncate(u.txHash)}#{u.outputIndex}: {lovelaceDisplay(u.assets.lovelace)}</span>
                      {disputed && (
                        <Badge variant="destructive" className="text-[10px] px-1 py-0 h-4">
                          disputed
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {walletUtxos.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">Wallet ({walletUtxos.length})</p>
                {walletUtxos.slice(0, 5).map((u: UtxoInfo, i: number) => {
                  const owner = ownerName(u.address, participants);
                  return (
                    <div key={i} className="text-xs text-muted-foreground ml-2 flex items-center gap-1">
                      {owner && (
                        <span className="font-semibold" style={{ color: OWNER_COLORS[owner] }}>{owner}</span>
                      )}
                      <span>{lovelaceDisplay(u.assets.lovelace)}</span>
                      <span className="opacity-50">{truncate(u.txHash, 8)}#{u.outputIndex}</span>
                    </div>
                  );
                })}
                {walletUtxos.length > 5 && (
                  <div className="text-xs text-muted-foreground ml-2">+{walletUtxos.length - 5} more</div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
