'use client';

import { memo } from 'react';

interface SparklineProps {
  color?: string;
  data: number[];
  height?: number;
  width?: number;
}

/** Dependency-free SVG line chart with axis. */
export const Sparkline = memo<SparklineProps>(
  ({ color = '#1677ff', data, height = 80, width = 320 }) => {
    if (data.length === 0) return <svg height={height} width={width} />;
    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : width;

    const points = data
      .map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 8) - 4}`)
      .join(' ');

    return (
      <svg height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        <polyline fill="none" points={points} stroke={color} strokeWidth={2} />
        {data.map((v, i) => (
          <circle
            cx={i * stepX}
            cy={height - ((v - min) / range) * (height - 8) - 4}
            fill={color}
            key={i}
            r={2}
          />
        ))}
      </svg>
    );
  },
);

Sparkline.displayName = 'Sparkline';

interface BarChartProps {
  color?: string;
  data: { label: string; value: number }[];
  height?: number;
  width?: number;
}

export const BarChart = memo<BarChartProps>(
  ({ color = '#1677ff', data, height = 160, width = 480 }) => {
    if (data.length === 0) return <svg height={height} width={width} />;
    const max = Math.max(...data.map((d) => d.value), 1);
    const barW = (width - 32) / data.length - 8;

    return (
      <svg height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 32);
          const x = 16 + i * (barW + 8);
          const y = height - 24 - h;
          return (
            <g key={d.label}>
              <rect fill={color} height={h} rx={2} width={barW} x={x} y={y} />
              <text
                fill="#666"
                fontSize={10}
                textAnchor="middle"
                x={x + barW / 2}
                y={height - 8}
              >
                {d.label}
              </text>
              <text
                fill="#333"
                fontSize={10}
                textAnchor="middle"
                x={x + barW / 2}
                y={y - 2}
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
    );
  },
);

BarChart.displayName = 'BarChart';

interface StackedBarChartProps {
  data: { label: string; segments: { color: string; name: string; value: number }[] }[];
  height?: number;
  width?: number;
}

export const StackedBarChart = memo<StackedBarChartProps>(
  ({ data, height = 200, width = 560 }) => {
    if (data.length === 0) return <svg height={height} width={width} />;
    const totals = data.map((d) => d.segments.reduce((a, b) => a + b.value, 0));
    const max = Math.max(...totals, 1);
    const barW = (width - 32) / data.length - 12;

    return (
      <svg height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        {data.map((d, i) => {
          const x = 16 + i * (barW + 12);
          let cumulativeBottom = height - 24;
          const total = totals[i];
          return (
            <g key={d.label}>
              {d.segments.map((seg) => {
                const h = (seg.value / max) * (height - 40);
                cumulativeBottom -= h;
                return (
                  <rect
                    fill={seg.color}
                    height={h}
                    key={seg.name}
                    rx={1}
                    width={barW}
                    x={x}
                    y={cumulativeBottom}
                  />
                );
              })}
              <text
                fill="#666"
                fontSize={11}
                textAnchor="middle"
                x={x + barW / 2}
                y={height - 8}
              >
                {d.label}
              </text>
              <text
                fill="#333"
                fontSize={10}
                textAnchor="middle"
                x={x + barW / 2}
                y={height - 24 - (total / max) * (height - 40) - 4}
              >
                ${total.toFixed(0)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  },
);

StackedBarChart.displayName = 'StackedBarChart';
