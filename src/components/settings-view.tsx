"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/hooks/use-api";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { ago, dateTime, money } from "@/lib/format";
import type { Settings } from "@/lib/types";
import { Card, SectionTitle } from "./card";
import { Confirm } from "./confirm";
import { useAppState } from "./state-provider";
import { Switch } from "./ui/switch";
import { Skeleton } from "./ui/skeleton";

type NumKey = "riskPct" | "maxDailyLossPct" | "maxPositions" | "minRR" | "minScore" | "dteMin" | "dteMax" | "maxPremiumPct";

const STEPPERS: { key: NumKey; label: string; step: number; min: number; max: number; unit?: string; hint?: (v: number, eq: number) => string }[] = [
  { key: "riskPct", label: "Risk per trade", step: 0.25, min: 0.25, max: 5, unit: "%", hint: (v, eq) => money((eq * v) / 100) },
  { key: "maxDailyLossPct", label: "Max daily loss", step: 0.5, min: 1, max: 10, unit: "%", hint: (v, eq) => money((eq * v) / 100) },
  { key: "maxPositions", label: "Max positions", step: 1, min: 1, max: 5 },
  { key: "minRR", label: "Min reward to risk", step: 0.5, min: 1, max: 5, unit: "x" },
  { key: "minScore", label: "Min confidence", step: 5, min: 50, max: 95 },
  { key: "maxPremiumPct", label: "Max cost per trade", step: 5, min: 5, max: 50, unit: "%", hint: (v, eq) => money((eq * v) / 100) },
  { key: "dteMin", label: "Min days to expiry", step: 1, min: 1, max: 30 },
  { key: "dteMax", label: "Max days to expiry", step: 1, min: 2, max: 45 },
];

export function SettingsView() {
  const { state, refresh } = useAppState();
  const [saving, setSaving] = useState(false);

  if (!state) return <Skeleton className="h-96 rounded-3xl bg-white/10" />;
  const s = state.settings;
  const equity = state.portfolio.equity;
  const isDefault = (Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[]).every((k) => s[k] === DEFAULT_SETTINGS[k]);

  async function save(patch: Partial<Settings>) {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", json: patch });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function closeAll() {
    try {
      await api("/api/positions/close", { json: { all: true } });
      await refresh();
      toast.success("Closing all positions.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not close positions.");
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.replace("/login");
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 md:gap-8">
      <div className="grid content-start gap-6">
        <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">Settings</h1>

        <Card>
          <Row
            title="Auto trading"
            body={s.autoTrade ? "The bot opens and closes paper trades on its own." : "Paused. Stops and targets are still managed."}
            control={<Switch checked={s.autoTrade} disabled={saving} onCheckedChange={(v) => save({ autoTrade: v })} aria-label="Auto trading" />}
          />
          <Divider />
          <Row
            title="Exit before the close"
            body="Flatten everything at 3:50 PM ET."
            control={<Switch checked={s.closeEod} disabled={saving} onCheckedChange={(v) => save({ closeEod: v })} aria-label="Exit before the close" />}
          />
          <Divider />
          <Row
            title="Include market movers"
            body="Scan up to 3 extra liquid stocks with options."
            control={<Switch checked={s.includeMovers} disabled={saving} onCheckedChange={(v) => save({ includeMovers: v })} aria-label="Include market movers" />}
          />
        </Card>

        <Card>
          <SectionTitle
            action={
              <button
                type="button"
                disabled={saving || isDefault}
                onClick={async () => {
                  await save(DEFAULT_SETTINGS);
                  toast.success("Settings reset to defaults.");
                }}
                className="h-8 rounded-full border border-white/20 px-3 text-[11px] font-bold tracking-wider transition hover:bg-white hover:text-black disabled:opacity-30"
              >
                DEFAULTS
              </button>
            }
          >
            Risk
          </SectionTitle>
          <div className="grid gap-1">
            {STEPPERS.map((st) => (
              <Stepper
                key={st.key}
                label={st.label}
                value={s[st.key]}
                unit={st.unit}
                hint={st.hint?.(s[st.key], equity)}
                disabled={saving}
                onChange={(v) => save({ [st.key]: Math.min(st.max, Math.max(st.min, v)) })}
                step={st.step}
                min={st.min}
                max={st.max}
              />
            ))}
          </div>
        </Card>
      </div>

      <div className="grid content-start gap-6 md:pt-14">
        <Card>
          <SectionTitle>Kill switch</SectionTitle>
          <p className="text-sm text-white/55">Sells every open paper position at market and pauses auto trading.</p>
          <Confirm
            title="Close everything?"
            body="All open paper positions are sold at market and auto trading is paused."
            action="CLOSE ALL"
            onConfirm={async () => {
              await save({ autoTrade: false });
              await closeAll();
            }}
            trigger={(open) => (
              <button type="button" onClick={open} className="mt-4 h-12 w-full rounded-2xl border-2 border-white font-bold tracking-wider transition hover:bg-white hover:text-black">
                CLOSE ALL AND PAUSE
              </button>
            )}
          />
        </Card>

        <Card>
          <SectionTitle>Connection</SectionTitle>
          <dl className="grid gap-3 text-sm">
            <Item k="Broker" v={state.configured.data ? "Alpaca paper" : "Not connected"} />
            <Item k="Stock data" v={`${state.freshness.stocks}, IEX volume only`} />
            <Item k="Option quotes" v={`${state.freshness.options}, not OPRA`} />
            <Item k="Bot last ran" v={state.bot.lastTickAt ? `${ago(state.bot.lastTickAt)}` : "Not yet"} />
            {state.bot.lastMessage && <Item k="Last result" v={state.bot.lastMessage} />}
          </dl>
        </Card>

        <Card>
          <SectionTitle>Activity</SectionTitle>
          {state.log.length === 0 ? (
            <p className="text-sm text-white/40">Nothing yet.</p>
          ) : (
            <ul className="grid gap-3">
              {state.log.map((l, i) => (
                <li key={i} className="text-sm">
                  <div className="text-white/85">{l.message}</div>
                  <div className="text-xs text-white/35">{dateTime(l.at)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <button type="button" onClick={signOut} className="h-12 rounded-2xl border border-white/15 text-sm font-semibold text-white/70 hover:text-white">
          Sign out
        </button>
        <p className="text-xs text-white/35">Paper trading only. No real money is ever used. Signals are not guarantees.</p>
      </div>
    </div>
  );
}

function Row({ title, body, control }: { title: string; body: string; control: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-white/50">{body}</div>
      </div>
      {control}
    </div>
  );
}

function Divider() {
  return <div className="my-2 h-px bg-white/10" />;
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-white/45">{k}</dt>
      <dd className="text-right text-white/85">{v}</dd>
    </div>
  );
}

function Stepper(props: {
  label: string;
  value: number;
  unit?: string;
  hint?: string;
  step: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  const { label, value, unit, hint, step, min, max, disabled, onChange } = props;
  const btn = "flex size-11 items-center justify-center rounded-full border border-white/15 transition hover:bg-white hover:text-black disabled:opacity-30";
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="tabular text-xs text-white/45">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} disabled={disabled || value <= min} onClick={() => onChange(+(value - step).toFixed(2))} aria-label={`Decrease ${label}`}>
          <Minus className="size-4" />
        </button>
        <span className="tabular w-14 text-center text-base font-semibold">
          {value}
          {unit}
        </span>
        <button type="button" className={btn} disabled={disabled || value >= max} onClick={() => onChange(+(value + step).toFixed(2))} aria-label={`Increase ${label}`}>
          <Plus className="size-4" />
        </button>
      </div>
    </div>
  );
}
