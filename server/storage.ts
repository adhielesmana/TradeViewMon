import { 
  marketData, predictions, accuracyResults, systemStatus, users, userInvites, priceState, aiSuggestions,
  demoAccounts, demoPositions, demoTransactions,
  type MarketData, type InsertMarketData,
  type Prediction, type InsertPrediction,
  type AccuracyResult, type InsertAccuracyResult,
  type SystemStatus, type InsertSystemStatus,
  type MarketStats, type AccuracyStats, type PredictionWithResult,
  type User, type SafeUser, type InsertUser, type UpdateUser,
  type UserInvite, type InsertUserInvite,
  type PriceState, type InsertPriceState,
  type AiSuggestion, type InsertAiSuggestion, type AiSuggestionAccuracyStats,
  type DemoAccount, type InsertDemoAccount,
  type DemoPosition, type InsertDemoPosition,
  type DemoTransaction, type InsertDemoTransaction,
  type DemoAccountStats
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

  // AI Suggestions
  insertAiSuggestion(suggestion: InsertAiSuggestion): Promise<AiSuggestion>;
  getLatestAiSuggestion(symbol: string): Promise<AiSuggestion | null>;
  getRecentAiSuggestions(symbol: string, limit?: number): Promise<AiSuggestion[]>;
  getUnevaluatedSuggestions(olderThanMinutes?: number): Promise<AiSuggestion[]>;
  evaluateAiSuggestion(id: number, actualPrice: number, wasAccurate: boolean, profitLoss: number): Promise<AiSuggestion | null>;
  getAiSuggestionAccuracyStats(symbol: string): Promise<AiSuggestionAccuracyStats>;

  // Demo Trading - Accounts
  getDemoAccount(userId: string): Promise<DemoAccount | null>;
  createDemoAccount(userId: string): Promise<DemoAccount>;
  updateDemoAccountBalance(accountId: number, balance: number): Promise<DemoAccount | null>;
  getDemoAccountStats(userId: string): Promise<DemoAccountStats | null>;

  // Demo Trading - Positions
  getDemoPositions(userId: string, status?: string): Promise<DemoPosition[]>;
  getDemoPositionById(id: number): Promise<DemoPosition | null>;
  createDemoPosition(position: InsertDemoPosition): Promise<DemoPosition>;
  updateDemoPosition(id: number, updates: Partial<DemoPosition>): Promise<DemoPosition | null>;
  closeDemoPosition(id: number, exitPrice: number, reason: string): Promise<DemoPosition | null>;

  // Demo Trading - Transactions
  getDemoTransactions(userId: string, limit?: number): Promise<DemoTransaction[]>;
  createDemoTransaction(transaction: InsertDemoTransaction): Promise<DemoTransaction>;

  // Demo Trading - Combined Operations
  depositDemoCredits(userId: string, amount: number): Promise<{ account: DemoAccount; transaction: DemoTransaction }>;
  withdrawDemoCredits(userId: string, amount: number): Promise<{ account: DemoAccount; transaction: DemoTransaction } | null>;
  openDemoTrade(userId: string, symbol: string, type: 'BUY' | 'SELL', entryPrice: number, quantity: number, stopLoss?: number, takeProfit?: number): Promise<{ position: DemoPosition; transaction: DemoTransaction } | null>;
  closeDemoTrade(userId: string, positionId: number, exitPrice: number): Promise<{ position: DemoPosition; transaction: DemoTransaction } | null>;
  updateOpenPositionPrices(symbol: string, currentPrice: number): Promise<void>;
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

  // AI Suggestions
  async insertAiSuggestion(suggestion: InsertAiSuggestion): Promise<AiSuggestion> {
    const [result] = await db.insert(aiSuggestions).values(suggestion).returning();
    return result;
  }

  async getLatestAiSuggestion(symbol: string): Promise<AiSuggestion | null> {
    const [result] = await db.select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.symbol, symbol))
      .orderBy(desc(aiSuggestions.generatedAt))
      .limit(1);
    return result || null;
  }

  async getRecentAiSuggestions(symbol: string, limit: number = 50): Promise<AiSuggestion[]> {
    const results = await db.select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.symbol, symbol))
      .orderBy(desc(aiSuggestions.generatedAt))
      .limit(limit);
    return results.reverse();
  }

  async getUnevaluatedSuggestions(olderThanMinutes: number = 5): Promise<AiSuggestion[]> {
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);
    return db.select()
      .from(aiSuggestions)
      .where(and(
        eq(aiSuggestions.isEvaluated, false),
        lte(aiSuggestions.generatedAt, cutoffTime)
      ))
      .orderBy(aiSuggestions.generatedAt);
  }

  async evaluateAiSuggestion(id: number, actualPrice: number, wasAccurate: boolean, profitLoss: number): Promise<AiSuggestion | null> {
    const [result] = await db.update(aiSuggestions)
      .set({
        isEvaluated: true,
        evaluatedAt: new Date(),
        actualPrice,
        wasAccurate,
        profitLoss,
      })
      .where(eq(aiSuggestions.id, id))
      .returning();
    return result || null;
  }

  async getAiSuggestionAccuracyStats(symbol: string): Promise<AiSuggestionAccuracyStats> {
    const allSuggestions = await db.select()
      .from(aiSuggestions)
      .where(eq(aiSuggestions.symbol, symbol));
    
    const evaluated = allSuggestions.filter(s => s.isEvaluated);
    const accurate = evaluated.filter(s => s.wasAccurate);
    
    const buySuggestions = evaluated.filter(s => s.decision === "BUY");
    const sellSuggestions = evaluated.filter(s => s.decision === "SELL");
    const holdSuggestions = evaluated.filter(s => s.decision === "HOLD");
    
    const buyAccurate = buySuggestions.filter(s => s.wasAccurate).length;
    const sellAccurate = sellSuggestions.filter(s => s.wasAccurate).length;
    const holdAccurate = holdSuggestions.filter(s => s.wasAccurate).length;
    
    const avgProfitLoss = evaluated.length > 0
      ? evaluated.reduce((sum, s) => sum + (s.profitLoss || 0), 0) / evaluated.length
      : 0;

    return {
      totalSuggestions: allSuggestions.length,
      evaluatedCount: evaluated.length,
      accurateCount: accurate.length,
      inaccurateCount: evaluated.length - accurate.length,
      accuracyPercent: evaluated.length > 0 ? (accurate.length / evaluated.length) * 100 : 0,
      avgProfitLoss,
      buyAccuracy: buySuggestions.length > 0 ? (buyAccurate / buySuggestions.length) * 100 : 0,
      sellAccuracy: sellSuggestions.length > 0 ? (sellAccurate / sellSuggestions.length) * 100 : 0,
      holdAccuracy: holdSuggestions.length > 0 ? (holdAccurate / holdSuggestions.length) * 100 : 0,
    };
  }

  // Demo Trading - Accounts
  async getDemoAccount(userId: string): Promise<DemoAccount | null> {
    const [result] = await db.select()
      .from(demoAccounts)
      .where(eq(demoAccounts.userId, userId))
      .limit(1);
    return result || null;
  }

  async createDemoAccount(userId: string): Promise<DemoAccount> {
    const [result] = await db.insert(demoAccounts)
      .values({
        userId,
        balance: 0,
        totalDeposited: 0,
        totalWithdrawn: 0,
        totalProfit: 0,
        totalLoss: 0,
      })
      .returning();
    return result;
  }

  async updateDemoAccountBalance(accountId: number, balance: number): Promise<DemoAccount | null> {
    const [result] = await db.update(demoAccounts)
      .set({ balance, updatedAt: new Date() })
      .where(eq(demoAccounts.id, accountId))
      .returning();
    return result || null;
  }

  async getDemoAccountStats(userId: string): Promise<DemoAccountStats | null> {
    const account = await this.getDemoAccount(userId);
    if (!account) return null;

    const openPositions = await db.select()
      .from(demoPositions)
      .where(and(
        eq(demoPositions.userId, userId),
        eq(demoPositions.status, 'open')
      ));

    const closedPositions = await db.select()
      .from(demoPositions)
      .where(and(
        eq(demoPositions.userId, userId),
        eq(demoPositions.status, 'closed')
      ));

    const winningTrades = closedPositions.filter(p => (p.profitLoss || 0) > 0);
    const winRate = closedPositions.length > 0 
      ? (winningTrades.length / closedPositions.length) * 100 
      : 0;

    return {
      balance: account.balance,
      totalDeposited: account.totalDeposited,
      totalWithdrawn: account.totalWithdrawn,
      totalProfit: account.totalProfit,
      totalLoss: account.totalLoss,
      netProfitLoss: account.totalProfit - account.totalLoss,
      profitLossPercent: account.totalDeposited > 0 
        ? ((account.totalProfit - account.totalLoss) / account.totalDeposited) * 100 
        : 0,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
      winRate,
    };
  }

  // Demo Trading - Positions
  async getDemoPositions(userId: string, status?: string): Promise<DemoPosition[]> {
    const conditions = [eq(demoPositions.userId, userId)];
    if (status) {
      conditions.push(eq(demoPositions.status, status));
    }
    
    return db.select()
      .from(demoPositions)
      .where(and(...conditions))
      .orderBy(desc(demoPositions.openedAt));
  }

  async getDemoPositionById(id: number): Promise<DemoPosition | null> {
    const [result] = await db.select()
      .from(demoPositions)
      .where(eq(demoPositions.id, id))
      .limit(1);
    return result || null;
  }

  async createDemoPosition(position: InsertDemoPosition): Promise<DemoPosition> {
    const [result] = await db.insert(demoPositions)
      .values(position)
      .returning();
    return result;
  }

  async updateDemoPosition(id: number, updates: Partial<DemoPosition>): Promise<DemoPosition | null> {
    const [result] = await db.update(demoPositions)
      .set(updates)
      .where(eq(demoPositions.id, id))
      .returning();
    return result || null;
  }

  async closeDemoPosition(id: number, exitPrice: number, reason: string): Promise<DemoPosition | null> {
    const position = await this.getDemoPositionById(id);
    if (!position) return null;

    const profitLoss = position.type === 'BUY'
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
    
    const profitLossPercent = ((profitLoss) / (position.entryPrice * position.quantity)) * 100;

    const [result] = await db.update(demoPositions)
      .set({
        exitPrice,
        profitLoss,
        profitLossPercent,
        status: 'closed',
        closedAt: new Date(),
        closedReason: reason,
      })
      .where(eq(demoPositions.id, id))
      .returning();
    return result || null;
  }

  // Demo Trading - Transactions
  async getDemoTransactions(userId: string, limit: number = 50): Promise<DemoTransaction[]> {
    return db.select()
      .from(demoTransactions)
      .where(eq(demoTransactions.userId, userId))
      .orderBy(desc(demoTransactions.createdAt))
      .limit(limit);
  }

  async createDemoTransaction(transaction: InsertDemoTransaction): Promise<DemoTransaction> {
    const [result] = await db.insert(demoTransactions)
      .values(transaction)
      .returning();
    return result;
  }

  // Demo Trading - Combined Operations
  async depositDemoCredits(userId: string, amount: number): Promise<{ account: DemoAccount; transaction: DemoTransaction }> {
    let account = await this.getDemoAccount(userId);
    if (!account) {
      account = await this.createDemoAccount(userId);
    }

    const newBalance = account.balance + amount;
    const [updatedAccount] = await db.update(demoAccounts)
      .set({
        balance: newBalance,
        totalDeposited: account.totalDeposited + amount,
        updatedAt: new Date(),
      })
      .where(eq(demoAccounts.id, account.id))
      .returning();

    const transaction = await this.createDemoTransaction({
      accountId: account.id,
      userId,
      type: 'deposit',
      amount,
      balanceAfter: newBalance,
      description: `Deposited $${amount.toFixed(2)} demo credits`,
    });

    return { account: updatedAccount, transaction };
  }

  async withdrawDemoCredits(userId: string, amount: number): Promise<{ account: DemoAccount; transaction: DemoTransaction } | null> {
    const account = await this.getDemoAccount(userId);
    if (!account || account.balance < amount) return null;

    const newBalance = account.balance - amount;
    const [updatedAccount] = await db.update(demoAccounts)
      .set({
        balance: newBalance,
        totalWithdrawn: account.totalWithdrawn + amount,
        updatedAt: new Date(),
      })
      .where(eq(demoAccounts.id, account.id))
      .returning();

    const transaction = await this.createDemoTransaction({
      accountId: account.id,
      userId,
      type: 'withdraw',
      amount: -amount,
      balanceAfter: newBalance,
      description: `Withdrew $${amount.toFixed(2)} demo credits`,
    });

    return { account: updatedAccount, transaction };
  }

  async openDemoTrade(
    userId: string, 
    symbol: string, 
    type: 'BUY' | 'SELL', 
    entryPrice: number, 
    quantity: number, 
    stopLoss?: number, 
    takeProfit?: number
  ): Promise<{ position: DemoPosition; transaction: DemoTransaction } | null> {
    const account = await this.getDemoAccount(userId);
    if (!account) return null;

    const tradeValue = entryPrice * quantity;
    if (account.balance < tradeValue) return null;

    const newBalance = account.balance - tradeValue;
    await db.update(demoAccounts)
      .set({ balance: newBalance, updatedAt: new Date() })
      .where(eq(demoAccounts.id, account.id));

    const position = await this.createDemoPosition({
      accountId: account.id,
      userId,
      symbol,
      type,
      entryPrice,
      quantity,
      currentPrice: entryPrice,
      stopLoss: stopLoss || null,
      takeProfit: takeProfit || null,
      status: 'open',
    });

    const transaction = await this.createDemoTransaction({
      accountId: account.id,
      userId,
      type: 'trade_open',
      amount: -tradeValue,
      balanceAfter: newBalance,
      description: `Opened ${type} position: ${quantity} ${symbol} @ $${entryPrice.toFixed(2)}`,
      positionId: position.id,
    });

    return { position, transaction };
  }

  async closeDemoTrade(userId: string, positionId: number, exitPrice: number): Promise<{ position: DemoPosition; transaction: DemoTransaction } | null> {
    const position = await this.getDemoPositionById(positionId);
    if (!position || position.userId !== userId || position.status !== 'open') return null;

    const account = await this.getDemoAccount(userId);
    if (!account) return null;

    const profitLoss = position.type === 'BUY'
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;

    const tradeValue = exitPrice * position.quantity;
    const newBalance = account.balance + tradeValue;

    await db.update(demoAccounts)
      .set({
        balance: newBalance,
        totalProfit: profitLoss > 0 ? account.totalProfit + profitLoss : account.totalProfit,
        totalLoss: profitLoss < 0 ? account.totalLoss + Math.abs(profitLoss) : account.totalLoss,
        updatedAt: new Date(),
      })
      .where(eq(demoAccounts.id, account.id));

    const closedPosition = await this.closeDemoPosition(positionId, exitPrice, 'manual');
    if (!closedPosition) return null;

    const transaction = await this.createDemoTransaction({
      accountId: account.id,
      userId,
      type: profitLoss >= 0 ? 'profit' : 'loss',
      amount: tradeValue,
      balanceAfter: newBalance,
      description: `Closed ${position.type} position: ${position.quantity} ${position.symbol} @ $${exitPrice.toFixed(2)} (${profitLoss >= 0 ? '+' : ''}$${profitLoss.toFixed(2)})`,
      positionId: position.id,
    });

    return { position: closedPosition, transaction };
  }

  async updateOpenPositionPrices(symbol: string, currentPrice: number): Promise<void> {
    const openPositions = await db.select()
      .from(demoPositions)
      .where(and(
        eq(demoPositions.symbol, symbol),
        eq(demoPositions.status, 'open')
      ));

    for (const position of openPositions) {
      const profitLoss = position.type === 'BUY'
        ? (currentPrice - position.entryPrice) * position.quantity
        : (position.entryPrice - currentPrice) * position.quantity;
      
      const profitLossPercent = ((profitLoss) / (position.entryPrice * position.quantity)) * 100;

      await db.update(demoPositions)
        .set({
          currentPrice,
          profitLoss,
          profitLossPercent,
        })
        .where(eq(demoPositions.id, position.id));

      // Check for stop loss / take profit triggers
      if (position.stopLoss && (
        (position.type === 'BUY' && currentPrice <= position.stopLoss) ||
        (position.type === 'SELL' && currentPrice >= position.stopLoss)
      )) {
        await this.closeDemoTrade(position.userId, position.id, currentPrice);
      } else if (position.takeProfit && (
        (position.type === 'BUY' && currentPrice >= position.takeProfit) ||
        (position.type === 'SELL' && currentPrice <= position.takeProfit)
      )) {
        await this.closeDemoTrade(position.userId, position.id, currentPrice);
      }
    }
  }
}

export const storage = new DatabaseStorage();
