<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
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
let chart: echarts.ECharts | null = null;
let ro: ResizeObserver | null = null;

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
    legend: {
      bottom: 0,
      textStyle: { color: "#bcd" },
      type: "scroll",
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
    series: props.series.map((s) => ({
      name: s.name,
      type: "scatter",
      symbolSize: 7,
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

onMounted(() => {
  if (!elRef.value) return;
  chart = echarts.init(elRef.value, undefined, { renderer: "canvas" });
  render();
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(elRef.value);
});

watch(() => props.series, render, { deep: true });
watch(() => props.title, render);

onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
  chart = null;
});
</script>

<template>
  <div ref="elRef" class="scatter-chart"></div>
</template>

<style scoped>
.scatter-chart {
  width: 100%;
  height: 380px;
}
</style>
