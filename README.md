# Technical Trader

An automated trading bot that uses technical analysis to execute trades on the NEAR blockchain using the Ref Finance DEX.

## Overview

The bot combines several components to make trading decisions:

- Cloudflare D1 (SQLite) for storing historical market data
- Technical indicators from TAAPI
- REF Finance DEX for executing trades
- Cloudflare Workers for serverless deployment
- Cloudflare KV for state management

## How it Works

1. **Data Collection (Every 5 minutes)**
   - Gets technical indicators from TAAPI (VWAP, ATR, Bollinger Bands, RSI, OBV)
   - Stores everything in Cloudflare D1

2. **Trading Strategy**
   The bot uses a comprehensive technical analysis approach:

   **Technical Analysis Signal:**
   - Calculates a score based on multiple indicators:
     - VWAP crossovers and divergence
     - Bollinger Bands breakouts
     - RSI oversold/overbought levels
     - OBV momentum and divergence
   - Uses dynamic scoring based on market conditions
   - Implements partial position sizing based on signal strength

   **Position Management:**
   - Uses multiple entry and exit points based on signal strength
   - Implements stop loss and take profit thresholds
   - Uses REF Finance Smart Router API for best swap prices
   - Supports partial positions with independent tracking
   - Time decay to gradually reduce position scores
   - Profit-taking score to encourage closing profitable trades

3. **Position Tracking**
   - Paper trading with simulated USDC balance
   - Tracks PnL, win rate, and other statistics
   - Uses actual DEX prices for realistic simulation
   - State stored in Cloudflare KV

## Configuration

The main configuration is in `config.ts`:

```typescript
// Trading configuration
export const TRADING_CONFIG = {
	// Position thresholds
	STOP_LOSS_THRESHOLD: -0.02, // -2% stop loss
	TAKE_PROFIT_THRESHOLD: 0.03, // +3% take profit
	INITIAL_BALANCE: 1000, // Starting USDC balance

	// Technical Analysis Multipliers
	VWAP_MULTIPLIER: 0.4, // Base VWAP signal weight
	VWAP_EXTRA_MULTIPLIER: 0.6, // Additional VWAP signal weight
	BBANDS_MULTIPLIER: 1.5, // Bollinger Bands weight
	RSI_MULTIPLIER: 2.0, // RSI weight
	OBV_DIVERGENCE_MULTIPLIER: 0.8, // OBV divergence weight
	PROFIT_SCORE_MULTIPLIER: 0.75, // Profit-taking weight
	TIME_DECAY_MULTIPLIER: 0.0001, // Time decay weight per minute

	// Technical Analysis Parameters
	VWAP_THRESHOLD: 0.01, // 1% threshold for VWAP signals
	OBV_WINDOW_SIZE: 12, // 1 hour window for OBV analysis
	SLOPE_THRESHOLD: 0.0001, // Minimum slope for divergence detection

	// Partial Position Thresholds
	PARTIAL_POSITION_THRESHOLDS: [
		{ buy: 2, sell: -0.5 }, // First partial
		{ buy: 4, sell: 0.5 }, // Second partial
		{ buy: 6, sell: 1.5 } // Third partial
	]
};
```

## Setup

1. Environment Variables:

```bash
NODE_URL=<NEAR RPC URL>
TAAPI_SECRET=<TAAPI API Key>
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

Currently supports multiple trading pairs on REF Finance:

- NEAR/USDT
- SOL/USDT
- BTC/USDT
- ETH/USDT

Features:

- Real-time price data via TAAPI
- Smart Router API for best swap prices
- Position tracking with partial positions
- PnL and statistics tracking

## Development

To run locally:

1. Clone the repository
2. Install dependencies: `yarn install`
3. Set up environment variables
4. Create local D1 database: `wrangler d1 create ai-trader-db --local`
5. Start local development: `yarn dev`

## Architecture Notes

- Uses TAAPI for reliable technical indicators
- Trading decisions use current market price for signals but actual DEX prices for execution
- All state is maintained in Cloudflare KV for serverless operation
- Uses REF Finance Smart Router API for best prices
- Supports multiple partial positions with independent tracking
- Implements time decay and profit-taking mechanics

## Contributing

Feel free to submit issues and pull requests for:

- New trading strategies
- Additional technical indicators
- Market support
- Performance improvements
- Documentation updates
