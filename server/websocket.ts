import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

export type WSMessageType = 
  | "market_update"
  | "prediction_update"
  | "accuracy_update"
  | "system_status"
  | "suggestion_update"
  | "precision_trade_executed"
  | "auto_trade_executed"
  | "suggestion_accuracy_update";

export interface WSMessage {
  type: WSMessageType;
  symbol?: string;
  data: unknown;
  timestamp: string;
}

interface ClientInfo {
  ws: WebSocket;
  subscribedSymbols: Set<string>;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientInfo> = new Map();

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws) => {
      const clientInfo: ClientInfo = {
        ws,
        subscribedSymbols: new Set(),
      };
      this.clients.set(ws, clientInfo);
      console.log(`[WebSocket] Client connected. Total clients: ${this.clients.size}`);

      ws.send(JSON.stringify({
        type: "connected",
        message: "Connected to Trady WebSocket",
        timestamp: new Date().toISOString(),
      }));

      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        console.log(`[WebSocket] Client disconnected. Total clients: ${this.clients.size}`);
      });

      ws.on("error", (error) => {
        console.error("[WebSocket] Client error:", error);
        this.clients.delete(ws);
      });
    });

    console.log("[WebSocket] Server initialized on /ws");
  }

  private handleMessage(ws: WebSocket, message: { type: string; symbol?: string }): void {
    const clientInfo = this.clients.get(ws);
    if (!clientInfo) return;

    switch (message.type) {
      case "ping":
        ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
        break;
      case "subscribe":
        if (message.symbol) {
          clientInfo.subscribedSymbols.add(message.symbol);
          console.log(`[WebSocket] Client subscribed to ${message.symbol}. Subscriptions: ${Array.from(clientInfo.subscribedSymbols).join(", ")}`);
          ws.send(JSON.stringify({ 
            type: "subscribed", 
            symbol: message.symbol,
            timestamp: new Date().toISOString() 
          }));
        }
        break;
      case "unsubscribe":
        if (message.symbol) {
          clientInfo.subscribedSymbols.delete(message.symbol);
          console.log(`[WebSocket] Client unsubscribed from ${message.symbol}`);
          ws.send(JSON.stringify({ 
            type: "unsubscribed", 
            symbol: message.symbol,
            timestamp: new Date().toISOString() 
          }));
        }
        break;
      default:
        console.log("[WebSocket] Unknown message type:", message.type);
    }
  }

  broadcast(message: WSMessage): void {
    if (!this.wss) return;

    const data = JSON.stringify(message);
    let sentCount = 0;

    this.clients.forEach((clientInfo) => {
      const { ws, subscribedSymbols } = clientInfo;
      if (ws.readyState !== WebSocket.OPEN) return;

      const shouldSend = !message.symbol || subscribedSymbols.has(message.symbol);
      
      if (shouldSend) {
        ws.send(data);
        sentCount++;
      }
    });

    if (sentCount > 0) {
      console.log(`[WebSocket] Broadcast ${message.type}${message.symbol ? ` (${message.symbol})` : ""} to ${sentCount} clients`);
    }
  }

  broadcastMarketUpdate(symbol: string, data: unknown): void {
    this.broadcast({
      type: "market_update",
      symbol,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastPredictionUpdate(symbol: string, data: unknown): void {
    this.broadcast({
      type: "prediction_update",
      symbol,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastAccuracyUpdate(symbol: string, data: unknown): void {
    this.broadcast({
      type: "accuracy_update",
      symbol,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  broadcastSystemStatus(data: unknown): void {
    this.broadcast({
      type: "system_status",
      data,
      timestamp: new Date().toISOString(),
    });
  }

  getClientCount(): number {
    return this.clients.size;
  }
}

export const wsService = new WebSocketService();
