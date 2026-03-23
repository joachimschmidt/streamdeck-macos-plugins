import type { DataPoint } from "./ha-client";

interface GraphOptions {
  width: number;
  height: number;
  label?: string;
  currentValue?: string;
  timeLabel?: string;
  showBackground?: boolean;
  showScale?: boolean;
  windowMs?: number;
  timeframeBadge?: string;
  reverseColors?: boolean;
  unit?: string;
  /** Historical min/max from full 10-day range for consistent color mapping */
  historicalMin?: number;
  historicalMax?: number;
  /** When true, lock y-axis scale to historical min/max instead of visible window */
  freezeScale?: boolean;
}

function downsample(points: DataPoint[], maxPoints: number): DataPoint[] {
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const result: DataPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(points[Math.floor(i * step)]);
  }
  result[result.length - 1] = points[points.length - 1];
  return result;
}

function formatScaleValue(val: number): string {
  if (Math.abs(val) >= 100) return val.toFixed(0);
  return val.toFixed(1);
}

// Color stops: low → high (default: blue → green → yellow)
const COLOR_STOPS_NORMAL = [
  { pos: 0, r: 79, g: 195, b: 247 },   // #4FC3F7 cyan/blue
  { pos: 0.5, r: 76, g: 175, b: 80 },   // #4CAF50 green
  { pos: 1, r: 255, g: 193, b: 7 },      // #FFC107 yellow/amber
];

function interpolateColor(t: number, reverse: boolean): string {
  const clamped = Math.max(0, Math.min(1, reverse ? 1 - t : t));
  const stops = COLOR_STOPS_NORMAL;

  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped >= stops[i].pos && clamped <= stops[i + 1].pos) {
      lo = stops[i];
      hi = stops[i + 1];
      break;
    }
  }

  const range = hi.pos - lo.pos || 1;
  const f = (clamped - lo.pos) / range;
  const r = Math.round(lo.r + (hi.r - lo.r) * f);
  const g = Math.round(lo.g + (hi.g - lo.g) * f);
  const b = Math.round(lo.b + (hi.b - lo.b) * f);
  return `rgb(${r},${g},${b})`;
}

