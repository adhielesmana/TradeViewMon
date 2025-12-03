import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scheduler } from "./scheduler";
import { marketDataService } from "./market-data-service";
import { technicalIndicators } from "./technical-indicators";
import { wsService } from "./websocket";
import { backtestingEngine, type BacktestConfig } from "./backtesting";
import { authenticateUser, seedSuperadmin, seedTestUsers, findUserById, findUserByUsername, createUser } from "./auth";
import type { SafeUser } from "@shared/schema";
import { predictionEngine } from "./prediction-engine";
import { z } from "zod";

const updateUserSchema = z.object({
  email: z.string().email().optional().nullable(),
  displayName: z.string().max(100).optional().nullable(),
  role: z.enum(["user", "admin"]).optional(),
  isActive: z.boolean().optional(),
}).strict();

const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["user", "admin"]).optional().default("user"),
});

const DEFAULT_SYMBOL = marketDataService.getSymbol();

// Track symbols that have been seeded to avoid duplicate seeding
const seededSymbols = new Set<string>();

// On-demand historical data seeding for symbols without data
async function ensureHistoricalData(symbol: string): Promise<void> {
  // Skip if already seeded in this session
  if (seededSymbols.has(symbol)) {
    return;
  }
  
  // Check if symbol has any data
  const existingData = await storage.getRecentMarketData(symbol, 1);
  if (existingData.length > 0) {
    seededSymbols.add(symbol);
    return;
  }
  
  console.log(`[Routes] Seeding historical data for ${symbol}...`);
  
  // Generate 1 hour of historical data for the symbol
  const historicalData = await marketDataService.generateHistoricalData(1, symbol);
  
  // Insert in batches
  const batchSize = 500;
  for (let i = 0; i < historicalData.length; i += batchSize) {
    const batch = historicalData.slice(i, i + batchSize);
    await storage.insertMarketDataBatch(batch);
  }
  
  // Save price state
  if (historicalData.length > 0) {
    const lastCandle = historicalData[historicalData.length - 1];
    await storage.upsertPriceState(symbol, lastCandle.open, lastCandle.close, lastCandle.timestamp);
  }
  
  seededSymbols.add(symbol);
  console.log(`[Routes] Seeded ${historicalData.length} candles for ${symbol}`);
}

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
  await seedTestUsers();
  
  // Initialize market data service with database API key
  await marketDataService.initializeFromDatabase(() => storage.getSetting("FINNHUB_API_KEY"));

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

      // Explicitly save session before responding
      req.session.save((err) => {
        if (err) {
          console.error("Session save error:", err);
          return res.status(500).json({ error: "Login failed - session error" });
        }
        
        res.json({ 
          message: "Login successful", 
          user: {
            id: user.id,
            username: user.username,
            role: user.role,
          }
        });
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

  // User Management Routes (Admin only)
  app.get("/api/users", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.get("/api/users/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const user = await storage.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.patch("/api/users/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { id } = req.params;
      const currentUser = req.session.user!;
      
      // Validate request body
      const parseResult = updateUserSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request data", 
          details: parseResult.error.errors 
        });
      }
      const validatedData = parseResult.data;
      
      // Check if trying to modify superadmin
      const targetUser = await storage.getUserById(id);
      if (!targetUser) {
        return res.status(404).json({ error: "User not found" });
      }
      
      // Only superadmin can modify other superadmins
      if (targetUser.role === "superadmin" && currentUser.role !== "superadmin") {
        return res.status(403).json({ error: "Cannot modify superadmin account" });
      }
      
      // Prevent self-demotion
      if (id === currentUser.id && validatedData.role && validatedData.role !== currentUser.role) {
        return res.status(400).json({ error: "Cannot change your own role" });
      }
      
      // Prevent self-deactivation
      if (id === currentUser.id && validatedData.isActive === false) {
        return res.status(400).json({ error: "Cannot deactivate your own account" });
      }
      
      // Only superadmin can change roles
      if (validatedData.role && currentUser.role !== "superadmin") {
        return res.status(403).json({ error: "Only superadmin can change user roles" });
      }

      const updated = await storage.updateUser(id, validatedData);
      if (!updated) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(updated);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  app.delete("/api/users/:id", requireAuth, requireRole(["superadmin"]), async (req, res) => {
    try {
      const { id } = req.params;
      const currentUser = req.session.user!;
      
      // Cannot delete yourself
      if (id === currentUser.id) {
        return res.status(400).json({ error: "Cannot delete your own account" });
      }
      
      // Check if trying to delete superadmin
      const targetUser = await storage.getUserById(id);
      if (targetUser?.role === "superadmin") {
        return res.status(403).json({ error: "Cannot delete superadmin account" });
      }

      const deleted = await storage.deleteUser(id);
      if (!deleted) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  });

  // User Invites Routes
  app.get("/api/invites", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const invites = await storage.getPendingInvites();
      res.json(invites);
    } catch (error) {
      console.error("Error fetching invites:", error);
      res.status(500).json({ error: "Failed to fetch invites" });
    }
  });

  app.post("/api/invites", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const currentUser = req.session.user!;
      
      // Validate request body
      const parseResult = createInviteSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ 
          error: "Invalid request data", 
          details: parseResult.error.errors 
        });
      }
      const { email, role } = parseResult.data;
      
      // Only superadmin can invite admins
      if (role === "admin" && currentUser.role !== "superadmin") {
        return res.status(403).json({ error: "Only superadmin can invite admins" });
      }

      const invite = await storage.createInvite(email, role, currentUser.id);
      res.json(invite);
    } catch (error) {
      console.error("Error creating invite:", error);
      res.status(500).json({ error: "Failed to create invite" });
    }
  });

  app.delete("/api/invites/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const deleted = await storage.deleteInvite(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Invite not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting invite:", error);
      res.status(500).json({ error: "Failed to delete invite" });
    }
  });

  // Validate invite token (public route for registration page)
  app.get("/api/invites/validate", async (req, res) => {
    try {
      const token = req.query.token as string;
      if (!token) {
        return res.status(400).json({ error: "Token is required" });
      }

      const invite = await storage.getInviteByToken(token);
      if (!invite) {
        return res.status(404).json({ error: "Invalid or expired invitation" });
      }

      res.json({
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      });
    } catch (error) {
      console.error("Error validating invite:", error);
      res.status(500).json({ error: "Failed to validate invite" });
    }
  });

  // Register with invite token (public route)
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { username, password, token } = req.body;

      if (!username || !password || !token) {
        return res.status(400).json({ error: "Username, password, and invitation token are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      // Validate the invite
      const invite = await storage.getInviteByToken(token);
      if (!invite) {
        return res.status(400).json({ error: "Invalid or expired invitation" });
      }

      // Check if username already exists
      const existingUser = await findUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already taken" });
      }

      // Create the user with the role from the invite
      const user = await createUser(username, password, invite.role);

      // Mark the invite as accepted
      await storage.acceptInvite(token);

      res.json({
        message: "Registration successful",
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.get("/api/market/recent", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const limit = parseInt(req.query.limit as string) || 60;
      
      // Ensure historical data exists for this symbol
      await ensureHistoricalData(symbol);
      
      const data = await storage.getRecentMarketData(symbol, limit);
      res.json(data);
    } catch (error) {
      console.error("Error fetching recent market data:", error);
      res.status(500).json({ error: "Failed to fetch market data" });
    }
  });

  // Multi-timeframe candle data endpoint
  app.get("/api/market/candles", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const timeframe = (req.query.timeframe as string) || "3h-1min";
      
      // Ensure historical data exists for this symbol (on-demand seeding)
      await ensureHistoricalData(symbol);
      
      const now = new Date();
      let startDate: Date;
      let intervalMinutes: number;
      
      // Determine time range and candle interval based on timeframe
      switch (timeframe) {
        case "1h-1min":
          startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
          intervalMinutes = 1;
          break;
        case "3h-1min":
          startDate = new Date(now.getTime() - 3 * 60 * 60 * 1000);
          intervalMinutes = 1;
          break;
        case "6h-5min":
          startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
          intervalMinutes = 5;
          break;
        case "1d-30min":
          startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          intervalMinutes = 30;
          break;
        case "1m-12h":
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          intervalMinutes = 12 * 60; // 720 minutes
          break;
        case "6m-1d":
          startDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          intervalMinutes = 24 * 60; // 1440 minutes
          break;
        case "1y-1w":
          startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          intervalMinutes = 7 * 24 * 60; // 10080 minutes
          break;
        default:
          startDate = new Date(now.getTime() - 1 * 60 * 60 * 1000);
          intervalMinutes = 1;
      }
      
      const rawData = await storage.getMarketDataByTimeRange(symbol, startDate, now);
      const intervalMs = intervalMinutes * 60 * 1000;
      
      // For 1-minute interval, generate all expected slots with null for missing data
      if (intervalMinutes === 1) {
        const allSlots: any[] = [];
        const startMs = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
        const endMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
        
        // Create a map of existing data by timestamp
        const dataMap = new Map<number, typeof rawData[0]>();
        for (const candle of rawData) {
          const ts = Math.floor(new Date(candle.timestamp).getTime() / intervalMs) * intervalMs;
          dataMap.set(ts, candle);
        }
        
        // Generate all time slots
        for (let ts = startMs; ts <= endMs; ts += intervalMs) {
          const existingCandle = dataMap.get(ts);
          if (existingCandle) {
            allSlots.push(existingCandle);
          } else {
            // Return null entry for missing data
            allSlots.push({
              id: null,
              symbol,
              timestamp: new Date(ts).toISOString(),
              open: null,
              high: null,
              low: null,
              close: null,
              volume: null,
              interval: "1min",
            });
          }
        }
        
        return res.json(allSlots);
      }
      
      // For larger intervals, aggregate and include null slots
      const startMs = Math.floor(startDate.getTime() / intervalMs) * intervalMs;
      const endMs = Math.floor(now.getTime() / intervalMs) * intervalMs;
      
      // Group raw data by interval buckets
      const buckets = new Map<number, typeof rawData>();
      
      for (const candle of rawData) {
        const timestamp = new Date(candle.timestamp).getTime();
        const bucketKey = Math.floor(timestamp / intervalMs) * intervalMs;
        
        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, []);
        }
        buckets.get(bucketKey)!.push(candle);
      }
      
      // Generate all expected time slots
      const allCandles: any[] = [];
      
      for (let ts = startMs; ts <= endMs; ts += intervalMs) {
        const candles = buckets.get(ts);
        
        if (candles && candles.length > 0) {
          // Sort candles by timestamp within bucket
          candles.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
          
          const open = Number(candles[0].open);
          const close = Number(candles[candles.length - 1].close);
          const high = Math.max(...candles.map(c => Number(c.high)));
          const low = Math.min(...candles.map(c => Number(c.low)));
          const volume = candles.reduce((sum, c) => sum + Number(c.volume), 0);
          
          allCandles.push({
            id: candles[0].id,
            symbol,
            timestamp: new Date(ts).toISOString(),
            open,
            high,
            low,
            close,
            volume,
            interval: `${intervalMinutes}min`,
          });
        } else {
          // Return null entry for missing data slot
          allCandles.push({
            id: null,
            symbol,
            timestamp: new Date(ts).toISOString(),
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
            interval: `${intervalMinutes}min`,
          });
        }
      }
      
      res.json(allCandles);
    } catch (error) {
      console.error("Error fetching candle data:", error);
      res.status(500).json({ error: "Failed to fetch candle data" });
    }
  });

  app.get("/api/market/stats", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      
      // Ensure historical data exists for this symbol
      await ensureHistoricalData(symbol);
      
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
      
      // Ensure historical data exists for this symbol
      await ensureHistoricalData(symbol);
      
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
      
      // Ensure historical data exists for this symbol
      await ensureHistoricalData(symbol);
      
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

  // AI Suggestions endpoints
  app.get("/api/suggestions/latest", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const suggestion = await storage.getLatestAiSuggestion(symbol);
      
      if (!suggestion) {
        return res.json(null);
      }
      
      res.json({
        ...suggestion,
        reasoning: suggestion.reasoning ? JSON.parse(suggestion.reasoning) : [],
        indicators: suggestion.indicators ? JSON.parse(suggestion.indicators) : {},
      });
    } catch (error) {
      console.error("Error fetching latest AI suggestion:", error);
      res.status(500).json({ error: "Failed to fetch latest AI suggestion" });
    }
  });

  app.get("/api/suggestions/recent", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const limit = parseInt(req.query.limit as string) || 50;
      const suggestions = await storage.getRecentAiSuggestions(symbol, limit);
      
      const parsedSuggestions = suggestions.map(s => ({
        ...s,
        reasoning: s.reasoning ? JSON.parse(s.reasoning) : [],
        indicators: s.indicators ? JSON.parse(s.indicators) : {},
      }));
      
      res.json(parsedSuggestions);
    } catch (error) {
      console.error("Error fetching recent AI suggestions:", error);
      res.status(500).json({ error: "Failed to fetch recent AI suggestions" });
    }
  });

  app.get("/api/suggestions/accuracy", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const stats = await storage.getAiSuggestionAccuracyStats(symbol);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching AI suggestion accuracy:", error);
      res.status(500).json({ error: "Failed to fetch AI suggestion accuracy" });
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

  // Backfill historical data endpoint (admin only)
  app.post("/api/system/backfill", requireAuth, requireRole(["superadmin"]), async (req, res) => {
    try {
      const days = parseInt(req.body.days as string) || 90;
      const symbol = marketDataService.getSymbol();
      
      console.log(`[Backfill] Generating ${days} days of historical data for ${symbol}...`);
      
      const existingData = await storage.getRecentMarketData(symbol, 1);
      const oldestExisting = existingData.length > 0 
        ? (await storage.getMarketDataByTimeRange(
            symbol, 
            new Date(Date.now() - days * 24 * 60 * 60 * 1000), 
            new Date()
          ))[0]?.timestamp
        : null;
      
      const historicalData = await marketDataService.generateHistoricalData(days);
      
      // Filter out data that already exists (compare by timestamp rounded to minute)
      const existingTimestamps = new Set(
        (await storage.getMarketDataByTimeRange(
          symbol, 
          new Date(Date.now() - days * 24 * 60 * 60 * 1000), 
          new Date()
        )).map(d => new Date(d.timestamp).toISOString().slice(0, 16))
      );
      
      const newData = historicalData.filter(d => 
        !existingTimestamps.has(new Date(d.timestamp).toISOString().slice(0, 16))
      );
      
      if (newData.length > 0) {
        const batchSize = 100;
        for (let i = 0; i < newData.length; i += batchSize) {
          const batch = newData.slice(i, i + batchSize);
          await storage.insertMarketDataBatch(batch);
        }
        console.log(`[Backfill] Generated ${newData.length} new data points`);
      }
      
      res.json({ 
        success: true, 
        generated: newData.length,
        message: `Generated ${newData.length} new data points for ${days} days`
      });
    } catch (error) {
      console.error("Error backfilling data:", error);
      res.status(500).json({ error: "Failed to backfill data" });
    }
  });

  // Demo Trading Routes
  // Get user's demo account and stats
  app.get("/api/demo/account", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      let account = await storage.getDemoAccount(userId);
      
      if (!account) {
        account = await storage.createDemoAccount(userId);
      }
      
      const stats = await storage.getDemoAccountStats(userId);
      res.json({ account, stats });
    } catch (error) {
      console.error("Error getting demo account:", error);
      res.status(500).json({ error: "Failed to get demo account" });
    }
  });

  // Deposit demo credits
  app.post("/api/demo/deposit", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { amount } = req.body;
      
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "Invalid deposit amount" });
      }
      
      const result = await storage.depositDemoCredits(userId, amount);
      res.json(result);
    } catch (error) {
      console.error("Error depositing demo credits:", error);
      res.status(500).json({ error: "Failed to deposit demo credits" });
    }
  });

  // Withdraw demo credits
  app.post("/api/demo/withdraw", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { amount } = req.body;
      
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ error: "Invalid withdrawal amount" });
      }
      
      const result = await storage.withdrawDemoCredits(userId, amount);
      
      // Check if result is an error
      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error withdrawing demo credits:", error);
      res.status(500).json({ error: "Failed to withdraw demo credits" });
    }
  });

  // Get user's positions
  app.get("/api/demo/positions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const status = req.query.status as string | undefined;
      
      const positions = await storage.getDemoPositions(userId, status);
      res.json(positions);
    } catch (error) {
      console.error("Error getting demo positions:", error);
      res.status(500).json({ error: "Failed to get demo positions" });
    }
  });

  // Open a new trade
  app.post("/api/demo/trade/open", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { symbol, type, entryPrice, quantity, stopLoss, takeProfit } = req.body;
      
      if (!symbol || !type || !entryPrice || !quantity) {
        return res.status(400).json({ error: "Missing required fields: symbol, type, entryPrice, quantity" });
      }
      
      if (type !== "BUY" && type !== "SELL") {
        return res.status(400).json({ error: "Type must be BUY or SELL" });
      }
      
      if (quantity <= 0) {
        return res.status(400).json({ error: "Quantity must be greater than 0" });
      }
      
      const result = await storage.openDemoTrade(
        userId, 
        symbol, 
        type as "BUY" | "SELL", 
        entryPrice, 
        quantity, 
        stopLoss, 
        takeProfit
      );
      
      if (!result) {
        return res.status(400).json({ error: "Failed to open trade. Check balance or account status." });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error opening demo trade:", error);
      res.status(500).json({ error: "Failed to open demo trade" });
    }
  });

  // Close a trade
  app.post("/api/demo/trade/close", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { positionId, exitPrice } = req.body;
      
      if (!positionId || !exitPrice) {
        return res.status(400).json({ error: "Missing required fields: positionId, exitPrice" });
      }
      
      const result = await storage.closeDemoTrade(userId, positionId, exitPrice);
      
      if (!result) {
        return res.status(400).json({ error: "Failed to close trade. Position not found or not owned by user." });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error closing demo trade:", error);
      res.status(500).json({ error: "Failed to close demo trade" });
    }
  });

  // Get user's transactions
  app.get("/api/demo/transactions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = parseInt(req.query.limit as string) || 50;
      
      const transactions = await storage.getDemoTransactions(userId, limit);
      res.json(transactions);
    } catch (error) {
      console.error("Error getting demo transactions:", error);
      res.status(500).json({ error: "Failed to get demo transactions" });
    }
  });

  // Get current market price for a symbol (for demo trading)
  app.get("/api/demo/price/:symbol", requireAuth, async (req, res) => {
    try {
      const { symbol } = req.params;
      const marketData = await storage.getLatestMarketData(symbol);
      
      if (!marketData) {
        return res.status(404).json({ error: "No price data available for symbol" });
      }
      
      res.json({ 
        symbol, 
        price: marketData.close, 
        timestamp: marketData.timestamp 
      });
    } catch (error) {
      console.error("Error getting demo price:", error);
      res.status(500).json({ error: "Failed to get price data" });
    }
  });

  // Auto-Trade Settings Routes
  app.get("/api/demo/auto-trade", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      let settings = await storage.getAutoTradeSettings(userId);
      
      if (!settings) {
        settings = await storage.createAutoTradeSettings(userId);
      }
      
      res.json(settings);
    } catch (error) {
      console.error("Error getting auto-trade settings:", error);
      res.status(500).json({ error: "Failed to get auto-trade settings" });
    }
  });

  app.patch("/api/demo/auto-trade", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { isEnabled, tradeUnits, symbol } = req.body;
      
      const updateData: { isEnabled?: boolean; tradeUnits?: number; symbol?: string } = {};
      
      if (typeof isEnabled === "boolean") {
        updateData.isEnabled = isEnabled;
      }
      
      if (typeof tradeUnits === "number" && tradeUnits >= 0.01) {
        updateData.tradeUnits = tradeUnits;
      }
      
      if (typeof symbol === "string" && symbol.length > 0) {
        updateData.symbol = symbol;
      }
      
      const settings = await storage.updateAutoTradeSettings(userId, updateData);
      
      if (!settings) {
        return res.status(404).json({ error: "Failed to update auto-trade settings" });
      }
      
      res.json(settings);
    } catch (error) {
      console.error("Error updating auto-trade settings:", error);
      res.status(500).json({ error: "Failed to update auto-trade settings" });
    }
  });

  // Currency Rates Routes
  app.get("/api/currency/rates", requireAuth, async (req, res) => {
    try {
      const { currencyService } = await import("./currency-service");
      const rates = await currencyService.getRates();
      res.json(rates);
    } catch (error) {
      console.error("Error getting currency rates:", error);
      res.status(500).json({ error: "Failed to get currency rates" });
    }
  });

  // Settings Routes (Superadmin only)
  app.get("/api/settings", requireAuth, requireRole(["superadmin"]), async (req, res) => {
    try {
      // Get Finnhub API key status from service
      const keyStatus = marketDataService.getFinnhubKeyStatus();
      
      res.json({
        finnhubApiKey: keyStatus
      });
    } catch (error) {
      console.error("Error getting settings:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.post("/api/settings/finnhub-key", requireAuth, requireRole(["superadmin"]), async (req, res) => {
    try {
      const { apiKey } = req.body;
      
      if (typeof apiKey !== "string") {
        return res.status(400).json({ error: "API key must be a string" });
      }
      
      const trimmedKey = apiKey.trim();
      
      // Save to database for persistence
      await storage.setSetting("FINNHUB_API_KEY", trimmedKey || null);
      
      // Update the market data service
      marketDataService.updateFinnhubApiKey(trimmedKey || undefined);
      
      res.json({ 
        success: true, 
        message: trimmedKey 
          ? "Finnhub API key saved successfully" 
          : "Finnhub API key removed. Stocks will use simulated data."
      });
    } catch (error) {
      console.error("Error saving Finnhub API key:", error);
      res.status(500).json({ error: "Failed to save API key" });
    }
  });

  wsService.initialize(httpServer);

  scheduler.start().catch(console.error);

  return httpServer;
}
