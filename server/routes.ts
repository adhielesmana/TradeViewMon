import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scheduler } from "./scheduler";
import { marketDataService } from "./market-data-service";
import { technicalIndicators } from "./technical-indicators";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const symbol = marketDataService.getSymbol();

  app.get("/api/market/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 60;
      const data = await storage.getRecentMarketData(symbol, limit);
      res.json(data);
    } catch (error) {
      console.error("Error fetching recent market data:", error);
      res.status(500).json({ error: "Failed to fetch market data" });
    }
  });

  app.get("/api/market/stats", async (req, res) => {
    try {
      const stats = await storage.getMarketStats(symbol);
      if (!stats) {
        return res.status(404).json({ error: "No market data available" });
      }
      res.json(stats);
    } catch (error) {
      console.error("Error fetching market stats:", error);
      res.status(500).json({ error: "Failed to fetch market stats" });
    }
  });

  app.get("/api/market/historical", async (req, res) => {
    try {
      const period = (req.query.period as string) || "1M";
      
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case "1D":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "1W":
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "1M":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "3M":
          startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        case "6M":
          startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          break;
        case "1Y":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const data = await storage.getMarketDataByTimeRange(symbol, startDate, now);
      
      let sampledData = data;
      if (period !== "1D" && data.length > 500) {
        const step = Math.ceil(data.length / 500);
        sampledData = data.filter((_, index) => index % step === 0);
      }

      res.json(sampledData);
    } catch (error) {
      console.error("Error fetching historical data:", error);
      res.status(500).json({ error: "Failed to fetch historical data" });
    }
  });

  app.get("/api/market/indicators", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      const data = await storage.getRecentMarketData(symbol, limit);
      
      if (data.length === 0) {
        return res.json({
          indicators: [],
          signal: { signal: "HOLD", strength: 0, reasons: [] },
          latest: null,
        });
      }

      const indicators = technicalIndicators.calculateAll(data);
      const latest = indicators[indicators.length - 1];
      const signal = technicalIndicators.generateSignal(latest);

      res.json({
        indicators,
        signal,
        latest,
      });
    } catch (error) {
      console.error("Error calculating indicators:", error);
      res.status(500).json({ error: "Failed to calculate indicators" });
    }
  });

  app.get("/api/predictions/recent", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const predictions = await storage.getRecentPredictions(symbol, limit);
      res.json(predictions);
    } catch (error) {
      console.error("Error fetching predictions:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  app.get("/api/predictions/accuracy", async (req, res) => {
    try {
      const stats = await storage.getAccuracyStats(symbol);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching accuracy stats:", error);
      res.status(500).json({ error: "Failed to fetch accuracy stats" });
    }
  });

  app.get("/api/system/status", async (req, res) => {
    try {
      const status = await storage.getSystemStatus();
      res.json(status);
    } catch (error) {
      console.error("Error fetching system status:", error);
      res.status(500).json({ error: "Failed to fetch system status" });
    }
  });

  app.get("/api/system/stats", async (req, res) => {
    try {
      const stats = await storage.getSystemStats();
      res.json(stats);
    } catch (error) {
      console.error("Error fetching system stats:", error);
      res.status(500).json({ error: "Failed to fetch system stats" });
    }
  });

  app.post("/api/scheduler/start", async (req, res) => {
    try {
      await scheduler.start();
      res.json({ success: true, message: "Scheduler started" });
    } catch (error) {
      console.error("Error starting scheduler:", error);
      res.status(500).json({ error: "Failed to start scheduler" });
    }
  });

  app.post("/api/scheduler/stop", async (req, res) => {
    try {
      await scheduler.stop();
      res.json({ success: true, message: "Scheduler stopped" });
    } catch (error) {
      console.error("Error stopping scheduler:", error);
      res.status(500).json({ error: "Failed to stop scheduler" });
    }
  });

  scheduler.start().catch(console.error);

  return httpServer;
}
