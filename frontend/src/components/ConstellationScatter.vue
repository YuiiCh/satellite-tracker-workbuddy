<script setup lang="ts">
import { computed } from "vue";
import type { TleRecord } from "../types";
import { elementsAt } from "../services/orbital";
import { cluster1D } from "../services/clustering";
import ScatterChart, { type ScatterSeries } from "./ScatterChart.vue";

const props = defineProps<{
  satellites: TleRecord[];
}>();

// 倾角聚类间隔（度）与高度聚类间隔（km），可用环境变量覆盖
const INCL_GAP = Number(import.meta.env.VITE_INCL_GAP ?? 3);
const ALT_GAP = Number(import.meta.env.VITE_ALT_GAP ?? 300);

const ALT_PALETTE = [
  "#4fd1ff",
  "#ffd166",
  "#06d6a0",
  "#ff6b6b",
  "#c77dff",
  "#ff9f1c",
  "#80ed99",
  "#f15bb5",
];

interface ChartConfig {
  title: string;
  subtitle: string;
  series: ScatterSeries[];
}

const charts = computed<ChartConfig[]>(() => {
  const now = new Date();
  const elements = props.satellites
    .map((r) => elementsAt(r, now))
    .filter((e) => e.valid);
  if (elements.length === 0) return [];

  // 第一层：按倾角聚类
  const inclValues = elements.map((e) => e.inclinationDeg);
  const inclClusters = cluster1D(inclValues, INCL_GAP);

  const result: ChartConfig[] = [];
  for (const ic of inclClusters) {
    const sub = ic.indices.map((i) => elements[i]);
    // 第二层：在同一倾角壳层内按轨道高度聚类
    const altValues = sub.map((e) => e.altitudeKm);
    const altClusters = cluster1D(altValues, ALT_GAP);

    const series: ScatterSeries[] = altClusters.map((ac, j) => {
      const data: [number, number][] = ac.indices.map((k) => {
        const e = sub[k];
        return [
          Math.round(e.raanDeg * 10) / 10,
          Math.round(e.argLatDeg * 10) / 10,
        ];
      });
      const span = ac.max - ac.min;
      const name =
        span < 50
          ? `高度 ≈${Math.round((ac.min + ac.max) / 2)} km（${ac.indices.length}）`
          : `高度 ${Math.round(ac.min)}~${Math.round(ac.max)} km（${ac.indices.length}）`;
      return {
        name,
        color: ALT_PALETTE[j % ALT_PALETTE.length],
        data,
      };
    });

    result.push({
      title: `倾角壳层 ${ic.label}°`,
      subtitle: `${sub.length} 颗 · ${altClusters.length} 个高度壳层`,
      series,
    });
  }
  return result;
});

const summary = computed(() => {
  const valid = props.satellites.length;
  return {
    total: valid,
    charts: charts.value.length,
  };
});
</script>

<template>
  <div class="scatter-wrap">
    <div v-if="charts.length === 0" class="empty">
      该星座暂无有效轨道数据（可能 TLE 暂未抓取成功）。
    </div>
    <template v-else>
      <div class="summary">
        共 {{ summary.total }} 颗卫星 · 按倾角聚为 {{ summary.charts }} 个壳层（每层再按高度分簇，颜色区分）
      </div>
      <div class="chart-grid">
        <div v-for="(c, i) in charts" :key="i" class="chart-card">
          <ScatterChart :title="c.title" :subtitle="c.subtitle" :series="c.series" />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.scatter-wrap {
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: 12px;
  box-sizing: border-box;
}
.summary {
  color: #9fc6e0;
  font-size: 13px;
  margin-bottom: 10px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 12px;
}
.chart-card {
  background: #0d1b2a;
  border: 1px solid #1d3346;
  border-radius: 8px;
  padding: 6px;
}
.empty {
  color: #9fc6e0;
  text-align: center;
  margin-top: 40px;
}
</style>
