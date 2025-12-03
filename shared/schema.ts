import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Market Data - stores OHLCV candles (historical and real-time)
export const marketData = pgTable("market_data", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  open: real("open").notNull(),
  high: real("high").notNull(),
  low: real("low").notNull(),
  close: real("close").notNull(),
  volume: integer("volume").notNull(),
  interval: varchar("interval", { length: 10 }).notNull().default("1min"),
}, (table) => [
  index("market_data_symbol_timestamp_idx").on(table.symbol, table.timestamp),
  index("market_data_timestamp_idx").on(table.timestamp),
]);

// Predictions - stores predicted values
export const predictions = pgTable("predictions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  predictionTimestamp: timestamp("prediction_timestamp").notNull(),
  targetTimestamp: timestamp("target_timestamp").notNull(),
  predictedPrice: real("predicted_price").notNull(),
  predictedDirection: varchar("predicted_direction", { length: 10 }).notNull(), // 'UP', 'DOWN', 'NEUTRAL'
  modelType: varchar("model_type", { length: 50 }).notNull().default("moving_average"),
  confidence: real("confidence"),
  timeframe: varchar("timeframe", { length: 10 }).notNull().default("1min"), // '1min', '5min', '15min'
}, (table) => [
  index("predictions_symbol_target_idx").on(table.symbol, table.targetTimestamp),
  index("predictions_timeframe_idx").on(table.timeframe),
]);

// Accuracy Results - comparison of predictions vs actual
export const accuracyResults = pgTable("accuracy_results", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  predictionId: integer("prediction_id").notNull().references(() => predictions.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  predictedPrice: real("predicted_price").notNull(),
  actualPrice: real("actual_price").notNull(),
  priceDifference: real("price_difference").notNull(),
  percentageDifference: real("percentage_difference").notNull(),
  isMatch: boolean("is_match").notNull(),
  matchThreshold: real("match_threshold").notNull().default(0.5), // percentage threshold
}, (table) => [
  index("accuracy_results_symbol_idx").on(table.symbol),
  index("accuracy_results_timestamp_idx").on(table.timestamp),
]);

// System Status - tracks API health, scheduler status, etc.
export const systemStatus = pgTable("system_status", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  component: varchar("component", { length: 50 }).notNull().unique(),
  status: varchar("status", { length: 20 }).notNull(), // 'healthy', 'degraded', 'error'
  lastCheck: timestamp("last_check").notNull(),
  lastSuccess: timestamp("last_success"),
  errorMessage: text("error_message"),
  metadata: text("metadata"), // JSON string for additional info
});

// Price State - stores last open/close prices for continuity
export const priceState = pgTable("price_state", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  lastOpen: real("last_open").notNull(),
  lastClose: real("last_close").notNull(),
  lastTimestamp: timestamp("last_timestamp").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// Define relations
export const predictionsRelations = relations(predictions, ({ one }) => ({
  accuracyResult: one(accuracyResults, {
    fields: [predictions.id],
    references: [accuracyResults.predictionId],
  }),
}));

export const accuracyResultsRelations = relations(accuracyResults, ({ one }) => ({
  prediction: one(predictions, {
    fields: [accuracyResults.predictionId],
    references: [predictions.id],
  }),
}));

// Insert schemas
export const insertMarketDataSchema = createInsertSchema(marketData).omit({ id: true });
export const insertPredictionSchema = createInsertSchema(predictions).omit({ id: true });
export const insertAccuracyResultSchema = createInsertSchema(accuracyResults).omit({ id: true });
export const insertSystemStatusSchema = createInsertSchema(systemStatus).omit({ id: true });
export const insertPriceStateSchema = createInsertSchema(priceState).omit({ id: true });

// Types
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;

export type Prediction = typeof predictions.$inferSelect;
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;

export type AccuracyResult = typeof accuracyResults.$inferSelect;
export type InsertAccuracyResult = z.infer<typeof insertAccuracyResultSchema>;

export type SystemStatus = typeof systemStatus.$inferSelect;
export type InsertSystemStatus = z.infer<typeof insertSystemStatusSchema>;

export type PriceState = typeof priceState.$inferSelect;
export type InsertPriceState = z.infer<typeof insertPriceStateSchema>;

// API Response Types for frontend
export type MarketStats = {
  currentPrice: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  lastUpdate: string;
};

export type AccuracyStats = {
  totalPredictions: number;
  matchCount: number;
  notMatchCount: number;
  accuracyPercent: number;
  averageError: number;
};

export type PredictionWithResult = Prediction & {
  actualPrice?: number;
  isMatch?: boolean;
  percentageDifference?: number;
};

// Users - authentication with roles
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  displayName: text("display_name"),
  password: text("password").notNull(), // Always stored as bcrypt hash
  role: varchar("role", { length: 20 }).notNull().default("user"), // 'superadmin', 'admin', 'user'
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
  lastLogin: timestamp("last_login"),
});

