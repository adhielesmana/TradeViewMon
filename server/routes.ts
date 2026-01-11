import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { scheduler, getMarketStatusForSymbol, getAllMarketStatuses } from "./scheduler";
import { marketDataService } from "./market-data-service";
import { technicalIndicators } from "./technical-indicators";
import { wsService } from "./websocket";
import { backtestingEngine, type BacktestConfig } from "./backtesting";
import { authenticateUser, seedSuperadmin, seedTestUsers, findUserById, findUserByUsername, createUser } from "./auth";
import type { SafeUser, InsertMarketData } from "@shared/schema";
import { predictionEngine } from "./prediction-engine";
import { generateUnifiedSignal, convertToLegacyIndicatorSignal, convertToMultiFactorAnalysis, detectAllCandlestickPatterns } from "./unified-signal-generator";
import { encrypt, decrypt, maskApiKey } from "./encryption";
import { getNewsAndAnalysisCached, forceRefreshNewsAnalysis, getRssFeedUrl, setRssFeedUrl, getNewsStats, getStoredNewsSince, regenerateAllSnapshotImages } from "./news-service";
import { registerObjectStorageRoutes } from "./replit_integrations/object_storage";
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
  const historicalData: InsertMarketData[] = await marketDataService.generateHistoricalData(1, symbol);
  
  // Insert in batches
  const batchSize = 500;
  for (let i = 0; i < historicalData.length; i += batchSize) {
    const batch = historicalData.slice(i, i + batchSize);
    await storage.insertMarketDataBatch(batch);
  }
  
  // Save price state
  if (historicalData.length > 0) {
    const lastCandle = historicalData[historicalData.length - 1] as InsertMarketData;
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
  
  // Register object storage routes for file uploads
  registerObjectStorageRoutes(app);
  
  // Initialize market data service with database API key
  await marketDataService.initializeFromDatabase(() => storage.getSetting("FINNHUB_API_KEY"));
  
  // Load Indonesian stocks (IDX) from database for Yahoo Finance fetching
  await marketDataService.loadIndonesianStocksFromDatabase(async () => {
    const symbols = await storage.getMonitoredSymbols();
    return symbols.map(s => ({
      symbol: s.symbol,
      displayName: s.displayName,
      currency: s.currency || "USD",
      isActive: s.isActive,
    }));
  });

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

      // Check approval status
      const fullUser = await storage.getUserById(user.id);
      if (fullUser?.approvalStatus === "pending") {
        return res.status(403).json({ error: "Your account is pending admin approval. Please wait for approval." });
      }
      if (fullUser?.approvalStatus === "rejected") {
        return res.status(403).json({ error: "Your account registration was rejected. Please contact support." });
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

  app.delete("/api/users/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
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

  // Public signup (no invite token required, pending admin approval)
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, email, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: "Password must be at least 6 characters" });
      }

      // Check if username already exists
      const existingUser = await findUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ error: "Username already taken" });
      }

      // Check if email already exists (if provided)
      if (email) {
        const existingEmail = await storage.getUserByEmail(email);
        if (existingEmail) {
          return res.status(400).json({ error: "Email already registered" });
        }
      }

      // Create the user with pending approval status
      const user = await createUser(username, password, "user", email);

      res.json({
        message: "Registration submitted! Your account is pending admin approval.",
        pendingApproval: true,
        user: {
          id: user.id,
          username: user.username,
        },
      });
    } catch (error) {
      console.error("Signup error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  // Admin: Get pending approval users
  app.get("/api/users/pending", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const users = await storage.getPendingApprovalUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching pending users:", error);
      res.status(500).json({ error: "Failed to fetch pending users" });
    }
  });

  // Admin: Approve user
  app.post("/api/users/:id/approve", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const userId = req.params.id;
      const adminId = req.session.userId;

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.approvalStatus === "approved") {
        return res.status(400).json({ error: "User is already approved" });
      }

      await storage.updateUserApproval(userId, "approved", adminId);
      res.json({ message: "User approved successfully" });
    } catch (error) {
      console.error("Error approving user:", error);
      res.status(500).json({ error: "Failed to approve user" });
    }
  });

  // Admin: Reject user
  app.post("/api/users/:id/reject", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const userId = req.params.id;
      const adminId = req.session.userId;

      const user = await storage.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      if (user.approvalStatus === "rejected") {
        return res.status(400).json({ error: "User is already rejected" });
      }

      await storage.updateUserApproval(userId, "rejected", adminId);
      res.json({ message: "User rejected" });
    } catch (error) {
      console.error("Error rejecting user:", error);
      res.status(500).json({ error: "Failed to reject user" });
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
      
      // For 1-minute interval, return only actual data (skip gaps)
      if (intervalMinutes === 1) {
        // Deduplicate by timestamp, keeping the latest entry for each minute
        const dataMap = new Map<number, typeof rawData[0]>();
        for (const candle of rawData) {
          const ts = Math.floor(new Date(candle.timestamp).getTime() / intervalMs) * intervalMs;
          dataMap.set(ts, candle);
        }
        
        // Convert map to sorted array
        const sortedCandles = Array.from(dataMap.values())
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        
        return res.json(sortedCandles);
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
        }
        // Skip null entries for missing data slots - chart handles gaps gracefully
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

  // Public endpoint for active monitored symbols (used by frontend dropdown)
  app.get("/api/market/symbols", async (req, res) => {
    try {
      const symbols = await storage.getMonitoredSymbols();
      const activeSymbols = symbols
        .filter(s => s.isActive)
        .sort((a, b) => a.priority - b.priority)
        .map(s => ({
          symbol: s.symbol,
          name: s.displayName,
          category: s.category,
          currency: s.currency || "USD",
        }));
      
      res.json(activeSymbols);
    } catch (error) {
      console.error("Error fetching symbols:", error);
      res.status(500).json({ error: "Failed to fetch symbols" });
    }
  });

  // Market status endpoint - returns whether market is open/closed
  app.get("/api/market/status", (req, res) => {
    try {
      const symbol = req.query.symbol as string;
      
      if (symbol) {
        // Get status for specific symbol
        const status = getMarketStatusForSymbol(symbol);
        res.json({
          symbol,
          isOpen: status.isOpen,
          reason: status.reason,
          nextOpenTime: status.nextOpenTime?.toISOString(),
          nextCloseTime: status.nextCloseTime?.toISOString(),
        });
      } else {
        // Get status for all symbols
        const allStatuses = getAllMarketStatuses();
        const formattedStatuses: { [key: string]: any } = {};
        
        for (const [sym, status] of Object.entries(allStatuses)) {
          formattedStatuses[sym] = {
            isOpen: status.isOpen,
            reason: status.reason,
            nextOpenTime: status.nextOpenTime?.toISOString(),
            nextCloseTime: status.nextCloseTime?.toISOString(),
          };
        }
        
        res.json(formattedStatuses);
      }
    } catch (error) {
      console.error("Error fetching market status:", error);
      res.status(500).json({ error: "Failed to fetch market status" });
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
      
      const unifiedResult = generateUnifiedSignal(data);
      const signal = convertToLegacyIndicatorSignal(unifiedResult);

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

  app.get("/api/market/patterns", async (req, res) => {
    try {
      const symbol = (req.query.symbol as string) || DEFAULT_SYMBOL;
      const timeframe = (req.query.timeframe as string) || "3h-1min";
      
      await ensureHistoricalData(symbol);
      
      let candleCount = 180;
      if (timeframe === "1h-1min") {
        candleCount = 60;
      } else if (timeframe === "3h-1min") {
        candleCount = 180;
      } else if (timeframe === "6h-5min") {
        candleCount = 72;
      }
      
      const data = await storage.getRecentMarketData(symbol, candleCount);
      
      if (data.length === 0) {
        return res.json({
          patterns: [],
          trend: "sideways"
        });
      }

      const result = detectAllCandlestickPatterns(data);
      res.json(result);
    } catch (error) {
      console.error("Error detecting candlestick patterns:", error);
      res.status(500).json({ error: "Failed to detect patterns" });
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

      const unifiedResult = generateUnifiedSignal(marketData);
      const analysis = convertToMultiFactorAnalysis(unifiedResult);
      
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
  app.post("/api/system/backfill", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
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
      
      const historicalData: InsertMarketData[] = await marketDataService.generateHistoricalData(days);
      
      // Filter out data that already exists (compare by timestamp rounded to minute)
      const existingTimestamps = new Set(
        (await storage.getMarketDataByTimeRange(
          symbol, 
          new Date(Date.now() - days * 24 * 60 * 60 * 1000), 
          new Date()
        )).map(d => new Date(d.timestamp).toISOString().slice(0, 16))
      );
      
      const newData = historicalData.filter((d) => 
        !existingTimestamps.has(new Date((d as InsertMarketData).timestamp).toISOString().slice(0, 16))
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
      const { isEnabled, tradeUnits, symbol, slTpMode, stopLossValue, takeProfitValue, minConfidence, useAiFilter, usePrecisionSignals, precisionTradeUnits } = req.body;
      
      const updateData: { isEnabled?: boolean; tradeUnits?: number; symbol?: string; slTpMode?: string; stopLossValue?: number; takeProfitValue?: number; minConfidence?: number; useAiFilter?: boolean; usePrecisionSignals?: boolean; precisionTradeUnits?: number } = {};
      
      if (typeof isEnabled === "boolean") {
        updateData.isEnabled = isEnabled;
      }
      
      if (typeof tradeUnits === "number" && tradeUnits >= 0.01) {
        updateData.tradeUnits = tradeUnits;
      }
      
      if (typeof symbol === "string" && symbol.length > 0) {
        updateData.symbol = symbol;
      }
      
      if (typeof slTpMode === "string" && (slTpMode === "pips" || slTpMode === "percentage" || slTpMode === "atr")) {
        updateData.slTpMode = slTpMode;
      }
      
      if (typeof stopLossValue === "number" && stopLossValue >= 0) {
        updateData.stopLossValue = stopLossValue;
      }
      
      if (typeof takeProfitValue === "number" && takeProfitValue >= 0) {
        updateData.takeProfitValue = takeProfitValue;
      }
      
      if (typeof minConfidence === "number" && minConfidence >= 0 && minConfidence <= 100) {
        updateData.minConfidence = minConfidence;
      }
      
      if (typeof useAiFilter === "boolean") {
        updateData.useAiFilter = useAiFilter;
      }
      
      if (typeof usePrecisionSignals === "boolean") {
        updateData.usePrecisionSignals = usePrecisionSignals;
      }
      
      if (typeof precisionTradeUnits === "number" && precisionTradeUnits >= 0.01) {
        updateData.precisionTradeUnits = precisionTradeUnits;
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
  app.get("/api/settings", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      // Get Finnhub API key status from service
      const finnhubKeyStatus = marketDataService.getFinnhubKeyStatus();
      
      // Get OpenAI API key status - database takes priority, then environment fallback
      // Priority: database (Settings page) > AI_INTEGRATIONS_OPENAI_API_KEY (Replit) > OPENAI_API_KEY (env override)
      const replitOpenaiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      let openaiKeyStatus;
      
      // Check database first (primary source via Settings page)
      const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
      if (encryptedKey) {
        try {
          const decryptedKey = decrypt(encryptedKey);
          openaiKeyStatus = {
            isConfigured: true,
            source: "database",
            maskedValue: maskApiKey(decryptedKey),
            isEditable: true
          };
        } catch (e) {
          console.error("Failed to decrypt OpenAI key:", e);
          openaiKeyStatus = {
            isConfigured: false,
            source: "not_set",
            maskedValue: null,
            isEditable: true
          };
        }
      } else if (replitOpenaiKey && replitOpenaiKey !== "not-configured") {
        // Replit's managed OpenAI integration (fallback)
        openaiKeyStatus = {
          isConfigured: true,
          source: "environment",
          maskedValue: maskApiKey(replitOpenaiKey),
          isEditable: true  // Can still override with database key
        };
      } else {
        // No key configured anywhere
        openaiKeyStatus = {
          isConfigured: false,
          source: "not_set",
          maskedValue: null,
          isEditable: true
        };
      }
      
      // Get RSS feed URL
      const rssFeedUrl = await getRssFeedUrl();
      
      res.json({
        finnhubApiKey: finnhubKeyStatus,
        openaiApiKey: openaiKeyStatus,
        rssFeedUrl: rssFeedUrl
      });
    } catch (error) {
      console.error("Error getting settings:", error);
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  app.post("/api/settings/finnhub-key", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
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

  app.post("/api/settings/openai-key", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      // Database key takes priority, so always allow saving via Settings UI
      // This will override any environment variable since database is checked first
      
      const { apiKey } = req.body;
      
      if (typeof apiKey !== "string") {
        return res.status(400).json({ error: "API key must be a string" });
      }
      
      const trimmedKey = apiKey.trim();
      
      if (!trimmedKey) {
        return res.status(400).json({ error: "API key cannot be empty" });
      }
      
      // Validate OpenAI key format (should start with sk-)
      if (!trimmedKey.startsWith("sk-")) {
        return res.status(400).json({ error: "Invalid OpenAI API key format. Key should start with 'sk-'" });
      }
      
      // Encrypt and save to database
      const encryptedKey = encrypt(trimmedKey);
      await storage.setSetting("OPENAI_API_KEY_ENCRYPTED", encryptedKey);
      
      res.json({ 
        success: true, 
        message: "OpenAI API key saved successfully. AI-enhanced auto-trading is now available."
      });
    } catch (error) {
      console.error("Error saving OpenAI API key:", error);
      res.status(500).json({ error: "Failed to save API key" });
    }
  });

  app.delete("/api/settings/openai-key", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      // Remove from database - this will fall back to environment variable if set
      await storage.setSetting("OPENAI_API_KEY_ENCRYPTED", null);
      
      res.json({ 
        success: true, 
        message: "OpenAI API key removed. AI-enhanced auto-trading will fall back to technical analysis only."
      });
    } catch (error) {
      console.error("Error removing OpenAI API key:", error);
      res.status(500).json({ error: "Failed to remove API key" });
    }
  });

  // RSS Feed URL Settings
  app.get("/api/settings/rss-feed", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const url = await getRssFeedUrl();
      res.json({ url });
    } catch (error) {
      console.error("Error getting RSS feed URL:", error);
      res.status(500).json({ error: "Failed to get RSS feed URL" });
    }
  });

  app.post("/api/settings/rss-feed", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { url } = req.body;
      
      if (typeof url !== "string" || !url.trim()) {
        return res.status(400).json({ error: "RSS feed URL is required" });
      }
      
      // Basic URL validation
      try {
        new URL(url.trim());
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      
      await setRssFeedUrl(url.trim());
      
      res.json({ 
        success: true, 
        message: "RSS feed URL saved successfully."
      });
    } catch (error) {
      console.error("Error saving RSS feed URL:", error);
      res.status(500).json({ error: "Failed to save RSS feed URL" });
    }
  });

  // News Analysis API (authenticated users can access) - uses caching for fast loads
  app.get("/api/news/analysis", requireAuth, async (req, res) => {
    try {
      const analysis = await getNewsAndAnalysisCached();
      res.json(analysis);
    } catch (error) {
      console.error("Error fetching news analysis:", error);
      res.status(500).json({ error: "Failed to fetch news analysis" });
    }
  });

  // Force refresh news analysis (bypasses cache)
  app.post("/api/news/analysis/refresh", requireAuth, async (req, res) => {
    try {
      const analysis = await forceRefreshNewsAnalysis();
      res.json(analysis);
    } catch (error) {
      console.error("Error refreshing news analysis:", error);
      res.status(500).json({ error: "Failed to refresh news analysis" });
    }
  });

  // Paginated news articles from last 7 days
  app.get("/api/news/articles", requireAuth, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(50, Math.max(10, parseInt(req.query.pageSize as string) || 20));
      const daysBack = Math.min(30, Math.max(1, parseInt(req.query.daysBack as string) || 7));
      
      const result = await storage.getNewsArticlesPaginated(page, pageSize, daysBack);
      res.json({
        articles: result.articles,
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: result.totalPages,
          daysBack,
        }
      });
    } catch (error) {
      console.error("Error fetching paginated news articles:", error);
      res.status(500).json({ error: "Failed to fetch news articles" });
    }
  });

  // Paginated article history (AI predictions with generated articles)
  app.get("/api/news/analysis/history", requireAuth, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const pageSize = Math.min(50, Math.max(5, parseInt(req.query.pageSize as string) || 10));
      
      const result = await storage.getNewsAnalysisSnapshotsPaginated(page, pageSize);
      res.json({
        snapshots: result.snapshots,
        pagination: {
          page,
          pageSize,
          total: result.total,
          totalPages: result.totalPages,
        }
      });
    } catch (error) {
      console.error("Error fetching article history:", error);
      res.status(500).json({ error: "Failed to fetch article history" });
    }
  });

  // Get single article by ID
  app.get("/api/news/analysis/:id", requireAuth, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid article ID" });
      }
      
      const snapshot = await storage.getNewsAnalysisSnapshotById(id);
      if (!snapshot) {
        return res.status(404).json({ error: "Article not found" });
      }
      
      res.json(snapshot);
    } catch (error) {
      console.error("Error fetching article:", error);
      res.status(500).json({ error: "Failed to fetch article" });
    }
  });

  // RSS Feeds CRUD API
  app.get("/api/settings/rss-feeds", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const feeds = await storage.getRssFeeds();
      res.json(feeds);
    } catch (error) {
      console.error("Error getting RSS feeds:", error);
      res.status(500).json({ error: "Failed to get RSS feeds" });
    }
  });

  app.post("/api/settings/rss-feeds", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { name, url, isActive, priority } = req.body;
      
      if (!name || !url) {
        return res.status(400).json({ error: "Name and URL are required" });
      }
      
      try {
        new URL(url.trim());
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
      
      const feed = await storage.createRssFeed({
        name: name.trim(),
        url: url.trim(),
        isActive: isActive !== false,
        priority: priority || 0,
      });
      
      res.json({ success: true, feed });
    } catch (error) {
      console.error("Error creating RSS feed:", error);
      res.status(500).json({ error: "Failed to create RSS feed" });
    }
  });

  app.put("/api/settings/rss-feeds/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, url, isActive, priority } = req.body;
      
      if (url) {
        try {
          new URL(url.trim());
        } catch {
          return res.status(400).json({ error: "Invalid URL format" });
        }
      }
      
      const feed = await storage.updateRssFeed(id, {
        ...(name && { name: name.trim() }),
        ...(url && { url: url.trim() }),
        ...(isActive !== undefined && { isActive }),
        ...(priority !== undefined && { priority }),
      });
      
      if (!feed) {
        return res.status(404).json({ error: "RSS feed not found" });
      }
      
      res.json({ success: true, feed });
    } catch (error) {
      console.error("Error updating RSS feed:", error);
      res.status(500).json({ error: "Failed to update RSS feed" });
    }
  });

  app.delete("/api/settings/rss-feeds/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteRssFeed(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "RSS feed not found" });
      }
      
      res.json({ success: true, message: "RSS feed deleted" });
    } catch (error) {
      console.error("Error deleting RSS feed:", error);
      res.status(500).json({ error: "Failed to delete RSS feed" });
    }
  });

  // News Articles Statistics (for AI learning)
  app.get("/api/settings/news-stats", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const stats = await getNewsStats();
      const recentNews = await getStoredNewsSince(24); // Last 24 hours
      
      res.json({
        ...stats,
        recentArticles: recentNews.slice(0, 10) // Return latest 10 articles preview
      });
    } catch (error) {
      console.error("Error getting news stats:", error);
      res.status(500).json({ error: "Failed to get news stats" });
    }
  });

  // Regenerate all article images with keyword-based Unsplash URLs
  app.post("/api/settings/regenerate-images", requireAuth, requireRole(["superadmin"]), async (req, res) => {
    try {
      const result = await regenerateAllSnapshotImages();
      res.json({ 
        success: true, 
        message: `Regenerated ${result.updated} of ${result.total} article images`,
        ...result 
      });
    } catch (error) {
      console.error("Error regenerating images:", error);
      res.status(500).json({ error: "Failed to regenerate images" });
    }
  });

  // Symbol Categories CRUD API
  app.get("/api/settings/categories", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const categories = await storage.getSymbolCategories();
      res.json(categories);
    } catch (error) {
      console.error("Error getting categories:", error);
      res.status(500).json({ error: "Failed to get categories" });
    }
  });

  app.post("/api/settings/categories", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { name, displayOrder } = req.body;
      
      if (!name || !name.trim()) {
        return res.status(400).json({ error: "Category name is required" });
      }
      
      const newCategory = await storage.createSymbolCategory({
        name: name.trim(),
        displayOrder: displayOrder || 0,
        isActive: true,
      });
      
      res.json({ success: true, category: newCategory });
    } catch (error: any) {
      console.error("Error creating category:", error);
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Category already exists" });
      }
      res.status(500).json({ error: "Failed to create category" });
    }
  });

  app.put("/api/settings/categories/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { name, displayOrder, isActive } = req.body;
      
      const updated = await storage.updateSymbolCategory(id, {
        ...(name && { name: name.trim() }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(isActive !== undefined && { isActive }),
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Category not found" });
      }
      
      res.json({ success: true, category: updated });
    } catch (error: any) {
      console.error("Error updating category:", error);
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Category name already exists" });
      }
      res.status(500).json({ error: "Failed to update category" });
    }
  });

  app.delete("/api/settings/categories/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteSymbolCategory(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Category not found" });
      }
      
      res.json({ success: true, message: "Category deleted" });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ error: "Failed to delete category" });
    }
  });

  // Monitored Symbols CRUD API
  app.get("/api/settings/symbols", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      let symbols = await storage.getMonitoredSymbols();
      
      // Auto-seed from market data service if table is empty
      if (symbols.length === 0) {
        console.log("[Settings] Seeding monitored symbols from market data service...");
        const { marketDataService } = await import("./market-data-service");
        const configs = marketDataService.getSymbolConfigs();
        
        for (let i = 0; i < configs.length; i++) {
          const config = configs[i];
          await storage.createMonitoredSymbol({
            symbol: config.symbol,
            displayName: config.displayName,
            category: config.category,
            currency: config.currency || "USD",
            isActive: true,
            priority: configs.length - i, // Higher priority for earlier symbols
          });
        }
        
        symbols = await storage.getMonitoredSymbols();
        console.log(`[Settings] Seeded ${symbols.length} monitored symbols`);
      }
      
      res.json(symbols);
    } catch (error) {
      console.error("Error getting symbols:", error);
      res.status(500).json({ error: "Failed to get symbols" });
    }
  });

  app.post("/api/settings/symbols", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { symbol, displayName, category, currency, isActive, priority } = req.body;
      
      if (!symbol || !displayName || !category) {
        return res.status(400).json({ error: "Symbol, displayName, and category are required" });
      }
      
      const trimmedDisplayName = displayName.trim();
      const trimmedSymbol = symbol.trim().toUpperCase();
      const trimmedCurrency = currency?.trim() || "USD";
      
      // Auto-detect Indonesian stocks by (IDX) in displayName OR currency = IDR
      const isIndonesianStock = trimmedDisplayName.includes("(IDX)") || trimmedCurrency === "IDR";
      const finalCategory = isIndonesianStock ? "Indonesian Stocks" : category.trim();
      const finalCurrency = isIndonesianStock ? "IDR" : trimmedCurrency;
      
      // Register with market data service for Yahoo Finance fetching
      if (isIndonesianStock) {
        marketDataService.registerIndonesianStock(trimmedSymbol);
        console.log(`[Symbols] Auto-registered Indonesian stock: ${trimmedSymbol} with IDR currency`);
      }
      
      const newSymbol = await storage.createMonitoredSymbol({
        symbol: trimmedSymbol,
        displayName: trimmedDisplayName,
        category: finalCategory,
        currency: finalCurrency,
        isActive: isActive !== false,
        priority: priority || 0,
      });
      
      res.json({ success: true, symbol: newSymbol });
    } catch (error: any) {
      console.error("Error creating symbol:", error);
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Symbol already exists" });
      }
      res.status(500).json({ error: "Failed to create symbol" });
    }
  });

  app.put("/api/settings/symbols/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { symbol, displayName, category, currency, isActive, priority } = req.body;
      
      const trimmedDisplayName = displayName?.trim();
      const trimmedSymbol = symbol?.trim().toUpperCase();
      const trimmedCurrency = currency?.trim();
      
      // Auto-detect Indonesian stocks by (IDX) in displayName OR currency = IDR
      const isIndonesianStock = trimmedDisplayName?.includes("(IDX)") || trimmedCurrency === "IDR";
      
      // Override category and currency for Indonesian stocks
      const finalCategory = isIndonesianStock ? "Indonesian Stocks" : category?.trim();
      const finalCurrency = isIndonesianStock ? "IDR" : trimmedCurrency;
      
      // Register with market data service for Yahoo Finance fetching
      if (isIndonesianStock && trimmedSymbol) {
        marketDataService.registerIndonesianStock(trimmedSymbol);
        console.log(`[Symbols] Auto-registered Indonesian stock: ${trimmedSymbol} with IDR currency`);
      }
      
      const updated = await storage.updateMonitoredSymbol(id, {
        ...(trimmedSymbol && { symbol: trimmedSymbol }),
        ...(trimmedDisplayName && { displayName: trimmedDisplayName }),
        ...(finalCategory && { category: finalCategory }),
        ...(finalCurrency && { currency: finalCurrency }),
        ...(isActive !== undefined && { isActive }),
        ...(priority !== undefined && { priority }),
      });
      
      if (!updated) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      res.json({ success: true, symbol: updated });
    } catch (error: any) {
      console.error("Error updating symbol:", error);
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Symbol already exists" });
      }
      res.status(500).json({ error: "Failed to update symbol" });
    }
  });

  app.delete("/api/settings/symbols/:id", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const deleted = await storage.deleteMonitoredSymbol(id);
      
      if (!deleted) {
        return res.status(404).json({ error: "Symbol not found" });
      }
      
      res.json({ success: true, message: "Symbol deleted" });
    } catch (error) {
      console.error("Error deleting symbol:", error);
      res.status(500).json({ error: "Failed to delete symbol" });
    }
  });

  // AI auto-detect symbol info (for user-added symbols)
  app.post("/api/market/symbols/detect", requireAuth, async (req, res) => {
    try {
      const { symbolName } = req.body;
      
      if (!symbolName || typeof symbolName !== "string") {
        return res.status(400).json({ error: "Symbol name is required" });
      }
      
      const cleanSymbol = symbolName.trim().toUpperCase();
      
      // Check if symbol already exists
      const existingSymbols = await storage.getMonitoredSymbols();
      if (existingSymbols.find(s => s.symbol.toUpperCase() === cleanSymbol)) {
        return res.status(400).json({ error: "Symbol already exists in the system" });
      }
      
      // Try to detect symbol info using AI
      const OpenAI = (await import("openai")).default;
      const { decrypt } = await import("./encryption");
      
      // Get OpenAI key (same priority as ai-trading-analyzer)
      let apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey || apiKey === "not-configured") {
        const encryptedKey = await storage.getSetting("OPENAI_API_KEY_ENCRYPTED");
        if (encryptedKey) {
          apiKey = decrypt(encryptedKey) || undefined;
        }
      }
      if (!apiKey || apiKey === "not-configured") {
        apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
      }
      
      if (!apiKey || apiKey === "not-configured") {
        // Fallback: return basic detection based on common patterns
        const fallbackInfo = detectSymbolFallback(cleanSymbol);
        return res.json({
          symbol: cleanSymbol,
          ...fallbackInfo,
          aiDetected: false,
          message: "AI not available, using pattern detection"
        });
      }
      
      // Use AI to detect symbol info
      const useReplitProxy = apiKey === process.env.AI_INTEGRATIONS_OPENAI_API_KEY && process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
      const openai = new OpenAI({
        apiKey,
        baseURL: useReplitProxy ? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL : undefined,
      });
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a financial data expert. Given a stock/forex/crypto symbol, identify its details.
Return a JSON object with these fields:
- displayName: Full name of the asset (e.g., "Gold Spot", "Apple Inc.", "Bitcoin", "Bank Central Asia (IDX)")
- category: One of "forex", "stocks", "crypto", "commodities", "indices"
- currency: The trading currency code (e.g., "USD", "IDR", "EUR")
- exchange: The primary exchange if applicable (e.g., "NYSE", "NASDAQ", "IDX", "FOREX")

For Indonesian stocks (JSX/IDX), include "(IDX)" in displayName and set currency to "IDR".
For forex pairs, use the quote currency (e.g., XAU/USD = "USD").
For crypto, typically "USD".

Return ONLY valid JSON, no markdown or explanation.`
          },
          {
            role: "user",
            content: `Identify this trading symbol: ${cleanSymbol}`
          }
        ],
        temperature: 0.1,
        max_tokens: 200,
      });
      
      const content = response.choices[0]?.message?.content || "";
      
      try {
        const detected = JSON.parse(content.replace(/```json\n?|\n?```/g, "").trim());
        
        res.json({
          symbol: cleanSymbol,
          displayName: detected.displayName || cleanSymbol,
          category: detected.category || "stocks",
          currency: detected.currency || "USD",
          exchange: detected.exchange || null,
          aiDetected: true,
          message: "Symbol detected by AI"
        });
      } catch (parseError) {
        // If AI response can't be parsed, use fallback
        const fallbackInfo = detectSymbolFallback(cleanSymbol);
        res.json({
          symbol: cleanSymbol,
          ...fallbackInfo,
          aiDetected: false,
          message: "AI response invalid, using pattern detection"
        });
      }
    } catch (error) {
      console.error("Error detecting symbol:", error);
      // Fallback on any error
      const cleanSymbol = (req.body.symbolName || "").trim().toUpperCase();
      const fallbackInfo = detectSymbolFallback(cleanSymbol);
      res.json({
        symbol: cleanSymbol,
        ...fallbackInfo,
        aiDetected: false,
        message: "Detection failed, using pattern detection"
      });
    }
  });
  
  // Helper function for fallback symbol detection
  function detectSymbolFallback(symbol: string): { displayName: string; category: string; currency: string } {
    const upperSymbol = symbol.toUpperCase();
    
    // Common forex pairs
    if (upperSymbol.startsWith("XAU") || upperSymbol === "GOLD") {
      return { displayName: "Gold Spot", category: "commodities", currency: "USD" };
    }
    if (upperSymbol.startsWith("XAG") || upperSymbol === "SILVER") {
      return { displayName: "Silver Spot", category: "commodities", currency: "USD" };
    }
    if (upperSymbol.includes("/") || ["EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD"].some(c => upperSymbol.includes(c))) {
      return { displayName: `${symbol} Exchange Rate`, category: "forex", currency: "USD" };
    }
    
    // Crypto patterns
    if (["BTC", "ETH", "SOL", "ADA", "XRP", "DOT", "DOGE", "AVAX", "MATIC"].includes(upperSymbol) || 
        upperSymbol.endsWith("USDT") || upperSymbol.endsWith("USD")) {
      const base = upperSymbol.replace(/USDT?$/, "");
      return { displayName: `${base} Cryptocurrency`, category: "crypto", currency: "USD" };
    }
    
    // Indonesian stocks (.JK suffix or common Indonesian tickers)
    if (upperSymbol.endsWith(".JK") || ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "UNVR", "GGRM", "ICBP", "KLBF", "BBNI"].includes(upperSymbol)) {
      const name = upperSymbol.replace(".JK", "");
      return { displayName: `${name} (IDX)`, category: "stocks", currency: "IDR" };
    }
    
    // Default to stocks
    return { displayName: symbol, category: "stocks", currency: "USD" };
  }

  // Add symbol (user-accessible - any logged in user can add)
  app.post("/api/market/symbols", requireAuth, async (req, res) => {
    try {
      const { symbol, displayName, category, currency } = req.body;
      
      if (!symbol || !displayName) {
        return res.status(400).json({ error: "Symbol and display name are required" });
      }
      
      const trimmedSymbol = symbol.trim().toUpperCase();
      const trimmedDisplayName = displayName.trim();
      const trimmedCategory = (category || "stocks").trim().toLowerCase();
      const trimmedCurrency = (currency || "USD").trim().toUpperCase();
      
      // Check for duplicates
      const existingSymbols = await storage.getMonitoredSymbols();
      if (existingSymbols.find(s => s.symbol.toUpperCase() === trimmedSymbol)) {
        return res.status(400).json({ error: "Symbol already exists" });
      }
      
      // Auto-detect Indonesian stocks
      const isIndonesianStock = trimmedDisplayName.includes("(IDX)") || trimmedCurrency === "IDR";
      
      // Get max priority for ordering
      const maxPriority = existingSymbols.length > 0 
        ? Math.max(...existingSymbols.map(s => s.priority)) 
        : 0;
      
      const newSymbol = await storage.createMonitoredSymbol({
        symbol: trimmedSymbol,
        displayName: trimmedDisplayName,
        category: isIndonesianStock ? "stocks" : trimmedCategory,
        currency: isIndonesianStock ? "IDR" : trimmedCurrency,
        isActive: true,
        priority: maxPriority + 1,
      });
      
      // Register with market data service if Indonesian stock
      if (isIndonesianStock) {
        const { marketDataService } = await import("./market-data-service");
        marketDataService.registerIndonesianStock(trimmedSymbol);
      }
      
      res.json({ 
        success: true, 
        symbol: newSymbol,
        message: `Symbol ${trimmedSymbol} added successfully`
      });
    } catch (error: any) {
      console.error("Error adding symbol:", error);
      if (error.message?.includes("unique")) {
        return res.status(400).json({ error: "Symbol already exists" });
      }
      res.status(500).json({ error: "Failed to add symbol" });
    }
  });

  // ==================== LOGO SETTINGS ====================
  
  // Get logo settings
  app.get("/api/settings/logo", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const logoPath = await storage.getSetting("LOGO_PATH");
      const logoIconPath = await storage.getSetting("LOGO_ICON_PATH");
      res.json({ 
        logoPath: logoPath || null,
        logoIconPath: logoIconPath || null 
      });
    } catch (error) {
      console.error("Error fetching logo settings:", error);
      res.status(500).json({ error: "Failed to fetch logo settings" });
    }
  });

  // Save logo settings
  app.post("/api/settings/logo", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      const { logoPath, logoIconPath } = req.body;
      
      if (logoPath !== undefined) {
        await storage.setSetting("LOGO_PATH", logoPath || "");
      }
      if (logoIconPath !== undefined) {
        await storage.setSetting("LOGO_ICON_PATH", logoIconPath || "");
      }
      
      res.json({ success: true, message: "Logo settings saved" });
    } catch (error) {
      console.error("Error saving logo settings:", error);
      res.status(500).json({ error: "Failed to save logo settings" });
    }
  });

  // Delete logo settings
  app.delete("/api/settings/logo", requireAuth, requireRole(["superadmin", "admin"]), async (req, res) => {
    try {
      await storage.deleteSetting("LOGO_PATH");
      await storage.deleteSetting("LOGO_ICON_PATH");
      res.json({ success: true, message: "Logo settings cleared" });
    } catch (error) {
      console.error("Error clearing logo settings:", error);
      res.status(500).json({ error: "Failed to clear logo settings" });
    }
  });

  // ==================== PUBLIC API ENDPOINTS (No Auth Required) ====================

  // Public logo settings (for landing page)
  app.get("/api/public/logo", async (req, res) => {
    try {
      const logoPath = await storage.getSetting("LOGO_PATH");
      const logoIconPath = await storage.getSetting("LOGO_ICON_PATH");
      res.json({ 
        logoPath: logoPath || null,
        logoIconPath: logoIconPath || null 
      });
    } catch (error) {
      console.error("Error fetching public logo:", error);
      res.status(500).json({ error: "Failed to fetch logo" });
    }
  });

  // Public news current analysis
  app.get("/api/public/news/current", async (req, res) => {
    try {
      const analysis = await getNewsAndAnalysisCached();
      res.json({ marketPrediction: analysis.marketPrediction });
    } catch (error) {
      console.error("Error fetching public news:", error);
      res.status(500).json({ error: "Failed to fetch news analysis" });
    }
  });

  // Public news history with pagination
  app.get("/api/public/news/history", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 6;
      const result = await storage.getNewsAnalysisSnapshotsPaginated(page, limit);
      res.json({ 
        snapshots: result.snapshots,
        total: result.total,
        totalPages: result.totalPages,
        currentPage: page
      });
    } catch (error) {
      console.error("Error fetching public news history:", error);
      res.status(500).json({ error: "Failed to fetch news history" });
    }
  });

  // Public single article by ID
  app.get("/api/public/news/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid article ID" });
      }
      const snapshot = await storage.getNewsAnalysisSnapshotById(id);
      if (!snapshot) {
        return res.status(404).json({ error: "Article not found" });
      }
      res.json({ snapshot });
    } catch (error) {
      console.error("Error fetching public article:", error);
      res.status(500).json({ error: "Failed to fetch article" });
    }
  });

  // Public market prices
  app.get("/api/public/prices", async (req, res) => {
    try {
      const symbols = await storage.getMonitoredSymbols();
      const activeSymbols = symbols.filter(s => s.isActive);
      
      const prices = await Promise.all(
        activeSymbols.slice(0, 12).map(async (sym) => {
          try {
            const recentData = await storage.getRecentMarketData(sym.symbol, 2);
            const currentPrice = recentData[0]?.close || 0;
            const previousPrice = recentData[1]?.close || currentPrice;
            const change = currentPrice - previousPrice;
            const changePercent = previousPrice > 0 ? (change / previousPrice) * 100 : 0;
            
            return {
              symbol: sym.symbol,
              displayName: sym.displayName || sym.symbol,
              price: currentPrice,
              change,
              changePercent,
              currency: sym.currency || "USD",
            };
          } catch {
            return {
              symbol: sym.symbol,
              displayName: sym.displayName || sym.symbol,
              price: 0,
              change: 0,
              changePercent: 0,
              currency: sym.currency || "USD",
            };
          }
        })
      );
      
      res.json({ prices });
    } catch (error) {
      console.error("Error fetching public prices:", error);
      res.status(500).json({ error: "Failed to fetch prices" });
    }
  });

  wsService.initialize(httpServer);

  scheduler.start().catch(console.error);

  return httpServer;
}
