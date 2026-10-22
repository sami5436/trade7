import { Card } from "./card";

export function ConnectCard() {
  return (
    <Card className="border-white/20">
      <div className="text-xs font-semibold tracking-[0.18em] text-white/50 uppercase">Market data offline</div>
      <h2 className="mt-2 text-2xl font-bold tracking-tight">Connect Alpaca to start</h2>
      <p className="mt-2 text-sm text-white/60">
        No prices or signals are shown until a real data source is connected. Add a free Alpaca paper key as
        <span className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">ALPACA_KEY_ID</span>and
        <span className="mx-1 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs">ALPACA_SECRET_KEY</span>
        in Vercel, then redeploy.
      </p>
    </Card>
  );
}