// User Invites - for inviting new users
export const userInvites = pgTable("user_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  invitedById: varchar("invited_by_id").references(() => users.id),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
  displayName: true,
  password: true,
  role: true,
  isActive: true,
});

export const updateUserSchema = createInsertSchema(users).pick({
  email: true,
  displayName: true,
  role: true,
  isActive: true,
}).partial();

export const insertUserInviteSchema = createInsertSchema(userInvites).pick({
  email: true,
  role: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type User = typeof users.$inferSelect;
export type SafeUser = Omit<User, "password">; // User without password for API responses
export type UserInvite = typeof userInvites.$inferSelect;
export type InsertUserInvite = z.infer<typeof insertUserInviteSchema>;

// AI Suggestions - stores AI-generated trading suggestions
export const aiSuggestions = pgTable("ai_suggestions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  generatedAt: timestamp("generated_at").notNull(),
  decision: varchar("decision", { length: 10 }).notNull(), // 'BUY', 'SELL', 'HOLD'
  confidence: real("confidence").notNull(), // 0-100
  buyTarget: real("buy_target"), // Target price for buy
  sellTarget: real("sell_target"), // Target price for sell
  currentPrice: real("current_price").notNull(),
  reasoning: text("reasoning"), // JSON string with analysis breakdown
  indicators: text("indicators"), // JSON string with indicator values used
  isEvaluated: boolean("is_evaluated").notNull().default(false),
  evaluatedAt: timestamp("evaluated_at"),
  actualPrice: real("actual_price"), // Price when evaluated
  wasAccurate: boolean("was_accurate"), // Whether suggestion was profitable
  profitLoss: real("profit_loss"), // Percentage gain/loss
}, (table) => [
  index("ai_suggestions_symbol_idx").on(table.symbol),
  index("ai_suggestions_generated_at_idx").on(table.generatedAt),
  index("ai_suggestions_symbol_generated_idx").on(table.symbol, table.generatedAt),
]);

export const insertAiSuggestionSchema = createInsertSchema(aiSuggestions).omit({ id: true });
export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type InsertAiSuggestion = z.infer<typeof insertAiSuggestionSchema>;

// AI Suggestion Accuracy Stats (computed type)
export type AiSuggestionAccuracyStats = {
  totalSuggestions: number;
  evaluatedCount: number;
  accurateCount: number;
  inaccurateCount: number;
  accuracyPercent: number;
  avgProfitLoss: number;
  buyAccuracy: number;
  sellAccuracy: number;
  holdAccuracy: number;
};

// Monitored Symbols - configurable list of financial instruments
export const monitoredSymbols = pgTable("monitored_symbols", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: varchar("symbol", { length: 20 }).notNull().unique(),
  displayName: varchar("display_name", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(), // 'commodities', 'indices', 'crypto', 'bonds'
  isActive: boolean("is_active").notNull().default(true),
  priority: integer("priority").notNull().default(0), // Higher = more important
});

export const insertMonitoredSymbolSchema = createInsertSchema(monitoredSymbols).omit({ id: true });
export type MonitoredSymbol = typeof monitoredSymbols.$inferSelect;
export type InsertMonitoredSymbol = z.infer<typeof insertMonitoredSymbolSchema>;

// Demo Trading - Demo Accounts for paper trading
export const demoAccounts = pgTable("demo_accounts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id),
  balance: real("balance").notNull().default(0),
  totalDeposited: real("total_deposited").notNull().default(0),
  totalWithdrawn: real("total_withdrawn").notNull().default(0),
  totalProfit: real("total_profit").notNull().default(0),
  totalLoss: real("total_loss").notNull().default(0),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("demo_accounts_user_idx").on(table.userId),
]);

// Demo Positions - Open and closed trading positions
export const demoPositions = pgTable("demo_positions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => demoAccounts.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  type: varchar("type", { length: 10 }).notNull(), // 'BUY' or 'SELL'
  entryPrice: real("entry_price").notNull(),
  quantity: real("quantity").notNull(),
  currentPrice: real("current_price"),
  exitPrice: real("exit_price"),
  stopLoss: real("stop_loss"),
  takeProfit: real("take_profit"),
  profitLoss: real("profit_loss").default(0),
  profitLossPercent: real("profit_loss_percent").default(0),
  status: varchar("status", { length: 20 }).notNull().default("open"), // 'open', 'closed', 'stopped'
  openedAt: timestamp("opened_at").notNull().default(sql`now()`),
  closedAt: timestamp("closed_at"),
  closedReason: varchar("closed_reason", { length: 50 }), // 'manual', 'stop_loss', 'take_profit'
}, (table) => [
  index("demo_positions_account_idx").on(table.accountId),
  index("demo_positions_user_idx").on(table.userId),
  index("demo_positions_symbol_idx").on(table.symbol),
  index("demo_positions_status_idx").on(table.status),
]);

