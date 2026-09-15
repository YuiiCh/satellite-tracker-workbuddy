<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { TleRecord } from "../types";
import {
  parseSatrec,
  sampleTrackEci,
} from "../services/orbital";

const props = defineProps<{
  satellites: TleRecord[];
  multiplier: number; // 时间倍率 M，默认 1（实时）
  showOrbits: boolean;
}>();

// 配置（可用环境变量控制，这里给出合理默认）
const BASE_WINDOW = Number(import.meta.env.VITE_CESIUM_WINDOW ?? 1800); // 每单位 M 对应的时间窗（秒）
const BASE_SAMPLES = Number(import.meta.env.VITE_CESIUM_SAMPLES ?? 60); // 每单位 M 的基准采样数

const containerRef = ref<HTMLDivElement | null>(null);
const initError = ref<string | null>(null);
let viewer: Cesium.Viewer | null = null;
let building = false;

// 为不同星座群分配稳定颜色
const GROUP_COLORS: Record<string, Cesium.Color> = {};
const PALETTE = [
  Cesium.Color.CYAN,
  Cesium.Color.YELLOW,
  Cesium.Color.LIMEGREEN,
  Cesium.Color.ORANGE,
  Cesium.Color.MAGENTA,
  Cesium.Color.DEEPSKYBLUE,
  Cesium.Color.RED,
  Cesium.Color.SPRINGGREEN,
  Cesium.Color.GOLD,
  Cesium.Color.TOMATO,
  Cesium.Color.AQUA,
  Cesium.Color.VIOLET,
];
let paletteIdx = 0;
function colorForGroup(group: string): Cesium.Color {
  if (!GROUP_COLORS[group]) {
    GROUP_COLORS[group] = PALETTE[paletteIdx % PALETTE.length];
    paletteIdx++;
  }
  return GROUP_COLORS[group];
}

function initViewer() {
  if (!containerRef.value) return;
  // 不使用 Cesium Ion（离线 Natural Earth II 影像）
  Cesium.Ion.defaultAccessToken = "";
  viewer = new Cesium.Viewer(containerRef.value, {
    baseLayer: Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(
        Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII"),
      ),
    ),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: true,
    timeline: true,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true,
  });
  viewer.scene.globe.enableLighting = false;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.backgroundColor = Cesium.Color.BLACK;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#0b1b2b");
  // 隐藏版权信息（开发用）
  const credit = viewer.cesiumWidget.creditContainer as HTMLElement;
  if (credit) credit.style.display = "none";
  // 便于自动化调试
  (window as unknown as { __cesiumViewer?: Cesium.Viewer }).__cesiumViewer = viewer;
}

function buildScene() {
  if (!viewer || building) return;
  building = true;
  const sats = props.satellites;
  const M = Math.max(0.1, props.multiplier);

  // 时间窗随 M 变大而变长；采样数随 M 变大而变少（采样率降低）
  const windowSec = BASE_WINDOW * M;
  const pointSamples = Math.min(
    200,
    Math.max(8, Math.round(BASE_SAMPLES / M)),
  );

  const now = Cesium.JulianDate.fromDate(new Date());
  const stop = Cesium.JulianDate.addSeconds(now, windowSec, new Cesium.JulianDate());

  viewer.clock.startTime = now.clone();
  viewer.clock.stopTime = stop.clone();
  viewer.clock.currentTime = now.clone();
  viewer.clock.clockRange = Cesium.ClockRange.LOOP_STOP;
  viewer.clock.multiplier = M;
  viewer.clock.shouldAnimate = true;

  viewer.entities.removeAll();

  let added = 0;
  let skipped = 0;
  for (const rec of sats) {
    const satrec = parseSatrec(rec);
    if (!satrec) {
      skipped++;
      continue;
    }
    const color = colorForGroup(rec.group_name);

    // 采样范围扩展到 [now, now+2*window]，保证路径在循环播放时始终有数据
    const track = sampleTrackEci(satrec, new Date(), windowSec * 2, pointSamples * 2);
    if (track.length >= 2) {
      // 位置属性使用惯性系（INERTIAL），由构造参数指定参考框架
      const property = new Cesium.SampledPositionProperty(
        Cesium.ReferenceFrame.INERTIAL,
      );
      for (const s of track) {
        const jd = Cesium.JulianDate.fromDate(s.date);
        property.addSample(
          jd,
          Cesium.Cartesian3.fromElements(s.x * 1000, s.y * 1000, s.z * 1000),
        );
      }
      const entity: Cesium.Entity.ConstructorOptions = {
        position: property,
        point: {
          pixelSize: 4,
          color: color,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.4),
          outlineWidth: 1,
        },
      };
      // 轨道“未来轨迹”：沿惯性系位置属性绘制，自动随参考框架正确变换
      if (props.showOrbits) {
        entity.path = {
          resolution: 30,
          material: color.withAlpha(0.3),
          width: 1,
          leadTime: windowSec,
          trailTime: 0,
        };
      }
      viewer.entities.add(entity);
      added++;
    }
  }

  // 视角：俯瞰全球 + 轨道空间（60,000 km 高度，可同时看到 LEO 层与 GEO 带）
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(10, 20, 6.0e7),
  });
  viewer.scene.requestRender();
  building = false;
  emitStats(added, skipped);
}

const emit = defineEmits<{
  (e: "stats", payload: { added: number; skipped: number }): void;
}>();

function emitStats(added: number, skipped: number) {
  // 通过自定义事件告知父组件数量（setTimeout 避免与渲染竞争）
  emit("stats", { added, skipped });
}

onMounted(() => {
  try {
    initViewer();
    buildScene();
  } catch (e) {
    initError.value = (e as Error).message || String(e);
    console.error("Cesium 初始化失败（可能缺少 WebGL 支持）:", e);
  }
});

watch(
  () => [props.satellites, props.multiplier, props.showOrbits],
  () => buildScene(),
  { deep: false },
);

onBeforeUnmount(() => {
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
});
</script>

<template>
  <div class="cesium-root">
    <div ref="containerRef" class="cesium-container"></div>
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
