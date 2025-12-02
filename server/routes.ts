import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scheduler } from "./scheduler";
import { marketDataService } from "./market-data-service";
import { technicalIndicators } from "./technical-indicators";
import { wsService } from "./websocket";
import { backtestingEngine, type BacktestConfig } from "./backtesting";
import { authenticateUser, seedSuperadmin, findUserById, type SafeUser } from "./auth";
import { predictionEngine } from "./prediction-engine";

const DEFAULT_SYMBOL = marketDataService.getSymbol();

declare module "express-session" {
  interface SessionData {
    userId?: string;
    user?: SafeUser;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: "Authentication required" });
  }
  next();
}

function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

function convertToCSV(data: any[], fields: string[]): string {
  if (data.length === 0) return fields.join(",") + "\n";
  
  const header = fields.join(",");
  const rows = data.map(item => 
    fields.map(field => {
      const value = item[field];
      if (value === null || value === undefined) return "";
      if (typeof value === "string" && (value.includes(",") || value.includes('"') || value.includes("\n"))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return String(value);
    }).join(",")
  );
  
  return header + "\n" + rows.join("\n");
}

function getDateRange(period: string): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  let startDate: Date;

  switch (period) {
    case "1D":
      startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
      break;
    case "1W":
      startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case "1M":
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case "3M":
      startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case "6M":
      startDate = new Date(endDate.getTime() - 180 * 24 * 60 * 60 * 1000);
      break;
    case "1Y":
      startDate = new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);
      break;
    default:
      startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  }

  return { startDate, endDate };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedSuperadmin();

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      const user = await authenticateUser(username, password);
      if (!user) {
        return res.status(401).json({ error: "Invalid username or password" });
      }

      req.session.userId = user.id;
      req.session.user = user;

      res.json({ 
        message: "Login successful", 
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        }
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: "Logout failed" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    try {
      const user = await findUserById(req.session.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.get("/api/market/recent", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
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
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
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
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
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
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
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
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const limit = parseInt(req.query.limit as string) || 50;
      const timeframe = req.query.timeframe as string | undefined;
      const predictions = await storage.getRecentPredictions(symbol, limit, timeframe);
      res.json(predictions);
    } catch (error) {
      console.error("Error fetching predictions:", error);
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  app.get("/api/predictions/accuracy", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const timeframe = req.query.timeframe as string | undefined;
      const stats = await storage.getAccuracyStats(symbol, timeframe);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching accuracy stats:", error);
      res.status(500).json({ error: "Failed to fetch accuracy stats" });
    }
  });

  app.get("/api/predictions/multifactor", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const limit = parseInt(req.query.limit as string) || 200;
      
      const marketData = await storage.getRecentMarketData(symbol, limit);
      
      if (marketData.length < 20) {
        return res.json({
          analysis: {
            factors: [],
            overallSignal: "HOLD",
            bullishCount: 0,
            bearishCount: 0,
            neutralCount: 0,
            signalStrength: 0,
          },
          message: "Insufficient data for multi-factor analysis",
        });
      }

      const analysis = predictionEngine.performMultiFactorAnalysis(marketData);
      
      res.json({
        analysis,
        symbol,
        dataPoints: marketData.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error performing multi-factor analysis:", error);
      res.status(500).json({ error: "Failed to perform multi-factor analysis" });
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

  app.get("/api/export/market", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const format = (req.query.format as string) || "json";
      const period = (req.query.period as string) || "1M";
      
      const { startDate, endDate } = getDateRange(period);
      const data = await storage.getMarketDataByTimeRange(symbol, startDate, endDate);

      if (format === "csv") {
        const fields = ["id", "symbol", "timestamp", "open", "high", "low", "close", "volume", "interval"];
        const csv = convertToCSV(data, fields);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${symbol}_market_data_${period}.csv"`);
        res.send(csv);
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${symbol}_market_data_${period}.json"`);
        res.json(data);
      }
    } catch (error) {
      console.error("Error exporting market data:", error);
      res.status(500).json({ error: "Failed to export market data" });
    }
  });

  app.get("/api/export/predictions", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const format = (req.query.format as string) || "json";
      const limit = parseInt(req.query.limit as string) || 1000;
      const timeframe = req.query.timeframe as string | undefined;
      
      const predictions = await storage.getRecentPredictions(symbol, limit, timeframe);
      const filenameSuffix = timeframe ? `_${timeframe}` : "";

      if (format === "csv") {
        const fields = [
          "id", "symbol", "predictionTimestamp", "targetTimestamp", 
          "predictedPrice", "predictedDirection", "modelType", "confidence", "timeframe",
          "actualPrice", "isMatch", "percentageDifference"
        ];
        const csv = convertToCSV(predictions, fields);
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="${symbol}_predictions${filenameSuffix}.csv"`);
        res.send(csv);
      } else {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", `attachment; filename="${symbol}_predictions${filenameSuffix}.json"`);
        res.json(predictions);
      }
    } catch (error) {
      console.error("Error exporting predictions:", error);
      res.status(500).json({ error: "Failed to export predictions" });
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

  app.get("/api/websocket/status", (req, res) => {
    res.json({
      connected: wsService.getClientCount(),
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/api/backtest/run", async (req, res) => {
    try {
      const { symbol, startDate, endDate, timeframe, lookbackPeriod } = req.body;

      if (!symbol || !startDate || !endDate) {
        return res.status(400).json({ error: "Missing required fields: symbol, startDate, endDate" });
      }

      const config: BacktestConfig = {
        symbol,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        timeframe: timeframe || "1min",
        lookbackPeriod: lookbackPeriod || 20,
      };

      const result = await backtestingEngine.runBacktest(config);
      
      const limitedTrades = result.trades.slice(-500);
      const limitedEquityCurve = result.equityCurve.length > 500 
        ? result.equityCurve.filter((_, i) => i % Math.ceil(result.equityCurve.length / 500) === 0)
        : result.equityCurve;

      res.json({
        ...result,
        trades: limitedTrades,
        equityCurve: limitedEquityCurve,
        totalTradesInBacktest: result.trades.length,
      });
    } catch (error) {
      console.error("Error running backtest:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to run backtest";
      res.status(500).json({ error: errorMessage });
    }
  });

  wsService.initialize(httpServer);

  scheduler.start().catch(console.error);

  return httpServer;
}
