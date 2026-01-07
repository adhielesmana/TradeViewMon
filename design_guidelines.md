# Trady Design Guidelines

## Design Approach

**System-Based Approach** with inspiration from professional trading platforms (TradingView, Bloomberg Terminal) combined with modern Material Design principles for data visualization. This is a utility-focused application where data clarity, real-time updates, and professional aesthetics are paramount.

## Core Design Principles

1. **Data First**: Every design decision prioritizes readability and quick data comprehension
2. **Professional Trust**: Visual language conveys reliability and accuracy for financial data
3. **Dense Information Display**: Maximize information density without overwhelming users
4. **Real-time Clarity**: Visual indicators for live updates and data freshness

## Typography

**Font Stack**: 
- Primary: 'Inter' for UI elements and labels
- Data/Numbers: 'JetBrains Mono' or 'Roboto Mono' for tabular data and prices
- Headings: Inter at weights 600-700

**Scale**:
- Page Titles: text-2xl (24px) font-semibold
- Section Headers: text-lg (18px) font-medium  
- Data Labels: text-sm (14px) font-medium
- Body/Values: text-base (16px)
- Price Displays: text-3xl to text-4xl font-bold (large focal points)
- Table Data: text-sm monospace

## Layout System

**Spacing Primitives**: Use Tailwind units of 2, 4, 6, and 8 for consistent rhythm
- Component padding: p-4, p-6
- Section gaps: gap-4, gap-6
- Card spacing: space-y-4
- Dashboard grids: gap-6, gap-8

**Grid Structure**:
- Main dashboard: Multi-column responsive grid (grid-cols-1 md:grid-cols-2 lg:grid-cols-3)
- Chart sections: Full-width cards within grid
- Sidebar navigation: Fixed 16rem width on desktop

## Component Library

### Navigation
**Top Bar**: Fixed header with Trady logo/title, real-time status indicator (green pulse dot), last update timestamp
**Side Navigation**: Vertical menu with icons + labels for: Live Market, Predictions, Historical Data, System Status

### Data Display Cards
**Dashboard Cards**: Elevated surfaces with subtle borders
- Structure: Header with title + icon, content area, optional footer with actions
- Padding: p-6
- Border: border border-gray-200 (or equivalent neutral)
- Shadow: shadow-sm hover:shadow-md transition

### Charts
**Primary Charts**: Full-width responsive containers
- Use Recharts library with consistent styling
- Chart height: h-64 for small charts, h-96 for primary focus charts
- Grid lines: Subtle, low-opacity
- Tooltips: Dark background with crisp text
- Legend: Bottom placement, horizontal layout

### Tables
**Data Tables**: Alternating row backgrounds for readability
- Header: font-semibold, slightly darker background
- Rows: hover:bg-gray-50 for interactivity
- Monospace font for numerical columns (prices, volumes)
- Right-align numbers, left-align labels
- Sticky headers for long tables

### Status Indicators
**Real-time Updates**: 
- Green pulse animation for "live" status
- Timestamp display: "Last updated: XX seconds ago"
- Loading states: Subtle skeleton screens or spinners

**Prediction Match/Not Match**:
- Match: Green badge with checkmark icon
- Not Match: Red badge with X icon
- Badge style: px-2 py-1 rounded-full text-xs font-medium

### Stat Cards
**Key Metrics Display**:
- Large number (text-3xl font-bold) at top
- Label below (text-sm text-gray-600)
- Optional trend indicator (↑ ↓ arrows with percentage change)
- Grid layout: 3-4 cards per row on desktop

### Filters & Controls
**Time Period Filters**: Horizontal button group
- Options: 1D, 1W, 1M, 3M, 6M, 1Y
- Active state: Solid background, inactive: Ghost style
- Size: px-4 py-2 text-sm

### Price Display
**Large Price Widget**:
- Current price: text-4xl font-bold monospace
- Change indicator: +/- with percentage in smaller text below
- Conditional styling: Green for positive, red for negative changes

## Animations

**Minimal, Purposeful Only**:
- Real-time data updates: Subtle highlight flash (200ms) when values change
- Loading states: Simple spinner or pulse
- No decorative animations - focus on data stability

## Images

**No Hero Images**: This is a data application - users land directly on the dashboard interface. No marketing imagery needed within the application.

**Optional Icons**: Use Heroicons (via CDN) for navigation and UI elements - outline style for inactive, solid for active states.

## Dashboard Layout Structure

### Live Market Screen
- Top: Large price display card with current price + change
- Middle: Full-width 1-minute candlestick chart (h-96)
- Bottom row: 3-column grid with mini stat cards (Volume, High, Low)

### Prediction Dashboard
- Left column (60%): Overlay chart showing predicted vs actual prices
- Right column (40%): Scrollable table with Timestamp | Predicted | Actual | Match Status | Accuracy %
- Bottom: Large accuracy percentage stat card

### Historical Data View
- Top: Time period filter buttons (1D to 1Y)
- Main: Full-width candlestick chart with zoom/pan capabilities (h-[500px])
- Below: OHLCV data table with pagination

### System Status
- Grid of status cards: API Health (green/red indicator), Scheduler Status, Last Fetch Time, Database Records Count
- Each card: Icon + status label + detailed info