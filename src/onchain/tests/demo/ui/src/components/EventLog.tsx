import { useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import type { DemoEvent } from "@/lib/types";

interface Props {
  events: DemoEvent[];
  connected: boolean;
  onClear: () => void;
}

const ICONS: Record<DemoEvent["type"], string> = {
  info: "🔵",
  success: "✅",
  error: "🔴",
  warn: "🟡",
  action: "⚡",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function EventLog({ events, connected, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Event Log</CardTitle>
            <span className={`inline-block w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
            <span className="text-xs text-muted-foreground">{connected ? "connected" : "disconnected"}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-48">
          <div className="space-y-1 font-mono text-xs">
            {events.length === 0 ? (
              <p className="text-muted-foreground">No events yet. Click Connect to start.</p>
            ) : (
              events.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground whitespace-nowrap">{formatTime(e.timestamp)}</span>
                  <span>{ICONS[e.type]}</span>
                  <span className={e.type === "error" ? "text-destructive" : ""}>{e.message}</span>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
