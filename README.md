# Technical Trader

An automated trading bot that uses technical analysis to execute trades on the NEAR blockchain using the Ref Finance DEX.

## Overview

The bot combines several components to make trading decisions:

- Cloudflare D1 (SQLite) for storing historical market data
- Technical indicators from TAAPI
- Market data from Binance (via proxy)
- REF Finance DEX for executing trades
- Cloudflare Workers for serverless deployment
- Cloudflare KV for state management

## How it Works

1. **Data Collection (Every 5 minutes)**
   - Gets technical indicators from TAAPI (VWAP, ATR, Bollinger Bands, RSI, OBV)
   - Fetches orderbook depth and liquidation zones from Binance
   - Stores everything in Cloudflare D1

2. **Trading Strategy**
   The bot uses a comprehensive technical analysis approach:

   **Technical Analysis Signal:**
   - Calculates a score based on multiple indicators:
     - VWAP crossovers and divergence
     - Bollinger Bands breakouts
     - RSI oversold/overbought levels
     - OBV momentum and divergence
     - Order book depth imbalance
   - Uses dynamic scoring based on market conditions
   - Implements partial position sizing based on signal strength

   **Position Management:**
   - Uses multiple entry and exit points based on signal strength
   - Implements stop loss and take profit thresholds
   - All positions are unidirectional (no shorts)
   - Uses REF Finance Smart Router API for best swap prices

3. **Position Tracking**
   - Paper trading with simulated USDC balance
   - Tracks PnL, win rate, and other statistics
   - Uses actual DEX prices/liquidity for realistic simulation
   - State stored in Cloudflare KV

## Configuration

The main configuration is in `trading.ts`:

```typescript
const TRADING_CONFIG = {
    STOP_LOSS_THRESHOLD: -0.02,     // -2% stop loss
    TAKE_PROFIT_THRESHOLD: 0.03,    // +3% take profit
    INITIAL_BALANCE: 1000,          // Starting USDC balance
    
    // Technical Analysis Multipliers
    VWAP_SCORE: 0.4,               // Base VWAP signal weight
    VWAP_EXTRA_SCORE: 0.6,         // Additional VWAP signal weight
    BBANDS_MULTIPLIER: 1.5,        // Bollinger Bands weight
    RSI_MULTIPLIER: 2.0,           // RSI weight
    OBV_DIVERGENCE_MULTIPLIER: 0.8, // OBV divergence weight
    PROFIT_SCORE_MULTIPLIER: 0.75,  // Profit-taking weight
    DEPTH_SCORE_MULTIPLIER: 1.2,    // Order book depth weight

    // Partial Position Thresholds
    PARTIAL_POSITION_THRESHOLDS: [
        { buy: 2, sell: -0.5 },    // First partial
        { buy: 4, sell: 0.5 },     // Second partial
        { buy: 6, sell: 1.5 }      // Third partial
    ]
}
```

## Setup

1. Environment Variables:

```bash
NODE_URL=<NEAR RPC URL>
TAAPI_SECRET=<TAAPI API Key>
BINANCE_API_URL=<Binance API Proxy URL>
```

2. Database:

- Uses Cloudflare D1 (SQLite) for market data
- Uses Cloudflare KV for positions and state
- Schema includes tables for market data and indicators

3. Deploy:

```bash
yarn install
wrangler d1 create ai-trader-db
wrangler kv:namespace create ai-trader-kv
wrangler deploy
```

## API Endpoints

- `/history/:symbol` - Get historical market data
- `/latest/:symbol` - Get latest market data
- `/position/:symbol` - Get current position
- `/stats/:symbol` - Get trading statistics
- `/portfolio` - Get overall portfolio status

## Monitoring

The bot logs detailed information about:

- Data collection status
- Technical analysis scores
- Trade decisions and reasoning
- Position updates and PnL
- Error conditions and recovery

## Supported Markets

Currently supports NEAR/USDT on REF Finance with the following features:

- Real-time price data via Binance API proxy
- Full orderbook depth
- Smart Router API for best swap prices
- Position tracking

## Development

To run locally:

1. Clone the repository
2. Install dependencies: `yarn install`
3. Set up environment variables
4. Create local D1 database: `wrangler d1 create ai-trader-db --local`
5. Start local development: `yarn dev`

## Architecture Notes

- Uses a separate Binance API proxy service since Cloudflare Workers IP ranges are blocked by Binance
- Trading decisions use current market price for signals but actual DEX prices for execution
- All state is maintained in Cloudflare KV for serverless operation
- Uses REF Finance Smart Router API with fallback to single pool for best prices

## Contributing

Feel free to submit issues and pull requests for:

- New trading strategies
- Additional technical indicators
- Market support
- Performance improvements
- Documentation updates 