function renderGraph(points: DataPoint[], opts: GraphOptions): string {
  const { width, height, label, currentValue, timeLabel, showBackground, showScale, windowMs, timeframeBadge, reverseColors, unit, historicalMin: histMin, historicalMax: histMax, freezeScale } = opts;
  const unitSuffix = unit ? ` ${unit}` : "";

  const hasHeader = !!(label || currentValue);
  const hasFooter = !!timeLabel;
  const top = hasHeader ? 24 : 6;
  const bottom = hasFooter ? 16 : 6;
  const left = 6;
  const right = 6;
  const graphW = width - left - right;
  const graphH = height - top - bottom;
  const vertPad = graphH * 0.1;
  const reverse = reverseColors ?? false;

  let content = "";

  if (showBackground) {
    content += `<rect width="${width}" height="${height}" rx="28" fill="#1a1a2e"/>`;
  }

  // Header — color the current value by its position in the range
  if (label) {
    content += `<text x="10" y="16" font-family="-apple-system,Helvetica" font-size="11" font-weight="600" fill="#aaa">${escapeXml(label)}</text>`;
  }

  if (points.length < 2) {
    if (currentValue) {
      content += `<text x="${width - 8}" y="16" font-family="-apple-system,Helvetica" font-size="12" font-weight="700" fill="#4FC3F7" text-anchor="end">${escapeXml(currentValue + unitSuffix)}</text>`;
    }
    content += `<text x="${width / 2}" y="${top + graphH / 2 + 4}" font-family="-apple-system,Helvetica" font-size="12" fill="#666" text-anchor="middle">No data</text>`;
  } else {
    const sampled = downsample(points, 60);

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const p of sampled) {
      if (p.value < minVal) minVal = p.value;
      if (p.value > maxVal) maxVal = p.value;
    }

    // When freezeScale is on and historical range is available, lock scale to it
    const displayMin = (freezeScale && histMin != null) ? histMin : minVal;
    const displayMax = (freezeScale && histMax != null) ? histMax : maxVal;

    // Color range: use historical 10-day range if available, else window range
    const colorMin = histMin ?? displayMin;
    const colorMax = histMax ?? displayMax;
    const colorRange = colorMax - colorMin || 1;

    // Y-axis range: use frozen scale or visible data range
    if (freezeScale && histMin != null && histMax != null) {
      minVal = histMin;
      maxVal = histMax;
    }
    const range = maxVal - minVal || 1;
    minVal -= range * 0.15;
    maxVal += range * 0.15;

    // Current value header with conditional color (based on historical range)
    if (currentValue) {
      const curNum = parseFloat(currentValue);
      const t = isNaN(curNum) ? 0.5 : (curNum - colorMin) / colorRange;
      const curColor = interpolateColor(t, reverse);
      content += `<text x="${width - 8}" y="16" font-family="-apple-system,Helvetica" font-size="12" font-weight="700" fill="${curColor}" text-anchor="end">${escapeXml(currentValue + unitSuffix)}</text>`;
    }

    // Time axis
    const dataSpan = sampled[sampled.length - 1].time - sampled[0].time;
    const useTimeAxis = windowMs && dataSpan > windowMs * 0.1;
    const now = Date.now();
    const timeStart = useTimeAxis ? now - windowMs! : sampled[0].time;
    const timeEnd = useTimeAxis ? now : sampled[sampled.length - 1].time;
    const timeRange = timeEnd - timeStart || 1;

    const coords = sampled.map((p, i) => {
      const x = useTimeAxis
        ? left + ((p.time - timeStart) / timeRange) * graphW
        : left + (i / (sampled.length - 1)) * graphW;
      const y = top + vertPad + (graphH - 2 * vertPad) * (1 - (p.value - minVal) / (maxVal - minVal));
      const t = (p.value - displayMin) / (displayMax - displayMin || 1);
      return { x, y, t };
    });

    // Grid lines
    for (let i = 0; i < 3; i++) {
      const gy = top + (graphH * (i + 1)) / 4;
      content += `<line x1="${left}" y1="${gy.toFixed(1)}" x2="${left + graphW}" y2="${gy.toFixed(1)}" stroke="#333" stroke-width="0.5" stroke-dasharray="3,3"/>`;
    }

    // Vertical gradient mapped to historical color range
    // Compute where historical min/max/mid sit as y-fractions in the padded window range
    const valToYFrac = (v: number) => 1 - (v - minVal) / (maxVal - minVal);
    const topFrac = Math.max(0, valToYFrac(colorMax));   // y-fraction for historical max
    const midFrac = valToYFrac((colorMin + colorMax) / 2);
    const botFrac = Math.min(1, valToYFrac(colorMin));   // y-fraction for historical min
    const topColor = interpolateColor(1, reverse);
    const midColor = interpolateColor(0.5, reverse);
    const botColor = interpolateColor(0, reverse);

    content += `<defs>`;
    content += `<linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">`;
    content += `<stop offset="${(topFrac * 100).toFixed(1)}%" stop-color="${topColor}"/>`;
    content += `<stop offset="${(midFrac * 100).toFixed(1)}%" stop-color="${midColor}"/>`;
    content += `<stop offset="${(botFrac * 100).toFixed(1)}%" stop-color="${botColor}"/>`;
    content += `</linearGradient>`;
    content += `<linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">`;
    content += `<stop offset="${(topFrac * 100).toFixed(1)}%" stop-color="${topColor}" stop-opacity="0.3"/>`;
    content += `<stop offset="${(midFrac * 100).toFixed(1)}%" stop-color="${midColor}" stop-opacity="0.15"/>`;
    content += `<stop offset="${(botFrac * 100).toFixed(1)}%" stop-color="${botColor}" stop-opacity="0"/>`;
    content += `</linearGradient>`;
    content += `</defs>`;

    const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");

    // Fill polygon
    const fillPoints =
      `${coords[0].x.toFixed(1)},${(top + graphH).toFixed(1)} ` +
      polylinePoints +
      ` ${coords[coords.length - 1].x.toFixed(1)},${(top + graphH).toFixed(1)}`;
    content += `<polygon points="${fillPoints}" fill="url(#fg)"/>`;

    // Line with gradient stroke
    content += `<polyline points="${polylinePoints}" fill="none" stroke="url(#sg)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;

    // Scale labels
    if (showScale ?? showBackground) {
      const scaleX = left + 2;
      const maxY = top + vertPad + 7;
      const minY = top + graphH - vertPad - 2;
      const maxColor = interpolateColor((displayMax - colorMin) / colorRange, reverse);
      const minColor = interpolateColor((displayMin - colorMin) / colorRange, reverse);
      content += `<text x="${scaleX}" y="${maxY.toFixed(1)}" font-family="-apple-system,Helvetica" font-size="9" font-weight="500" fill="${maxColor}" opacity="0.7">${escapeXml(formatScaleValue(displayMax) + unitSuffix)}</text>`;
      content += `<text x="${scaleX}" y="${minY.toFixed(1)}" font-family="-apple-system,Helvetica" font-size="9" font-weight="500" fill="${minColor}" opacity="0.7">${escapeXml(formatScaleValue(displayMin) + unitSuffix)}</text>`;
    }
  }

  if (timeLabel) {
    content += `<text x="${width / 2}" y="${height - 4}" font-family="-apple-system,Helvetica" font-size="9" fill="#666" text-anchor="middle">${escapeXml(timeLabel)}</text>`;
  }

  if (timeframeBadge) {
    content += `<text x="${width - 4}" y="${height - 3}" font-family="-apple-system,Helvetica" font-size="9" font-weight="600" fill="#555" text-anchor="end">${escapeXml(timeframeBadge)}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type Timeframe = "1min" | "1hr" | "1day";

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  "1min": "Last 1 minute",
  "1hr": "Last 1 hour",
  "1day": "Last 24 hours",
};

