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

**Routing**: Wouter for lightweight client-side routing with five main pages:
- Live Market: Real-time price monitoring and current market statistics
- Predictions: AI prediction visualization with accuracy tracking
- Historical: Historical data analysis with configurable time ranges
- Backtesting: Historical model performance evaluation and analysis
- System Status: Health monitoring and system metrics

**Design System**: 
- Typography: Inter for UI, JetBrains Mono for numerical data
- Color semantics: Dedicated profit (green), loss (red), and neutral (gray) colors for financial data
- Theme support: Dark/light mode with system preference detection
- Responsive grid layouts optimized for dashboard-style data display

### Backend Architecture

**Runtime**: Node.js with Express.js HTTP server

**API Design**: RESTful endpoints with JSON responses:
- `/api/market/*`: Market data queries (recent, historical, stats, indicators)
- `/api/predictions/*`: Prediction data and accuracy metrics
- `/api/export/*`: CSV/JSON data export for market data and predictions
- `/api/backtest/*`: Backtesting simulation endpoints
- `/api/system/*`: System health and status information
- `/api/websocket/*`: WebSocket connection status

**WebSocket Real-Time Updates**: Server pushes updates for connected clients with per-symbol subscriptions:
- `market_update`: New candle data
- `prediction_update`: New predictions generated
- `accuracy_update`: Prediction evaluation results
- Clients subscribe to specific symbols and only receive relevant updates

**Scheduler System**: Node-cron based job scheduler that runs every 60 seconds to:
1. Fetch latest market data from external API or generate simulated data
2. Store new candles in the database
3. Generate predictions using the ensemble model
4. Compare predictions against actual prices
5. Calculate and store accuracy metrics

**Prediction Engine**: Enhanced ensemble approach with multi-factor analysis:
- Moving Average predictions for trend analysis (MA7/20/50/200 crossover signals)
- Linear Regression for price trajectory
- Multi-factor technical analysis:
  - RSI (14-period) overbought/oversold detection
  - MACD (12, 26, 9) signal line crossovers
  - Stochastic oscillator (14-period) momentum analysis
  - Volume analysis for trend confirmation
- Weighted scoring system with normalized factor contributions
- Outputs: predicted price, direction (UP/DOWN/NEUTRAL), confidence score, and multi-factor analysis breakdown
- Configurable match threshold (default 0.5%) for accuracy determination

**Market Data Service**: Abstracted service layer supporting:
- External API integration (designed for Alpha Vantage, AllTick, or similar)
- Simulated data generation for development/testing
- Historical data backfill (generates 3 hours of 1-minute candles on startup)
- Real-time data fetching with 1-minute intervals
- Candlestick chart displays 3-hour range with 1-minute candles (~180 data points)

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

**Session Management**: Uses in-memory session storage via express-session with memorystore for leak-free operation. The infrastructure supports PostgreSQL session storage via connect-pg-simple for production deployments requiring persistent sessions.

**Authentication**: Passport.js with local strategy for username/password authentication:
- Bcrypt-hashed passwords stored in the users table
- Superadmin account (username: adhielesmana) seeded on startup
- Protected routes requiring authentication for all pages except login
- Session-based authentication with 24-hour expiry

**Supported Instruments** (10 financial instruments):
- Precious Metals: XAUUSD (Gold), XAGUSD (Silver)
- Currency Indices: DXY (Dollar Index)
- Treasury: US10Y (10-Year Treasury Yield)
- Mining Stocks: GDX, GDXJ, NEM
- Market Indices: SPX (S&P 500)
- Cryptocurrency: BTCUSD (Bitcoin)
- Energy: USOIL (Crude Oil)

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