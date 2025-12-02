import { useEffect, useState, useCallback, useRef } from "react";

export type WSConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export interface WSMessage {
  type: string;
  symbol?: string;
  data?: unknown;
  timestamp?: string;
  message?: string;
}

interface UseWebSocketOptions {
  symbol?: string;
  onMessage?: (message: WSMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  autoReconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

interface UseWebSocketReturn {
  status: WSConnectionStatus;
  lastMessage: WSMessage | null;
  sendMessage: (message: object) => void;
  subscribe: (symbol: string) => void;
  unsubscribe: (symbol: string) => void;
  reconnect: () => void;
  disconnect: () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    symbol,
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    autoReconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const [status, setStatus] = useState<WSConnectionStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef(false);
  const currentSymbolRef = useRef<string | undefined>(symbol);
  const pendingSubscriptionRef = useRef<string | undefined>(undefined);

  const getWebSocketUrl = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    clearReconnectTimeout();
    setStatus("connecting");

    try {
      const ws = new WebSocket(getWebSocketUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (isUnmountedRef.current) {
          ws.close();
          return;
        }
        setStatus("connected");
        reconnectAttemptsRef.current = 0;
        
        if (pendingSubscriptionRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", symbol: pendingSubscriptionRef.current }));
          pendingSubscriptionRef.current = undefined;
        } else if (currentSymbolRef.current) {
          ws.send(JSON.stringify({ type: "subscribe", symbol: currentSymbolRef.current }));
        }
        
        onConnect?.();
      };

      ws.onmessage = (event) => {
        if (isUnmountedRef.current) return;
        try {
          const message = JSON.parse(event.data) as WSMessage;
          setLastMessage(message);
          onMessage?.(message);
        } catch (error) {
          console.error("[WebSocket] Error parsing message:", error);
        }
      };

      ws.onclose = () => {
        if (isUnmountedRef.current) return;
        setStatus("disconnected");
        onDisconnect?.();

        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          console.log(`[WebSocket] Reconnecting (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})...`);
          reconnectTimeoutRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        if (isUnmountedRef.current) return;
        setStatus("error");
        onError?.(error);
      };
    } catch (error) {
      console.error("[WebSocket] Connection error:", error);
      setStatus("error");
    }
  }, [
    getWebSocketUrl,
    clearReconnectTimeout,
    autoReconnect,
    reconnectInterval,
    maxReconnectAttempts,
    onConnect,
    onDisconnect,
    onMessage,
    onError,
  ]);

  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    reconnectAttemptsRef.current = maxReconnectAttempts;
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [clearReconnectTimeout, maxReconnectAttempts]);

  const reconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setTimeout(connect, 100);
  }, [disconnect, connect]);

  const sendMessage = useCallback((message: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[WebSocket] Cannot send message - not connected");
    }
  }, []);

  const subscribe = useCallback((sym: string) => {
    currentSymbolRef.current = sym;
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "subscribe", symbol: sym }));
    } else {
      pendingSubscriptionRef.current = sym;
    }
  }, []);

  const unsubscribe = useCallback((sym: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "unsubscribe", symbol: sym }));
    }
    if (currentSymbolRef.current === sym) {
      currentSymbolRef.current = undefined;
    }
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    return () => {
      isUnmountedRef.current = true;
      clearInterval(pingInterval);
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, clearReconnectTimeout]);

  useEffect(() => {
    if (symbol && symbol !== currentSymbolRef.current) {
      if (currentSymbolRef.current) {
        unsubscribe(currentSymbolRef.current);
      }
      subscribe(symbol);
    }
  }, [symbol, subscribe, unsubscribe]);

  return {
    status,
    lastMessage,
    sendMessage,
    subscribe,
    unsubscribe,
    reconnect,
    disconnect,
  };
}
