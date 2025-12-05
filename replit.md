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

**Routing**: Wouter for lightweight client-side routing with multiple pages:
- Live Market: Real-time price monitoring and current market statistics
- Predictions: AI prediction visualization with accuracy tracking
- AI Suggestions: Buy/Sell/Hold signals with target prices
- Historical: Historical data analysis with configurable time ranges
- Backtesting: Historical model performance evaluation and analysis
- Live Demo: Paper trading with virtual currency
- System Status: Health monitoring and system metrics (Admin only)
- User Management: Manage user accounts and roles (Admin only)
- Settings: Configure API keys and app settings (Admin only)

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

**Unified Signal Generator** (`server/unified-signal-generator.ts`): Single source of truth for all BUY/SELL/HOLD signals across the platform:
- Ensures signal consistency across Technical Indicators, Predictions Multi-factor, and AI Suggestions pages
- Weighted scoring system with consistent thresholds:
  - EMA Crossover: 25 weight (EMA12 vs EMA26, 0.1% threshold)
  - RSI: 20 weight (oversold <30, overbought >70, moderate zones 45-55)
  - MACD: 25 weight (histogram positive/negative with line confirmation)
  - Stochastic: 15 weight (oversold <20, overbought >80)
  - Price Trend: 15 weight (0.5% threshold for significant moves)
  - Candlestick Patterns: 8×strength (hammer, engulfing, doji, etc.)
- Decision thresholds: BUY (netScore > 20), SELL (netScore < -20), HOLD otherwise
- ATR-based target price calculations for entry/exit points

**Prediction Engine**: Enhanced ensemble approach with multi-factor analysis:
- Moving Average predictions for trend analysis (MA7/20/50/200 crossover signals)
- Linear Regression for price trajectory
- Multi-factor technical analysis delegated to unified signal generator
- Outputs: predicted price, direction (UP/DOWN/NEUTRAL), confidence score, and multi-factor analysis breakdown
- Configurable match threshold (default 0.5%) for accuracy determination

**Market Data Service**: Multi-provider abstracted service layer supporting:
- **Gold-API.com Integration**: Free real-time prices for XAU (Gold), XAG (Silver), BTC (Bitcoin)
  - Endpoint: `https://api.gold-api.com/price/{symbol}`
  - No authentication required for free tier
  - Returns current spot price used as candle close
- **Finnhub Integration**: Real-time stock/ETF prices for GDX, GDXJ, NEM, SPX, DXY, USOIL
  - Endpoint: `https://finnhub.io/api/v1/quote?symbol={symbol}&token={API_KEY}`
  - ETF proxies with price multipliers: SPY×10 for SPX, UUP×3.8 for DXY, USO for USOIL
  - Requires FINNHUB_API_KEY secret (free tier: 60 calls/min)
- **On-Demand Historical Seeding**: When user selects a new symbol:
  - System checks if historical data exists for that symbol
  - If not, fetches current price from API provider and generates 61 1-minute candles
  - Provides immediate chart display without waiting for scheduler
- Simulated data generation for unsupported symbols (US10Y)
- Real-time data fetching with 1-minute intervals via scheduler
- Candlestick chart displays 1-hour range with 1-minute candles (~60 data points)
- Price continuity: Open price = previous candle's close, stored in `price_state` table

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

5. **price_state**: Price continuity tracking
   - Stores: symbol, last open price, last close price, last timestamp
   - Ensures new candles continue from previous close price
   - Persists across server restarts for seamless price flow

6. **app_settings**: Application configuration
   - Stores: key-value pairs for app settings (e.g., FINNHUB_API_KEY, OPENAI_API_KEY)
   - API keys are encrypted at rest using AES-256-GCM before storage
   - Encryption key derived from SESSION_SECRET using PBKDF2
   - API keys saved here persist across server restarts
   - Environment variables take precedence over database values

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

**Gold-API.com** (Primary - FREE, no authentication required):
- Provides real-time spot prices for precious metals and crypto
- Supported symbols: XAU (Gold → XAUUSD), XAG (Silver → XAGUSD), BTC (Bitcoin → BTCUSD)
- Endpoint: `https://api.gold-api.com/price/{symbol}`
- Response: `{ name, price, symbol, updatedAt, updatedAtReadable }`
- Fallback: Built-in simulated data generator for unsupported symbols

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

## Production Deployment

### Self-Hosted Deployment

The `deploy/` directory contains scripts for deploying to your own production server:

**Quick Start:**
```bash
git clone <repo-url> /opt/tradeviewmon
cd /opt/tradeviewmon
chmod +x deploy/*.sh
./deploy/setup-env.sh
./deploy/deploy.sh --domain your-domain.com --email admin@example.com
```

**Features:**
- Automatic Nginx detection and configuration
- SSL certificate via Let's Encrypt
- Port conflict detection (auto-selects next available port if 5000 is in use)
- Docker-based deployment with health checks
- Multi-stage Docker build for optimized image size

**Files:**
- `deploy/deploy.sh` - Main deployment script
- `deploy/setup-env.sh` - Environment variable configuration helper
- `deploy/Dockerfile` - Multi-stage Docker build
- `deploy/docker-compose.yml` - Docker Compose for full stack
- `deploy/nginx-ssl.conf.template` - Nginx configuration with SSL
- `deploy/README.md` - Detailed deployment documentation

**Environment Variables Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secure session encryption key (also used for API key encryption)
- `FINNHUB_API_KEY` - Finnhub API key for stock data (optional, can be configured via Settings UI)
- `AI_INTEGRATIONS_OPENAI_API_KEY` - OpenAI API key for AI-enhanced trading (optional, can be configured via Settings UI)