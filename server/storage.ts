import { 
  marketData, predictions, accuracyResults, systemStatus, users, userInvites, priceState,
  type MarketData, type InsertMarketData,
  type Prediction, type InsertPrediction,
  type AccuracyResult, type InsertAccuracyResult,
  type SystemStatus, type InsertSystemStatus,
  type MarketStats, type AccuracyStats, type PredictionWithResult,
  type User, type SafeUser, type InsertUser, type UpdateUser,
  type UserInvite, type InsertUserInvite,
  type PriceState, type InsertPriceState
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, gte, lte, and, sql, inArray, isNull } from "drizzle-orm";

export interface IStorage {
  // Market Data
  getRecentMarketData(symbol: string, limit?: number): Promise<MarketData[]>;
  getMarketDataByTimeRange(symbol: string, startTime: Date, endTime: Date): Promise<MarketData[]>;
  getMarketStats(symbol: string): Promise<MarketStats | null>;
  insertMarketData(data: InsertMarketData): Promise<MarketData>;
  insertMarketDataBatch(data: InsertMarketData[]): Promise<MarketData[]>;
  getLatestMarketData(symbol: string): Promise<MarketData | null>;

  // Predictions
  getRecentPredictions(symbol: string, limit?: number, timeframe?: string): Promise<PredictionWithResult[]>;
  insertPrediction(prediction: InsertPrediction): Promise<Prediction>;
  getPredictionById(id: number): Promise<Prediction | null>;

  // Accuracy Results
  getAccuracyStats(symbol: string, timeframe?: string): Promise<AccuracyStats>;
  insertAccuracyResult(result: InsertAccuracyResult): Promise<AccuracyResult>;

  // System Status
  getSystemStatus(): Promise<SystemStatus[]>;
  upsertSystemStatus(status: InsertSystemStatus): Promise<SystemStatus>;
  getSystemStats(): Promise<{
    totalRecords: number;
    totalPredictions: number;
    schedulerStatus: string;
    lastSchedulerRun: string | null;
    uptime: number;
  }>;

  // User Management
  getAllUsers(): Promise<SafeUser[]>;
  getUserById(id: string): Promise<SafeUser | null>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: UpdateUser): Promise<SafeUser | null>;
  deleteUser(id: string): Promise<boolean>;
  
  // User Invites
  createInvite(email: string, role: string, invitedById: string): Promise<UserInvite>;
  getInviteByToken(token: string): Promise<UserInvite | null>;
  getPendingInvites(): Promise<UserInvite[]>;
  acceptInvite(token: string): Promise<UserInvite | null>;
  deleteInvite(id: string): Promise<boolean>;
  
  // Price State
  getPriceState(symbol: string): Promise<PriceState | null>;
  upsertPriceState(symbol: string, lastOpen: number, lastClose: number, lastTimestamp: Date): Promise<PriceState>;
}

const startTime = Date.now();

export class DatabaseStorage implements IStorage {
  async getRecentMarketData(symbol: string, limit: number = 60): Promise<MarketData[]> {
    const data = await db
      .select()
      .from(marketData)
      .where(eq(marketData.symbol, symbol))
      .orderBy(desc(marketData.timestamp))
      .limit(limit);
    return data.reverse();
  }

  async getMarketDataByTimeRange(symbol: string, startTime: Date, endTime: Date): Promise<MarketData[]> {
    return db
      .select()
      .from(marketData)
      .where(
        and(
          eq(marketData.symbol, symbol),
          gte(marketData.timestamp, startTime),
          lte(marketData.timestamp, endTime)
        )
      )
      .orderBy(marketData.timestamp);
  }

  async getMarketStats(symbol: string): Promise<MarketStats | null> {
    const recentData = await this.getRecentMarketData(symbol, 60);
    if (recentData.length === 0) return null;

    const latest = recentData[recentData.length - 1];
    
    // Use the latest candle's open as reference so the price change
    // indicator matches the chart's latest candle color (green = bullish, red = bearish)
    const referencePrice = latest.open;

    return {
      currentPrice: latest.close,
      change: latest.close - referencePrice,
      changePercent: ((latest.close - referencePrice) / referencePrice) * 100,
      high: Math.max(...recentData.map(d => d.high)),
      low: Math.min(...recentData.map(d => d.low)),
      volume: recentData.reduce((sum, d) => sum + d.volume, 0),
      lastUpdate: latest.timestamp.toISOString(),
    };
  }

