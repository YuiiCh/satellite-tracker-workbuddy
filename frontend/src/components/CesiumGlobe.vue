<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TleRecord } from "../types";
import { SatelliteScene, type SceneReadout } from "../services/cesiumScene";
import type { SatInput } from "../services/orbital.worker";

const props = defineProps<{
  satellites: TleRecord[];
  multiplier: number;
  showOrbits: boolean;
}>();

const emit = defineEmits<{
  (e: "stats", payload: { added: number; skipped: number }): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const initError = ref<string | null>(null);
const readout = ref<SceneReadout>({
  drawn: 0,
  groups: [],
  utc: "",
  orbitLines: false,
  building: false,
});
let scene: SatelliteScene | null = null;
let readoutTimer: number | null = null;
let debounceTimer: number | null = null;
let lastDrawn = -1;

function toInputs(sats: TleRecord[]): SatInput[] {
  return sats.map((s) => ({
    line1: s.line1,
    line2: s.line2,
    norad_id: s.norad_id,
    name: s.name,
    group_name: s.group_name,
  }));
}

function rebuild() {
  if (!scene) return;
  scene.setData(toInputs(props.satellites), props.multiplier, props.showOrbits);
}

function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(rebuild, 120);
}

function pollReadout() {
  if (!scene) return;
  const r = scene.getReadout();
  readout.value = r;
  if (containerRef.value) containerRef.value.dataset.drawn = String(r.drawn);
  if (r.drawn !== lastDrawn) {
    lastDrawn = r.drawn;
    emit("stats", { added: r.drawn, skipped: 0 });
  }
}

onMounted(() => {
  try {
    scene = new SatelliteScene();
    scene.init(containerRef.value!);
    rebuild();
  } catch (e) {
    initError.value = (e as Error).message || String(e);
    console.error("Cesium 初始化失败（可能缺少 WebGL 支持）:", e);
  }
  readoutTimer = window.setInterval(pollReadout, 250);
});

watch(
  () => [props.satellites, props.multiplier, props.showOrbits],
  () => scheduleRebuild(),
);

onBeforeUnmount(() => {
  if (readoutTimer) clearInterval(readoutTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (scene) {
    scene.destroy();
    scene = null;
  }
});
</script>

<template>
  <div class="cesium-root">
    <div ref="containerRef" class="cesium-container"></div>

    <!-- 自定义玻璃感控制浮层（替代 Cesium 默认控件） -->
    <div v-if="!initError" class="overlay">
      <!-- 右上：图例 + 状态 -->
      <div class="panel legend">
        <div class="legend-head">
          <span class="dot live" :class="{ off: readout.building }"></span>
          <span class="utc">{{ readout.utc || "—" }}</span>
        </div>
        <div class="legend-sub">
          已绘制 <b>{{ readout.drawn.toLocaleString() }}</b> 颗 ·
          轨道线 <b>{{ readout.orbitLines ? "开" : "关" }}</b>
        </div>
        <div class="legend-list">
          <div v-for="g in readout.groups" :key="g.name" class="lg">
            <span class="sw" :style="{ background: g.color }"></span>
            <span class="nm">{{ g.name }}</span>
            <span class="ct">{{ g.count.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <!-- 右下：缩放 / 复位 -->
      <div class="panel toolbar">
        <button title="放大" @click="scene?.zoomIn()">+</button>
        <button title="缩小" @click="scene?.zoomOut()">−</button>
        <button title="复位视角" @click="scene?.resetView()">⤢</button>
      </div>

      <div v-if="readout.building" class="building">轨道计算中…</div>
    </div>

    <div v-if="initError" class="cesium-fallback">
      <p>无法初始化 Cesium 三维视图（需要支持 WebGL 的浏览器环境）。</p>
      <p class="sub">{{ initError }}</p>
    </div>
  </div>
</template>

<style scoped>
.cesium-root {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}
.cesium-container {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
}
.overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
}
.panel {
  position: absolute;
  pointer-events: auto;
  background: rgba(9, 15, 26, 0.55);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(140, 180, 230, 0.14);
  border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  color: #cfe3f5;
  font-size: 12px;
}
.legend {
  top: 14px;
  right: 14px;
  width: 188px;
  padding: 12px;
}
.legend-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #36e0a0;
  box-shadow: 0 0 8px #36e0a0;
}
.dot.off {
  background: #f0b429;
  box-shadow: 0 0 8px #f0b429;
}
.utc {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.3px;
  color: #eaf3ff;
}
.legend-sub {
  margin: 6px 0 8px;
  color: #9fb6cf;
}
.legend-sub b {
  color: #eaf3ff;
}
.legend-list {
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lg {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sw {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  flex: none;
}
.nm {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ct {
  color: #9fb6cf;
  font-variant-numeric: tabular-nums;
}
.toolbar {
  right: 14px;
  bottom: 16px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 6px;
}
.toolbar button {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(140, 180, 230, 0.18);
  background: rgba(20, 30, 48, 0.6);
  color: #dcebff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}
.toolbar button:hover {
  border-color: #4ea8ff;
  color: #fff;
  background: rgba(40, 70, 120, 0.7);
}
.building {
  position: absolute;
  left: 50%;
  top: 16px;
  transform: translateX(-50%);
  pointer-events: none;
  padding: 6px 14px;
  border-radius: 20px;
  background: rgba(9, 15, 26, 0.6);
  border: 1px solid rgba(140, 180, 230, 0.14);
  color: #cfe3f5;
  font-size: 12px;
}
.cesium-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #07111d;
  color: #9fc6e0;
  text-align: center;
  padding: 24px;
  z-index: 6;
}
.cesium-fallback .sub {
  font-size: 12px;
  color: #f08888;
  max-width: 520px;
  word-break: break-all;
}
</style>
