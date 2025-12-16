import { storage } from "./storage";

export interface RiskLimits {
  maxDailyLossPercent: number;       // e.g., 5% = max 5% of account can be lost per day
  maxDailyLossAmount: number;        // Absolute max daily loss in USD
  maxConsecutiveLosses: number;      // Stop after N consecutive losses
  maxOpenPositions: number;          // Maximum concurrent positions
  minTimeBetweenTrades: number;      // Minimum seconds between trades
  maxPositionSizePercent: number;    // Max single position as % of account
  requiredAiConfidence: number;      // Minimum AI confidence to trade
  requiredTechConfidence: number;    // Minimum technical confidence to trade
  cooldownAfterLossMinutes: number;  // Cooldown period after hitting limits
}

export interface RiskStatus {
  canTrade: boolean;
  reason: string;
  currentDayLoss: number;
  currentDayLossPercent: number;
  consecutiveLosses: number;
  openPositionCount: number;
  lastTradeTime: Date | null;
  isInCooldown: boolean;
  cooldownEndsAt: Date | null;
  accountBalance: number;
  todayStartBalance: number;
}

// Default conservative risk limits
const DEFAULT_LIMITS: RiskLimits = {
  maxDailyLossPercent: 3,            // Max 3% daily loss
  maxDailyLossAmount: 500,           // Max $500 daily loss
  maxConsecutiveLosses: 3,           // Stop after 3 consecutive losses
  maxOpenPositions: 2,               // Max 2 open positions
  minTimeBetweenTrades: 300,         // 5 minutes between trades
  maxPositionSizePercent: 5,         // Max 5% of account per position
  requiredAiConfidence: 75,          // Require 75%+ AI confidence
  requiredTechConfidence: 60,        // Require 60%+ technical confidence
  cooldownAfterLossMinutes: 60,      // 1 hour cooldown after hitting limits
};

class RiskManager {
  private limits: RiskLimits = DEFAULT_LIMITS;
  private cooldownEndTimes: Map<string, Date> = new Map(); // userId -> cooldown end time
  private dailyStats: Map<string, { startBalance: number; date: string }> = new Map();
  
  constructor() {
    console.log("[RiskManager] Initialized with conservative limits:");
    console.log(`  - Max daily loss: ${this.limits.maxDailyLossPercent}% or $${this.limits.maxDailyLossAmount}`);
    console.log(`  - Max consecutive losses: ${this.limits.maxConsecutiveLosses}`);
    console.log(`  - Required AI confidence: ${this.limits.requiredAiConfidence}%`);
    console.log(`  - Required tech confidence: ${this.limits.requiredTechConfidence}%`);
  }
  
  setLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    console.log("[RiskManager] Updated risk limits:", this.limits);
  }
  
  getLimits(): RiskLimits {
    return { ...this.limits };
  }
  
  async checkRiskStatus(userId: string): Promise<RiskStatus> {
    const today = new Date().toISOString().split('T')[0];
    
    // Get account info
    const account = await storage.getDemoAccount(userId);
    if (!account) {
      return {
        canTrade: false,
        reason: "No demo account found",
        currentDayLoss: 0,
        currentDayLossPercent: 0,
        consecutiveLosses: 0,
        openPositionCount: 0,
        lastTradeTime: null,
        isInCooldown: false,
        cooldownEndsAt: null,
        accountBalance: 0,
        todayStartBalance: 0,
      };
    }
    
    // Track daily starting balance
    const dailyKey = `${userId}-${today}`;
    if (!this.dailyStats.has(dailyKey)) {
      this.dailyStats.set(dailyKey, {
        startBalance: account.balance + account.totalProfit - account.totalLoss,
        date: today,
      });
    }
    const todayStats = this.dailyStats.get(dailyKey)!;
    
    // Calculate today's P&L from closed positions
    const closedToday = await this.getClosedPositionsToday(userId);
    const todayRealizedPnL = closedToday.reduce((sum, pos) => sum + (pos.profitLoss || 0), 0);
    
    // Get open positions for unrealized P&L
    const openPositions = await storage.getDemoPositions(userId, 'open');
    const unrealizedPnL = openPositions.reduce((sum, pos) => sum + (pos.profitLoss || 0), 0);
    
    const totalDayPnL = todayRealizedPnL + unrealizedPnL;
    const currentDayLoss = totalDayPnL < 0 ? Math.abs(totalDayPnL) : 0;
    const currentDayLossPercent = todayStats.startBalance > 0 
      ? (currentDayLoss / todayStats.startBalance) * 100 
      : 0;
    
    // Count consecutive losses
    const consecutiveLosses = await this.countConsecutiveLosses(userId);
    
    // Get last trade time
    const recentTrades = await storage.getDemoPositions(userId, 'all');
    const lastTrade = recentTrades.find(t => t.isAutoTrade);
    const lastTradeTime = lastTrade?.openedAt ? new Date(lastTrade.openedAt) : null;
    
    // Check cooldown
    const cooldownEnd = this.cooldownEndTimes.get(userId);
    const isInCooldown = cooldownEnd ? new Date() < cooldownEnd : false;
    
    // Determine if trading is allowed
    let canTrade = true;
    let reason = "Trading allowed";
    
    // Check daily loss limit (percentage)
    if (currentDayLossPercent >= this.limits.maxDailyLossPercent) {
      canTrade = false;
      reason = `Daily loss limit reached: ${currentDayLossPercent.toFixed(1)}% >= ${this.limits.maxDailyLossPercent}%`;
      this.startCooldown(userId);
    }
    
    // Check daily loss limit (absolute)
    if (currentDayLoss >= this.limits.maxDailyLossAmount) {
      canTrade = false;
      reason = `Daily loss limit reached: $${currentDayLoss.toFixed(2)} >= $${this.limits.maxDailyLossAmount}`;
      this.startCooldown(userId);
    }
    
    // Check consecutive losses
    if (consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      canTrade = false;
      reason = `Consecutive loss limit: ${consecutiveLosses} >= ${this.limits.maxConsecutiveLosses}`;
      this.startCooldown(userId);
    }
    
    // Check open positions limit
    const autoTradePositions = openPositions.filter(p => p.isAutoTrade);
    if (autoTradePositions.length >= this.limits.maxOpenPositions) {
      canTrade = false;
      reason = `Max open positions reached: ${autoTradePositions.length} >= ${this.limits.maxOpenPositions}`;
    }
    
    // Check minimum time between trades
    if (lastTradeTime) {
      const secondsSinceLastTrade = (Date.now() - lastTradeTime.getTime()) / 1000;
      if (secondsSinceLastTrade < this.limits.minTimeBetweenTrades) {
        canTrade = false;
        const waitTime = Math.ceil(this.limits.minTimeBetweenTrades - secondsSinceLastTrade);
        reason = `Too soon since last trade. Wait ${waitTime}s`;
      }
    }
    
    // Check cooldown
    if (isInCooldown && cooldownEnd) {
      canTrade = false;
      const minsLeft = Math.ceil((cooldownEnd.getTime() - Date.now()) / 60000);
      reason = `In cooldown period. ${minsLeft} minutes remaining`;
    }
    
    return {
      canTrade,
      reason,
      currentDayLoss,
      currentDayLossPercent,
      consecutiveLosses,
      openPositionCount: autoTradePositions.length,
      lastTradeTime,
      isInCooldown,
      cooldownEndsAt: isInCooldown ? cooldownEnd! : null,
      accountBalance: account.balance,
      todayStartBalance: todayStats.startBalance,
    };
  }
  
  private async getClosedPositionsToday(userId: string): Promise<any[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const allClosed = await storage.getDemoPositions(userId, 'closed');
    return allClosed.filter(pos => {
      if (!pos.closedAt) return false;
      const closedDate = new Date(pos.closedAt);
      return closedDate >= today && pos.isAutoTrade;
    });
  }
  
  private async countConsecutiveLosses(userId: string): Promise<number> {
    const recentTrades = await storage.getDemoPositions(userId, 'closed');
    const autoTrades = recentTrades
      .filter(t => t.isAutoTrade)
      .sort((a, b) => {
        const dateA = a.closedAt ? new Date(a.closedAt).getTime() : 0;
        const dateB = b.closedAt ? new Date(b.closedAt).getTime() : 0;
        return dateB - dateA; // Most recent first
      });
    
    let consecutiveLosses = 0;
    for (const trade of autoTrades) {
      if ((trade.profitLoss || 0) < 0) {
        consecutiveLosses++;
      } else {
        break; // First win breaks the streak
      }
    }
    
    return consecutiveLosses;
  }
  
  private startCooldown(userId: string): void {
    const cooldownEnd = new Date(Date.now() + this.limits.cooldownAfterLossMinutes * 60 * 1000);
    this.cooldownEndTimes.set(userId, cooldownEnd);
    console.log(`[RiskManager] Started cooldown for user ${userId} until ${cooldownEnd.toISOString()}`);
  }
  
  clearCooldown(userId: string): void {
    this.cooldownEndTimes.delete(userId);
    console.log(`[RiskManager] Cleared cooldown for user ${userId}`);
  }
  
  validatePositionSize(accountBalance: number, positionValue: number): { valid: boolean; reason: string } {
    const positionPercent = (positionValue / accountBalance) * 100;
    
    if (positionPercent > this.limits.maxPositionSizePercent) {
      return {
        valid: false,
        reason: `Position size ${positionPercent.toFixed(1)}% exceeds max ${this.limits.maxPositionSizePercent}%`,
      };
    }
    
    return { valid: true, reason: "Position size acceptable" };
  }
  
  validateConfidence(aiConfidence: number, techConfidence: number): { valid: boolean; reason: string } {
    if (aiConfidence < this.limits.requiredAiConfidence) {
      return {
        valid: false,
        reason: `AI confidence ${aiConfidence}% < required ${this.limits.requiredAiConfidence}%`,
      };
    }
    
    if (techConfidence < this.limits.requiredTechConfidence) {
      return {
        valid: false,
        reason: `Technical confidence ${techConfidence}% < required ${this.limits.requiredTechConfidence}%`,
      };
    }
    
    return { valid: true, reason: "Confidence levels acceptable" };
  }
  
  // Get recommended position size based on risk management
  getRecommendedPositionSize(
    accountBalance: number,
    stopLossPercent: number,
    riskPerTradePercent: number = 1 // Default 1% risk per trade
  ): { quantity: number; maxLoss: number } {
    // Risk per trade = account balance * risk percentage
    const maxLoss = accountBalance * (riskPerTradePercent / 100);
    
    // Position size = Max loss / Stop loss percentage
    // If SL is 2% and max loss is $100, position can be $5000
    const positionValue = stopLossPercent > 0 ? maxLoss / (stopLossPercent / 100) : 0;
    
    return {
      quantity: positionValue,
      maxLoss,
    };
  }
}

export const riskManager = new RiskManager();