export interface ColorRange {
  min: number;
  max: number;
}

export function renderKeypadGraph(
  points: DataPoint[],
  label: string,
  currentValue: string,
  timeframe: Timeframe,
  reverseColors?: boolean,
  unit?: string,
  colorRange?: ColorRange,
  freezeScale?: boolean
): string {
  const windowMsMap: Record<Timeframe, number | undefined> = {
    "1min": 60 * 1000,
    "1hr": 60 * 60 * 1000,
    "1day": 24 * 60 * 60 * 1000,
  };
  return renderGraph(points, {
    width: 144,
    height: 144,
    label,
    currentValue,
    timeLabel: TIMEFRAME_LABELS[timeframe],
    showBackground: true,
    windowMs: windowMsMap[timeframe],
    reverseColors,
    unit,
    historicalMin: colorRange?.min,
    historicalMax: colorRange?.max,
    freezeScale,
  });
}

export function renderEncoderGraph(
  points: DataPoint[],
  windowMs?: number,
  timeframeBadge?: string,
  reverseColors?: boolean,
  unit?: string,
  colorRange?: ColorRange,
  freezeScale?: boolean
): string {
  return renderGraph(points, {
    width: 200,
    height: 76,
    showScale: true,
    windowMs,
    timeframeBadge,
    reverseColors,
    unit,
    historicalMin: colorRange?.min,
    historicalMax: colorRange?.max,
    freezeScale,
  });
}

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export function nextTimeframe(current: Timeframe): Timeframe {
  const order: Timeframe[] = ["1min", "1hr", "1day"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

