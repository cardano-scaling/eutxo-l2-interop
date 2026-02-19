import { useEffect, useRef, useState, useCallback } from "react";
import type { DemoEvent } from "@/lib/types";

export function useWebSocket() {
  const [events, setEvents] = useState<DemoEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    // Close any leftover connection (handles StrictMode remount)
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    function connect() {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onopen = () => { if (!cancelled) setConnected(true); };
      ws.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (msg) => {
        if (cancelled) return;
        try {
          const event: DemoEvent = JSON.parse(msg.data);
          setEvents((prev) => [...prev.slice(-199), event]);
        } catch { /* ignore */ }
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect from firing
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { events, connected, clearEvents };
}
