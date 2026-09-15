<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as echarts from "echarts";

export interface ScatterSeries {
  name: string;
  color: string;
  data: [number, number][]; // [RAAN, 纬度幅角]
}

const props = defineProps<{
  title: string;
  subtitle: string;
  series: ScatterSeries[];
}>();

const elRef = ref<HTMLDivElement | null>(null);
const fullscreen = ref(false);
const showLegend = ref(false);
let chart: echarts.ECharts | null = null;
let ro: ResizeObserver | null = null;

// 散点总数：用于自适应点径
const totalPoints = computed(() =>
  props.series.reduce((a, s) => a + s.data.length, 0),
);

// 散点大小随数量自适应缩小：点越多越小，防止相互重叠
// 公式 130/√n，限制在 [3, 14] px
const adaptiveSize = computed(() => {
  const n = totalPoints.value || 1;
  return Math.max(3, Math.min(14, Math.round(130 / Math.sqrt(n))));
});

function buildOption(): echarts.EChartsOption {
  return {
    title: {
      text: props.title,
      subtext: props.subtitle,
      left: "center",
      textStyle: { color: "#e6f3ff", fontSize: 15 },
      subtextStyle: { color: "#9fc6e0", fontSize: 12 },
    },
    tooltip: {
      trigger: "item",
      formatter: (p: any) =>
        `${p.seriesName}<br/>RAAN: ${p.value[0].toFixed(1)}°<br/>纬度幅角: ${p.value[1].toFixed(1)}°`,
    },
    // 高度簇图例改为外部可点击弹窗（见模板 legend-popup），避免与 x 轴文本重叠
    grid: { left: 48, right: 24, top: 56, bottom: 48 },
    xAxis: {
      name: "RAAN 升交点赤经 (°)",
      nameLocation: "middle",
      nameGap: 28,
      min: 0,
      max: 360,
      interval: 45,
      nameTextStyle: { color: "#9fc6e0" },
      axisLabel: { color: "#9fc6e0" },
      axisLine: { lineStyle: { color: "#3a5a72" } },
      splitLine: { lineStyle: { color: "#1d3346" } },
    },
    yAxis: {
      name: "纬度幅角 u (°)",
      nameLocation: "middle",
      nameGap: 32,
      min: 0,
      max: 360,
      interval: 45,
      nameTextStyle: { color: "#9fc6e0" },
      axisLabel: { color: "#9fc6e0" },
      axisLine: { lineStyle: { color: "#3a5a72" } },
      splitLine: { lineStyle: { color: "#1d3346" } },
    },
    series: props.series.map((s) => ({
      name: s.name,
      type: "scatter",
      symbolSize: adaptiveSize.value,
      // 大数据量时启用大数据模式，保证交互流畅
      large: true,
      largeThreshold: 800,
      itemStyle: { color: s.color, opacity: 0.85 },
      data: s.data,
    })),
  };
}

function render() {
  if (!chart) return;
  chart.setOption(buildOption(), true);
  chart.resize();
}

function toggleFullscreen() {
  fullscreen.value = !fullscreen.value;
  nextTick(() => {
    // 布局切换后下一帧重算画布尺寸
    requestAnimationFrame(() => chart?.resize());
  });
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && fullscreen.value) toggleFullscreen();
}

onMounted(() => {
  if (!elRef.value) return;
  chart = echarts.init(elRef.value, undefined, { renderer: "canvas" });
  render();
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(elRef.value);
});

watch(() => props.series, render, { deep: true });
watch(() => props.title, render);
watch(() => props.subtitle, render);
watch(fullscreen, (on) => {
  if (on) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  ro?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div class="chart-box" :class="{ fullscreen: fullscreen }" :data-symbol-size="adaptiveSize">
    <div class="chart-controls">
      <button class="ctrl-btn" type="button" @click="toggleFullscreen">
        {{ fullscreen ? "退出全屏" : "⛶ 全屏" }}
      </button>
      <button
        class="ctrl-btn"
        type="button"
        :title="fullscreen ? '收起高度图例' : '展开高度图例'"
        @click="showLegend = !showLegend"
      >
        🏷 高度图例 ({{ series.length }})
      </button>
    </div>

    <div ref="elRef" class="scatter-chart"></div>

    <div v-if="showLegend" class="legend-popup">
      <div class="legend-popup-head">高度壳层（共 {{ series.length }} 簇）</div>
      <div
        v-for="s in series"
        :key="s.name"
        class="legend-item"
      >
        <span class="legend-swatch" :style="{ background: s.color }"></span>
        <span class="legend-text">{{ s.name }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-box {
  position: relative;
  width: 100%;
  box-sizing: border-box;
}
.chart-box.fullscreen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: #0a1622;
  padding: 8px;
}
.scatter-chart {
  width: 100%;
  height: 380px;
}
.chart-box.fullscreen .scatter-chart {
  height: 100%;
}
.chart-controls {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 3;
  display: flex;
  gap: 6px;
}
.ctrl-btn {
  background: rgba(20, 40, 60, 0.85);
  color: #cfe9ff;
  border: 1px solid #2a4a64;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  backdrop-filter: blur(2px);
}
.ctrl-btn:hover {
  background: rgba(40, 70, 100, 0.95);
}
.legend-popup {
  position: absolute;
  top: 40px;
  right: 6px;
  z-index: 4;
  background: rgba(10, 22, 34, 0.96);
  border: 1px solid #2a4a64;
  border-radius: 8px;
  padding: 8px 10px;
  max-width: 280px;
  max-height: 72%;
  overflow: auto;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.legend-popup-head {
  color: #9fc6e0;
  font-size: 12px;
  margin-bottom: 6px;
  border-bottom: 1px solid #1d3346;
  padding-bottom: 4px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  color: #cfe9ff;
}
.legend-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.legend-text {
  line-height: 1.3;
}
</style>
