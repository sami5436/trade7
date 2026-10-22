"use client";

import { useEffect, useRef } from "react";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";

export function EquityChart({ points, height = 200 }: { points: { t: number; equity: number }[]; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = createChart(ref.current, {
      height,
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a8a", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { color: "rgba(255,255,255,0.05)" } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
      handleScroll: false,
      handleScale: false,
      crosshair: { vertLine: { labelBackgroundColor: "#262626" }, horzLine: { labelBackgroundColor: "#262626" } },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#ffffff",
      lineWidth: 2,
      topColor: "rgba(255,255,255,0.18)",
      bottomColor: "rgba(255,255,255,0)",
      priceLineVisible: false,
    });
    // Points must have strictly increasing times.
    const data: { time: UTCTimestamp; value: number }[] = [];
    for (const p of [...points].sort((a, b) => a.t - b.t)) {
      const time = Math.floor(p.t / 1000) as UTCTimestamp;
      if (data.length && data[data.length - 1].time >= time) data[data.length - 1] = { time: data[data.length - 1].time, value: p.equity };
      else data.push({ time, value: p.equity });
    }
    series.setData(data);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, height]);
  return <div ref={ref} className="w-full" style={{ height }} />;
}