  async insertMarketData(data: InsertMarketData): Promise<MarketData> {
    const [result] = await db.insert(marketData).values(data).returning();
    return result;
  }

  async insertMarketDataBatch(data: InsertMarketData[]): Promise<MarketData[]> {
    if (data.length === 0) return [];
    return db.insert(marketData).values(data).returning();
  }

  async getLatestMarketData(symbol: string): Promise<MarketData | null> {
    const [result] = await db
      .select()
      .from(marketData)
      .where(eq(marketData.symbol, symbol))
      .orderBy(desc(marketData.timestamp))
      .limit(1);
    return result || null;
  }

  async getRecentPredictions(symbol: string, limit: number = 50, timeframe?: string): Promise<PredictionWithResult[]> {
    const conditions = [eq(predictions.symbol, symbol)];
    if (timeframe) {
      conditions.push(eq(predictions.timeframe, timeframe));
    }

    const preds = await db
      .select()
      .from(predictions)
      .where(and(...conditions))
      .orderBy(desc(predictions.targetTimestamp))
      .limit(limit);

    const result: PredictionWithResult[] = [];
    for (const pred of preds) {
      const [accuracy] = await db
        .select()
        .from(accuracyResults)
        .where(eq(accuracyResults.predictionId, pred.id))
        .limit(1);

      result.push({
        ...pred,
        actualPrice: accuracy?.actualPrice,
        isMatch: accuracy?.isMatch,
        percentageDifference: accuracy?.percentageDifference,
      });
    }

    return result.reverse();
  }

  async insertPrediction(prediction: InsertPrediction): Promise<Prediction> {
    const [result] = await db.insert(predictions).values(prediction).returning();
    return result;
  }

