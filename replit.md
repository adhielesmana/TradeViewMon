# TradeViewMon - Stock Market Prediction Platform

## Overview

TradeViewMon is a full-stack financial application that combines real-time stock market data monitoring with AI-powered price predictions. The platform continuously fetches market data, generates short-term price predictions using ensemble machine learning models, and tracks prediction accuracy to provide users with actionable insights into market movements.

The application is designed for traders and financial analysts who need reliable real-time data combined with predictive analytics to make informed trading decisions.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React 18+ with TypeScript using Vite as the build tool

**UI Component System**: Shadcn/ui components built on Radix UI primitives with Tailwind CSS for styling. The design follows a professional trading platform aesthetic inspired by TradingView and Bloomberg Terminal, emphasizing data density and real-time clarity.

**State Management**: TanStack Query (React Query) for server state management with aggressive caching strategies. No global client state management - components fetch data independently with 30-60 second refetch intervals for real-time updates.

**Routing**: Wouter for lightweight client-side routing with four main pages:
- Live Market: Real-time price monitoring and current market statistics
- Predictions: AI prediction visualization with accuracy tracking
- Historical: Historical data analysis with configurable time ranges
- System Status: Health monitoring and system metrics

**Design System**: 
- Typography: Inter for UI, JetBrains Mono for numerical data
- Color semantics: Dedicated profit (green), loss (red), and neutral (gray) colors for financial data
- Theme support: Dark/light mode with system preference detection
- Responsive grid layouts optimized for dashboard-style data display

### Backend Architecture

**Runtime**: Node.js with Express.js HTTP server

**API Design**: RESTful endpoints with JSON responses:
- `/api/market/*`: Market data queries (recent, historical, stats)
- `/api/predictions/*`: Prediction data and accuracy metrics
- `/api/system/*`: System health and status information

**Scheduler System**: Node-cron based job scheduler that runs every minute to:
1. Fetch latest market data from external API or generate simulated data
2. Store new candles in the database
3. Generate predictions using the ensemble model
4. Compare predictions against actual prices
5. Calculate and store accuracy metrics

**Prediction Engine**: Ensemble approach combining:
- Moving Average predictions for trend analysis
- Linear Regression for price trajectory
- Outputs: predicted price, direction (UP/DOWN/NEUTRAL), and confidence score
- Configurable match threshold (default 0.5%) for accuracy determination

**Market Data Service**: Abstracted service layer supporting:
- External API integration (designed for Alpha Vantage, AllTick, or similar)
- Simulated data generation for development/testing
- Historical data backfill (generates 30+ days of minute-by-minute data)
- Real-time data fetching with 1-minute intervals

### Database Architecture

**ORM**: Drizzle ORM with PostgreSQL dialect (configured for Neon serverless)

**Schema Design**:

1. **market_data**: OHLCV candles with timestamp indexing
   - Stores: symbol, timestamp, open, high, low, close, volume, interval
   - Indexed on: (symbol, timestamp) for fast range queries

2. **predictions**: AI-generated predictions
   - Stores: prediction timestamp, target timestamp, predicted price/direction, model type, confidence
   - Links to market data via timestamp correlation

3. **accuracy_results**: Prediction validation results
   - References predictions table
   - Stores: actual vs predicted price, difference metrics, match/no-match flag
   - Enables accuracy tracking and model performance analysis

4. **system_status**: Health monitoring
   - Tracks: component status (API, database, scheduler, prediction engine)
   - Stores: last check time, error messages, metadata for diagnostics

**Query Patterns**:
- Time-based range queries for charts (last hour, day, week, month, year)
- Join queries between predictions and accuracy results
- Aggregations for statistics (accuracy percentage, average error, volume totals)

### Session & Authentication

Currently uses in-memory session storage via express-session. The infrastructure supports PostgreSQL session storage via connect-pg-simple for production deployments requiring persistent sessions.

No authentication system implemented - designed for single-user or trusted network deployment.

## External Dependencies

### Third-Party APIs

**Market Data Provider** (configurable):
- Alpha Vantage API (primary option - requires API key in `ALPHA_VANTAGE_API_KEY`)
- AllTick API (alternative)
- StockData.org API (alternative)
- Fallback: Built-in simulated data generator for development

### Database

**PostgreSQL via Neon Serverless**:
- Connection pooling via `@neondatabase/serverless`
- WebSocket-based connection for serverless environments
- Database URL required in `DATABASE_URL` environment variable
- Schema migrations managed via Drizzle Kit

### UI Component Libraries

- **Radix UI**: Headless accessible components (dialogs, dropdowns, tooltips, etc.)
- **Recharts**: Chart rendering for price/prediction visualizations
- **Lucide React**: Icon system
- **date-fns**: Date formatting and manipulation

### Development Tools

- **Vite**: Frontend build tool with HMR support
- **ESBuild**: Server-side bundling for production
- **TypeScript**: Type safety across full stack
- **Tailwind CSS**: Utility-first styling system

### Utility Libraries

- **simple-statistics**: Statistical calculations for ML predictions (linear regression)
- **node-cron**: Scheduled job execution
- **zod**: Runtime schema validation
- **class-variance-authority**: Component variant management
- **wouter**: Lightweight routing