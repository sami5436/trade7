# TRADE7

Minimal momentum trading terminal that paper trades weekly options on the Magnificent 7, the memory makers (MU, SNDK, WDC, STX) and SpaceX (SPCX) automatically.

Paper trading only. Orders go to an Alpaca paper account. There is no live trading code path.

## How it works

- **Signals**: VWAP, EMA 9/21, RSI 14, MACD, relative volume, 15 minute opening range, ATR and SPY/QQQ direction are combined into a 0 to 100 score (`src/lib/engine.ts`). A BUY or SELL needs the minimum score and a planned reward to risk of at least 2.
- **Options**: BUY buys a call and SELL buys a put, 3 to 10 days out, delta 0.30 to 0.65, with tight spreads. Size comes from 1% account risk (`src/lib/options.ts`).
- **Bot**: `/api/cron/tick` reconciles orders, marks positions, exits on stop, target, signal fade, expiry or 3:50 PM ET, enforces a 3% daily loss halt, and enters at most one new trade per pass (`src/lib/server/bot.ts`). A GitHub Actions schedule calls it every 5 minutes, and the open app calls it about every minute.
- **Backtest**: the same signals replayed on 5 minute bars as shares, filled at the next bar open with slippage (`src/lib/backtest.ts`).
- **Data**: free Alpaca feeds. Stocks are IEX real time (IEX volume only). Options use the free indicative feed, which is delayed and modified.

## Setup

1. Copy `.env.example` to `.env.local` and fill it in.
2. `npm install && npm run db:migrate`
3. `npm run dev`

Scheduler: set the repository variable `APP_URL` and the secret `CRON_SECRET` in GitHub.

## Checks

`npm run lint && npm run typecheck && npm test && npm run build`