  async getPredictionById(id: number): Promise<Prediction | null> {
    const [result] = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, id))
      .limit(1);
    return result || null;
  }

  async getAccuracyStats(symbol: string, timeframe?: string): Promise<AccuracyStats> {
    let results: AccuracyResult[];
    
    if (timeframe) {
      const predIds = await db
        .select({ id: predictions.id })
        .from(predictions)
        .where(and(eq(predictions.symbol, symbol), eq(predictions.timeframe, timeframe)));
      
      if (predIds.length === 0) {
        return {
          totalPredictions: 0,
          matchCount: 0,
          notMatchCount: 0,
          accuracyPercent: 0,
          averageError: 0,
        };
      }

      const ids = predIds.map(p => p.id);
      results = await db
        .select()
        .from(accuracyResults)
        .where(and(
          eq(accuracyResults.symbol, symbol),
          inArray(accuracyResults.predictionId, ids)
        ));
    } else {
      results = await db
        .select()
        .from(accuracyResults)
        .where(eq(accuracyResults.symbol, symbol));
    }

    if (results.length === 0) {
      return {
        totalPredictions: 0,
        matchCount: 0,
        notMatchCount: 0,
        accuracyPercent: 0,
        averageError: 0,
      };
    }

    const matchCount = results.filter(r => r.isMatch).length;
    const notMatchCount = results.length - matchCount;
    const avgError = results.reduce((sum, r) => sum + Math.abs(r.percentageDifference), 0) / results.length;

    return {
      totalPredictions: results.length,
      matchCount,
      notMatchCount,
      accuracyPercent: (matchCount / results.length) * 100,
      averageError: avgError,
    };
  }

  async insertAccuracyResult(result: InsertAccuracyResult): Promise<AccuracyResult> {
    const [inserted] = await db.insert(accuracyResults).values(result).returning();
    return inserted;
  }

  async getSystemStatus(): Promise<SystemStatus[]> {
    return db.select().from(systemStatus).orderBy(systemStatus.component);
  }

  async upsertSystemStatus(status: InsertSystemStatus): Promise<SystemStatus> {
    const [result] = await db
      .insert(systemStatus)
      .values(status)
      .onConflictDoUpdate({
        target: systemStatus.component,
        set: {
          status: status.status,
          lastCheck: status.lastCheck,
          lastSuccess: status.lastSuccess,
          errorMessage: status.errorMessage,
          metadata: status.metadata,
        },
      })
      .returning();
    return result;
  }

  async getSystemStats(): Promise<{
    totalRecords: number;
    totalPredictions: number;
    schedulerStatus: string;
    lastSchedulerRun: string | null;
    uptime: number;
  }> {
    const [recordCount] = await db.select({ count: sql<number>`count(*)` }).from(marketData);
    const [predictionCount] = await db.select({ count: sql<number>`count(*)` }).from(predictions);
    
    const [schedulerStatus] = await db
      .select()
      .from(systemStatus)
      .where(eq(systemStatus.component, "scheduler"))
      .limit(1);

    return {
      totalRecords: Number(recordCount?.count || 0),
      totalPredictions: Number(predictionCount?.count || 0),
      schedulerStatus: schedulerStatus?.status || "stopped",
      lastSchedulerRun: schedulerStatus?.lastSuccess?.toISOString() || null,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  }

  // User Management
  async getAllUsers(): Promise<SafeUser[]> {
    const allUsers = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastLogin: users.lastLogin,
    }).from(users).orderBy(users.createdAt);
    return allUsers;
  }

  async getUserById(id: string): Promise<SafeUser | null> {
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      email: users.email,
      displayName: users.displayName,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastLogin: users.lastLogin,
    }).from(users).where(eq(users.id, id)).limit(1);
    return user || null;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [result] = await db.insert(users).values({
      ...user,
      updatedAt: new Date(),
    }).returning();
    return result;
  }

  async updateUser(id: string, data: UpdateUser): Promise<SafeUser | null> {
    const [result] = await db.update(users)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        isActive: users.isActive,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastLogin: users.lastLogin,
      });
    return result || null;
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    return result.length > 0;
  }

  // User Invites
  async createInvite(email: string, role: string, invitedById: string): Promise<UserInvite> {
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    
    const [result] = await db.insert(userInvites).values({
      email,
      token,
      role,
      invitedById,
      expiresAt,
    }).returning();
    return result;
  }

  async getInviteByToken(token: string): Promise<UserInvite | null> {
    const [result] = await db.select()
      .from(userInvites)
      .where(and(
        eq(userInvites.token, token),
        isNull(userInvites.acceptedAt),
        gte(userInvites.expiresAt, new Date())
      ))
      .limit(1);
    return result || null;
  }

  async getPendingInvites(): Promise<UserInvite[]> {
    return db.select()
      .from(userInvites)
      .where(and(
        isNull(userInvites.acceptedAt),
        gte(userInvites.expiresAt, new Date())
      ))
      .orderBy(desc(userInvites.createdAt));
  }

  async acceptInvite(token: string): Promise<UserInvite | null> {
    const [result] = await db.update(userInvites)
      .set({ acceptedAt: new Date() })
      .where(and(
        eq(userInvites.token, token),
        isNull(userInvites.acceptedAt),
        gte(userInvites.expiresAt, new Date())
      ))
      .returning();
    return result || null;
  }

  async deleteInvite(id: string): Promise<boolean> {
    const result = await db.delete(userInvites).where(eq(userInvites.id, id)).returning();
    return result.length > 0;
  }

  async getPriceState(symbol: string): Promise<PriceState | null> {
    const [result] = await db.select()
      .from(priceState)
      .where(eq(priceState.symbol, symbol))
      .limit(1);
    return result || null;
  }

  async upsertPriceState(symbol: string, lastOpen: number, lastClose: number, lastTimestamp: Date): Promise<PriceState> {
    const now = new Date();
    const existing = await this.getPriceState(symbol);
    
    if (existing) {
      const [result] = await db.update(priceState)
        .set({ 
          lastOpen, 
          lastClose, 
          lastTimestamp,
          updatedAt: now 
        })
        .where(eq(priceState.symbol, symbol))
        .returning();
      return result;
    } else {
      const [result] = await db.insert(priceState)
        .values({ 
          symbol, 
          lastOpen, 
          lastClose, 
          lastTimestamp,
          updatedAt: now 
        })
        .returning();
      return result;
    }
  }
}

export const storage = new DatabaseStorage();
