/**
 * Demo backend — Deno HTTP + WebSocket server.
 *
 * Run from src/onchain/tests/:
 *   deno run --allow-net --allow-read server.ts
 *
 * Endpoints:
 *   GET  /api/status     — full state snapshot
 *   GET  /api/events     — event history
 *   POST /api/connect    — load credentials + connect to heads
 *   POST /api/commit     — init + commit L1 funds to open heads
 *   POST /api/wrap       — wrap 5 ADA in both heads
 *   POST /api/unwrap     — unwrap (happy path)
 *   POST /api/dispute    — dispute in both heads
 *   POST /api/close      — close & fanout + wait L1
 *   POST /api/merge      — merge disputed UTXOs on L1
 *   GET  /ws             — WebSocket for real-time events
 */

import { state } from "./state.ts";
import {
  getStatus,
  getEvents,
  actionConnect,
  actionCommit,
  actionWrap,
  actionUnwrap,
  actionDispute,
  actionClose,
  actionMerge,
} from "./routes.ts";

const PORT = 3001;

// ============================================================
// WebSocket clients
// ============================================================

const wsClients = new Set<WebSocket>();

state.subscribe((event) => {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    } catch { /* ignore dead sockets */ }
  }
});

// ============================================================
// HTTP Handler
// ============================================================

function cors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return cors(new Response(null, { status: 204 }));
  }

  // WebSocket upgrade
  if (path === "/ws") {
    const { socket, response } = Deno.upgradeWebSocket(req);
    wsClients.add(socket);
    socket.onclose = () => wsClients.delete(socket);
    socket.onerror = () => wsClients.delete(socket);
    return response;
  }

  let response: Response;

  // REST routes
  switch (true) {
    case req.method === "GET" && path === "/api/status":
      response = await getStatus();
      break;
    case req.method === "GET" && path === "/api/events":
      response = getEvents();
      break;
    case req.method === "POST" && path === "/api/connect":
      response = await actionConnect();
      break;
    case req.method === "POST" && path === "/api/commit":
      response = await actionCommit();
      break;
    case req.method === "POST" && path === "/api/wrap":
      response = await actionWrap();
      break;
    case req.method === "POST" && path === "/api/unwrap":
      response = await actionUnwrap();
      break;
    case req.method === "POST" && path === "/api/dispute":
      response = await actionDispute();
      break;
    case req.method === "POST" && path === "/api/close":
      response = await actionClose();
      break;
    case req.method === "POST" && path === "/api/merge":
      response = await actionMerge();
      break;
    default:
      response = new Response("Not Found", { status: 404 });
  }

  return cors(response);
}

// ============================================================
// Start
// ============================================================

console.log(`Demo backend listening on http://localhost:${PORT}`);
console.log(`WebSocket available at ws://localhost:${PORT}/ws`);
Deno.serve({ port: PORT }, handler);
