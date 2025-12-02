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

// Types
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;

export type Prediction = typeof predictions.$inferSelect;
export type InsertPrediction = z.infer<typeof insertPredictionSchema>;

export type AccuracyResult = typeof accuracyResults.$inferSelect;
export type InsertAccuracyResult = z.infer<typeof insertAccuracyResultSchema>;

export type SystemStatus = typeof systemStatus.$inferSelect;
export type InsertSystemStatus = z.infer<typeof insertSystemStatusSchema>;

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

// Legacy user schema (kept for compatibility)
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
