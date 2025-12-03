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