// Demo Transactions - All account transactions (deposits, withdrawals, trades)
export const demoTransactions = pgTable("demo_transactions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  accountId: integer("account_id").notNull().references(() => demoAccounts.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: varchar("type", { length: 20 }).notNull(), // 'deposit', 'withdraw', 'trade_open', 'trade_close', 'profit', 'loss'
  amount: real("amount").notNull(),
  balanceAfter: real("balance_after").notNull(),
  description: text("description"),
  positionId: integer("position_id").references(() => demoPositions.id),
  createdAt: timestamp("created_at").notNull().default(sql`now()`),
}, (table) => [
  index("demo_transactions_account_idx").on(table.accountId),
  index("demo_transactions_user_idx").on(table.userId),
  index("demo_transactions_type_idx").on(table.type),
  index("demo_transactions_created_idx").on(table.createdAt),
]);

// Demo Trading Relations
export const demoAccountsRelations = relations(demoAccounts, ({ one, many }) => ({
  user: one(users, {
    fields: [demoAccounts.userId],
    references: [users.id],
  }),
  positions: many(demoPositions),
  transactions: many(demoTransactions),
}));

export const demoPositionsRelations = relations(demoPositions, ({ one, many }) => ({
  account: one(demoAccounts, {
    fields: [demoPositions.accountId],
    references: [demoAccounts.id],
  }),
  user: one(users, {
    fields: [demoPositions.userId],
    references: [users.id],
  }),
  transactions: many(demoTransactions),
}));

export const demoTransactionsRelations = relations(demoTransactions, ({ one }) => ({
  account: one(demoAccounts, {
    fields: [demoTransactions.accountId],
    references: [demoAccounts.id],
  }),
  user: one(users, {
    fields: [demoTransactions.userId],
    references: [users.id],
  }),
  position: one(demoPositions, {
    fields: [demoTransactions.positionId],
    references: [demoPositions.id],
  }),
}));

// Insert schemas for demo trading
export const insertDemoAccountSchema = createInsertSchema(demoAccounts).omit({ id: true });
export const insertDemoPositionSchema = createInsertSchema(demoPositions).omit({ id: true });
export const insertDemoTransactionSchema = createInsertSchema(demoTransactions).omit({ id: true });

// Types for demo trading
export type DemoAccount = typeof demoAccounts.$inferSelect;
export type InsertDemoAccount = z.infer<typeof insertDemoAccountSchema>;

export type DemoPosition = typeof demoPositions.$inferSelect;
export type InsertDemoPosition = z.infer<typeof insertDemoPositionSchema>;

export type DemoTransaction = typeof demoTransactions.$inferSelect;
export type InsertDemoTransaction = z.infer<typeof insertDemoTransactionSchema>;

// Demo Account Stats (computed type)
export type DemoAccountStats = {
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  totalProfit: number;
  totalLoss: number;
  netProfitLoss: number;
  profitLossPercent: number;
  openPositions: number;
  closedPositions: number;
  winRate: number;
};

// App Settings - stores application configuration
export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
});

export const insertAppSettingSchema = createInsertSchema(appSettings).omit({ id: true });
export type AppSetting = typeof appSettings.$inferSelect;
export type InsertAppSetting = z.infer<typeof insertAppSettingSchema>;

// Currency Rates - cached exchange rates from EUR base
export const currencyRates = pgTable("currency_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  baseCurrency: varchar("base_currency", { length: 10 }).notNull().default("USD"),
  targetCurrency: varchar("target_currency", { length: 10 }).notNull(),
  rate: real("rate").notNull(),
  source: varchar("source", { length: 50 }).notNull().default("frankfurter"),
  fetchedAt: timestamp("fetched_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().default(sql`now()`),
}, (table) => [
  index("currency_rates_base_target_idx").on(table.baseCurrency, table.targetCurrency),
]);

export const insertCurrencyRateSchema = createInsertSchema(currencyRates).omit({ id: true });
export type CurrencyRate = typeof currencyRates.$inferSelect;
export type InsertCurrencyRate = z.infer<typeof insertCurrencyRateSchema>;

// Currency Rate API Response type
export type CurrencyRateResponse = {
  code: string;
  name: string;
  symbol: string;
  rate: number;
  lastUpdated: string;
};
