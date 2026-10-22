"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Bar } from "@/lib/indicators";
import { etParts } from "@/lib/time";

export interface ChartData {
  bars: Bar[];
  vwap: number[];
  ema9: (number | null)[];
  ema21: (number | null)[];
  rsi: (number | null)[];
  hist: (number | null)[];
  levels: { entry: number | null; stop: number | null; target: number | null };
}

// The chart library renders in UTC, so shift each bar to its New York wall clock time.
function etSeconds(ms: number): UTCTimestamp {
  const { date, minutes } = etParts(ms);
  return (Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 1000 + minutes * 60) as UTCTimestamp;
}

export function PriceChart({ data, height = 420 }: { data: ChartData; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#000000" },
        textColor: "#8a8a8a",
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        attributionLogo: false,
        panes: { separatorColor: "rgba(255,255,255,0.1)", enableResize: false },
      },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "rgba(255,255,255,0.3)", labelBackgroundColor: "#262626" },
        horzLine: { color: "rgba(255,255,255,0.3)", labelBackgroundColor: "#262626" },
      },
    });
    chartRef.current = chart;

    const t = data.bars.map((b) => etSeconds(b.t));
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#ffffff",
      downColor: "#000000",
      borderUpColor: "#ffffff",
      borderDownColor: "#a3a3a3",
      wickUpColor: "#ffffff",
      wickDownColor: "#a3a3a3",
      priceLineColor: "rgba(255,255,255,0.4)",
    });
    candles.setData(data.bars.map((b, i) => ({ time: t[i], open: b.o, high: b.h, low: b.l, close: b.c })));

    const line = (values: (number | null)[], color: string, style: LineStyle, pane = 0, width: 1 | 2 = 1) => {
      const s = chart.addSeries(
        LineSeries,
        { color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
        pane,
      );
      s.setData(values.flatMap((v, i) => (v == null ? [] : [{ time: t[i], value: v }])));
      return s;
    };
    line(data.vwap, "#ffffff", LineStyle.Dashed, 0, 2);
    line(data.ema9, "#bdbdbd", LineStyle.Solid);
    line(data.ema21, "#6b6b6b", LineStyle.Solid);

    const levels: [number | null, string, LineStyle][] = [
      [data.levels.entry, "ENTRY", LineStyle.Solid],
      [data.levels.stop, "STOP", LineStyle.Dotted],
      [data.levels.target, "TARGET", LineStyle.LargeDashed],
    ];
    for (const [p, title, style] of levels) {
      if (p != null) candles.createPriceLine({ price: p, title, color: "#ffffff", lineWidth: 1, lineStyle: style, axisLabelVisible: true });
    }

    const rsi = line(data.rsi, "#ffffff", LineStyle.Solid, 1);
    rsi.createPriceLine({ price: 70, color: "rgba(255,255,255,0.25)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });
    rsi.createPriceLine({ price: 30, color: "rgba(255,255,255,0.25)", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: "" });

    const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2);
    hist.setData(
      data.hist.flatMap((v, i) => (v == null ? [] : [{ time: t[i], value: v, color: v >= 0 ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)" }])),
    );

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);
    panes[2]?.setStretchFactor(1);
    chart.timeScale().fitContent();

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data, height]);

  return <div ref={ref} className="w-full overflow-hidden rounded-2xl" style={{ height }} />;
}
