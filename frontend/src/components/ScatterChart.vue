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
const showShells = ref(false);
// 高度壳层可见性：记录每个壳层名是否勾选显示
const visible = ref<Set<string>>(new Set(props.series.map((s) => s.name)));
let chart: echarts.ECharts | null = null;
let ro: ResizeObserver | null = null;

// 系列变化（切换星座 / 数据刷新）时，保留既有勾选状态，新增壳层默认显示，下线壳层移除
watch(
  () => props.series,
  (next) => {
    const names = new Set(next.map((s) => s.name));
    const merged = new Set<string>();
    for (const n of visible.value) if (names.has(n)) merged.add(n);
    for (const n of names) if (!merged.has(n)) merged.add(n);
    visible.value = merged;
  },
  { deep: true },
);

// 实际绘制时只展示被勾选的壳层
const displaySeries = computed(() => props.series.filter((s) => visible.value.has(s.name)));

// 散点总数：用于自适应点径（按当前可见壳层计）
const totalPoints = computed(() =>
  displaySeries.value.reduce((a, s) => a + s.data.length, 0),
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
    series: displaySeries.value.map((s) => ({
      name: s.name,
      type: "scatter",
      symbolSize: adaptiveSize.value,
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
    requestAnimationFrame(() => chart?.resize());
  });
}

function toggleShell(name: string) {
  const next = new Set(visible.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  visible.value = next;
}

function selectAllShells() {
  visible.value = new Set(props.series.map((s) => s.name));
}

function invertShells() {
  const next = new Set<string>();
  for (const s of props.series) if (!visible.value.has(s.name)) next.add(s.name);
  visible.value = next;
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

watch(displaySeries, render, { deep: true });
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
    <div ref="elRef" class="scatter-chart"></div>

    <!-- 控制条：全屏 + 高度壳层，置于散点图下方，左右各占一半 -->
    <div class="chart-actions">
      <button class="ctrl-btn" type="button" @click="toggleFullscreen">
        {{ fullscreen ? "退出全屏" : "⛶ 全屏" }}
      </button>
      <button
        class="ctrl-btn"
        type="button"
        :title="fullscreen ? '收起高度壳层' : '展开高度壳层'"
        @click="showShells = !showShells"
      >
        🏷 高度壳层 ({{ series.length }})
      </button>
    </div>

    <!-- 高度壳层多选面板：勾选可筛选显示不同壳层 -->
    <div v-if="showShells" class="shell-panel">
      <div class="shell-head">
        <span>高度壳层（共 {{ series.length }} 个）</span>
        <span class="shell-mini">
          <button type="button" class="mini-btn" @click="selectAllShells">全选</button>
          <button type="button" class="mini-btn" @click="invertShells">反选</button>
        </span>
      </div>
      <div class="shell-list">
        <label v-for="s in series" :key="s.name" class="shell-item">
          <input
            type="checkbox"
            :checked="visible.has(s.name)"
            @change="toggleShell(s.name)"
          />
          <span class="shell-swatch" :style="{ background: s.color }"></span>
          <span class="shell-text">{{ s.name }}</span>
        </label>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chart-box {
  position: relative;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
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
  flex: 0 0 auto;
}
.chart-box.fullscreen .scatter-chart {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}
/* 控制条：两按钮左右各占一半，高度与原来一致 */
.chart-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.ctrl-btn {
  flex: 1 1 0;
  min-width: 0;
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
/* 高度壳层多选面板 */
.shell-panel {
  margin-top: 6px;
  background: rgba(10, 22, 34, 0.96);
  border: 1px solid #2a4a64;
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 38vh;
  display: flex;
  flex-direction: column;
}
.chart-box.fullscreen .shell-panel {
  max-height: 35vh;
}
.shell-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #9fc6e0;
  font-size: 12px;
  margin-bottom: 6px;
  border-bottom: 1px solid #1d3346;
  padding-bottom: 4px;
}
.shell-mini {
  display: flex;
  gap: 6px;
}
.mini-btn {
  background: rgba(20, 40, 60, 0.85);
  color: #cfe9ff;
  border: 1px solid #2a4a64;
  border-radius: 5px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.mini-btn:hover {
  background: rgba(40, 70, 100, 0.95);
}
.shell-list {
  overflow: auto;
}
.shell-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  color: #cfe9ff;
  cursor: pointer;
}
.shell-item input {
  cursor: pointer;
}
.shell-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.shell-text {
  line-height: 1.3;
}
</style>
