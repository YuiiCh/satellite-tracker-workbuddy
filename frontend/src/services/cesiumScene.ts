// SatelliteScene：封装 Cesium Viewer 与全部卫星渲染逻辑。
// - 轨道计算放在 Web Worker（orbital.worker.ts）中，主线程只做插值驱动；
// - 点位用 PointPrimitiveCollection（GPU 批处理，内存远低于“每星一 Entity”）；
// - 轨迹在 Worker 内已转为 ECEF，故彻底规避 INERTIAL 系 ICRF 变换失效导致的“消失”问题；
// - 黑底玻璃感地球 + 白色国家行政边界。
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import type { SatInput } from "./orbital.worker";

const PALETTE: Cesium.Color[] = [
  Cesium.Color.CYAN,
  Cesium.Color.GOLD,
  Cesium.Color.fromCssColorString("#ff5fa2"),
  Cesium.Color.LIMEGREEN,
  Cesium.Color.ORANGE,
  Cesium.Color.DEEPSKYBLUE,
  Cesium.Color.MAGENTA,
  Cesium.Color.fromCssColorString("#b388ff"),
  Cesium.Color.TOMATO,
  Cesium.Color.SPRINGGREEN,
  Cesium.Color.AQUA,
  Cesium.Color.YELLOW,
];

// 卫星过多时跳过轨道折线（避免一次性绘制上万条折线拖垮性能）
const ORBIT_LINE_CAP = 3000;
// 卫星像素点大小（较小，避免重叠成片）
const POINT_PIXEL_SIZE = 2;

export interface SceneReadout {
  drawn: number;
  groups: { name: string; color: string; count: number }[];
  utc: string;
  orbitLines: boolean;
  building: boolean;
}

interface ActivePayload {
  epochJD: Cesium.JulianDate;
  windowSec: number;
  samples: number;
  times: Float64Array;
  positions: Float32Array;
}

export class SatelliteScene {
  private viewer: Cesium.Viewer | null = null;
  private worker: Worker | null = null;
  private points: Cesium.PointPrimitiveCollection | null = null;
  private orbitLines: Cesium.PolylineCollection | null = null;
  private payload: ActivePayload | null = null;
  private colorByGroup = new Map<string, Cesium.Color>();
  private hexByGroup = new Map<string, string>();
  private paletteIdx = 0;
  private groupSummary: { name: string; color: string; count: number }[] = [];
  private scratch = new Cesium.Cartesian3();

  private multiplier = 1;
  private showOrbits = true;
  private building = false;
  private currentBuildId = 0;
  private tickListener: ((clock: Cesium.Clock) => void) | null = null;
  private clockDriver: number | null = null;

  private readonly baseWindow = Number(import.meta.env.VITE_CESIUM_WINDOW ?? 1800);
  private readonly baseSamples = Number(import.meta.env.VITE_CESIUM_SAMPLES ?? 90);

  get viewerInstance(): Cesium.Viewer | null {
    return this.viewer;
  }

  init(container: HTMLElement): void {
    Cesium.Ion.defaultAccessToken = "";
    const viewer = new Cesium.Viewer(container, {
      baseLayer: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      animation: false,
      timeline: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      shouldAnimate: true,
    });
    this.viewer = viewer;

    // ---- 黑底“玻璃感”地球 ----
    const globe = viewer.scene.globe;
    globe.baseColor = Cesium.Color.fromCssColorString("#05070d");
    globe.showGroundAtmosphere = true;
    globe.enableLighting = false;
    viewer.scene.backgroundColor = Cesium.Color.BLACK;
    if (viewer.scene.skyAtmosphere) {
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.skyAtmosphere.hueShift = 0.02;
      viewer.scene.skyAtmosphere.brightnessShift = 0.06;
      viewer.scene.skyAtmosphere.saturationShift = 0.28;
    }
    // 星空背景（离线 tycho 星图）
    if (viewer.scene.skyBox) viewer.scene.skyBox.show = true;

    // ---- 白色国家行政边界（离线 GeoJSON） ----
    Cesium.GeoJsonDataSource.load("/countries.geojson", {
      clampToGround: true,
      stroke: Cesium.Color.WHITE.withAlpha(0.82),
      fill: Cesium.Color.TRANSPARENT,
      strokeWidth: 1.2,
    })
      .then((ds) => viewer.dataSources.add(ds))
      .catch((e) => console.warn("边界图层加载失败（不影响卫星渲染）:", e));

    // 隐藏版权（离线开发用）
    const credit = viewer.cesiumWidget.creditContainer as HTMLElement | null;
    if (credit) credit.style.display = "none";

    // 默认俯瞰视角（含 LEO 与 GEO 带）
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0, 12, 4.0e7),
    });

    // ---- 轨道计算 Worker ----
    this.worker = new Worker(
      new URL("./orbital.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (e: MessageEvent) => this.onWorkerDone(e.data);
    this.worker.onerror = (e) => console.error("轨道 Worker 错误:", e.message);

    // ---- 时钟 tick：每帧插值驱动点位 ----
    this.tickListener = (clock: Cesium.Clock) => this.updatePositions(clock);
    viewer.clock.onTick.addEventListener(this.tickListener);

    // ---- 显式时钟驱动器 ----
    // 说明：关闭 animation 控件后，Cesium 的 Clock.tick() 在该环境下不会自动推进
    // currentTime（被判定为不可动画），导致时钟“冻结”、卫星不动。
    // 这里直接按真实时差推进时钟并驱动点位插值，完全自控、与页面是否可见无关。
    let last = performance.now();
    this.clockDriver = window.setInterval(() => {
      const v = this.viewer;
      if (!v) return;
      const w = window as unknown as { __tickCalls?: number };
      w.__tickCalls = (w.__tickCalls ?? 0) + 1;
      if (!v.clock.shouldAnimate) {
        last = performance.now();
        return;
      }
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      const adv = v.clock.multiplier * dt;
      let t = Cesium.JulianDate.addSeconds(
        v.clock.currentTime,
        adv,
        new Cesium.JulianDate(),
      );
      if (Cesium.JulianDate.greaterThan(t, v.clock.stopTime)) {
        if (v.clock.clockRange === Cesium.ClockRange.LOOP_STOP) {
          const span = Math.max(
            1e-6,
            Cesium.JulianDate.secondsDifference(v.clock.stopTime, v.clock.startTime),
          );
          let over = Cesium.JulianDate.secondsDifference(t, v.clock.stopTime);
          over = ((over % span) + span) % span;
          t = Cesium.JulianDate.addSeconds(
            v.clock.startTime,
            over,
            new Cesium.JulianDate(),
          );
        } else {
          t = v.clock.stopTime.clone();
        }
      }
      v.clock.currentTime = t;
      this.updatePositions(v.clock);
    }, 33);

    // 便于自动化调试
    (window as unknown as { __cesiumViewer?: Cesium.Viewer }).__cesiumViewer =
      viewer;
    (window as unknown as { __satScene?: SatelliteScene }).__satScene = this;
  }

  private colorForGroup(group: string): Cesium.Color {
    let c = this.colorByGroup.get(group);
    if (!c) {
      c = PALETTE[this.paletteIdx % PALETTE.length];
      this.paletteIdx++;
      this.colorByGroup.set(group, c);
      this.hexByGroup.set(group, c.toCssColorString());
    }
    return c;
  }

  /** 根据卫星数量与时间倍率计算采样预算（控制 Worker 计算量） */
  private computeSamples(n: number): number {
    const M = Math.max(0.1, this.multiplier);
    let s = Math.min(160, Math.max(12, Math.round(this.baseSamples / M)));
    const BUDGET = 600000; // 传播调用次数上限
    if (n * s > BUDGET) s = Math.max(12, Math.floor(BUDGET / n));
    return s;
  }

  /** 设置数据并（经 Worker）重建场景。仅在卫星/参数真正变化时调用。 */
  setData(sats: SatInput[], multiplier: number, showOrbits: boolean): void {
    this.multiplier = multiplier;
    this.showOrbits = showOrbits;
    if (!this.worker) return;
    const samples = this.computeSamples(sats.length);
    const windowSec = this.baseWindow * Math.max(0.1, multiplier);
    const buildId = ++this.currentBuildId;
    this.building = true;
    this.worker.postMessage({
      type: "build",
      buildId,
      sats,
      epochMs: Date.now(),
      windowSec,
      samples,
    } satisfies import("./orbital.worker").BuildRequest);
  }

  private onWorkerDone(data: import("./orbital.worker").BuildResult): void {
    if (data.type !== "done") return;
    if (data.buildId !== this.currentBuildId) return; // 丢弃过期结果
    if (!this.viewer) return;
    this.building = false;
    this.buildFromPayload(data);
  }

  private buildFromPayload(
    data: import("./orbital.worker").BuildResult,
  ): void {
    const viewer = this.viewer!;
    const N = data.groups.length;
    const S = data.samples;
    const positions = data.positions;

    this.clearCollections();

    // 组颜色与计数
    const groupCounts = new Map<string, number>();
    for (const g of data.groups) {
      this.colorForGroup(g);
      groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
    }
    this.groupSummary = [...groupCounts.entries()].map(([name, count]) => ({
      name,
      color: this.hexByGroup.get(name) ?? "#fff",
      count,
    }));

    // ---- 点位集合 ----
    const pts = new Cesium.PointPrimitiveCollection();
    for (let i = 0; i < N; i++) {
      const color = this.colorForGroup(data.groups[i]);
      pts.add({
        position: Cesium.Cartesian3.ZERO,
        pixelSize: POINT_PIXEL_SIZE,
        color,
        outlineColor: Cesium.Color.WHITE.withAlpha(0.25),
        outlineWidth: 0,
      });
    }
    viewer.scene.primitives.add(pts);
    this.points = pts;
    (window as unknown as { __cesiumPoints?: Cesium.PointPrimitiveCollection }).__cesiumPoints =
      pts;

    // ---- 轨道折线（受限数量时绘制） ----
    if (this.showOrbits && N <= ORBIT_LINE_CAP) {
      const lines = new Cesium.PolylineCollection();
      for (let i = 0; i < N; i++) {
        const color = this.colorForGroup(data.groups[i]);
        const arr: Cesium.Cartesian3[] = new Array(S);
        for (let k = 0; k < S; k++) {
          const b = (i * S + k) * 3;
          arr[k] = new Cesium.Cartesian3(
            positions[b] * 1000,
            positions[b + 1] * 1000,
            positions[b + 2] * 1000,
          );
        }
        lines.add({
          positions: arr,
          width: 1,
          material: Cesium.Material.fromType("Color", {
            color: color.withAlpha(0.28),
          }),
        });
      }
      viewer.scene.primitives.add(lines);
      this.orbitLines = lines;
    } else {
      this.orbitLines = null;
    }

    // ---- 时钟 ----
    const epochJD = Cesium.JulianDate.fromDate(new Date(data.epochMs));
    const start = epochJD.clone();
    const stop = Cesium.JulianDate.addSeconds(
      epochJD,
      data.windowSec,
      new Cesium.JulianDate(),
    );
    const clock = viewer.clock;
    clock.startTime = start;
    clock.stopTime = stop;
    const cur = clock.currentTime;
    if (
      Cesium.JulianDate.lessThan(cur, start) ||
      Cesium.JulianDate.greaterThan(cur, stop)
    ) {
      clock.currentTime = start.clone();
    }
    clock.clockRange = Cesium.ClockRange.LOOP_STOP;
    clock.multiplier = Math.max(0.1, this.multiplier);
    clock.shouldAnimate = true;

    this.payload = {
      epochJD,
      windowSec: data.windowSec,
      samples: S,
      times: data.times,
      positions,
    };

    // 立刻把点位放到当前时刻位置
    this.updatePositions(clock);
    viewer.scene.requestRender();
  }

  /** 每帧调用：按当前时钟时间在预计算轨迹上插值，更新全部点位位置（ECEF） */
  private updatePositions(clock: Cesium.Clock): void {
    const pts = this.points;
    const p = this.payload;
    if (!pts || !p) return;
    const S = p.samples;
    const sec = Cesium.JulianDate.secondsDifference(clock.currentTime, p.epochJD);
    const clamped = Math.min(Math.max(sec, 0), p.windowSec);
    const f = S === 1 ? 0 : (clamped / p.windowSec) * (S - 1);
    let i0 = Math.floor(f);
    if (i0 < 0) i0 = 0;
    if (i0 > S - 1) i0 = S - 1;
    const i1 = Math.min(i0 + 1, S - 1);
    const a = f - i0;
    const pos = p.positions;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const b0 = (i * S + i0) * 3;
      const b1 = (i * S + i1) * 3;
      const x = pos[b0] + (pos[b1] - pos[b0]) * a;
      const y = pos[b0 + 1] + (pos[b1 + 1] - pos[b0 + 1]) * a;
      const z = pos[b0 + 2] + (pos[b1 + 2] - pos[b0 + 2]) * a;
      this.scratch.x = x * 1000;
      this.scratch.y = y * 1000;
      this.scratch.z = z * 1000;
      pts.get(i).position = this.scratch;
    }
  }

  private clearCollections(): void {
    const viewer = this.viewer;
    if (!viewer) return;
    if (this.points) {
      viewer.scene.primitives.remove(this.points);
      this.points.destroy();
      this.points = null;
      (window as unknown as { __cesiumPoints?: Cesium.PointPrimitiveCollection }).__cesiumPoints =
        undefined;
    }
    if (this.orbitLines) {
      viewer.scene.primitives.remove(this.orbitLines);
      this.orbitLines.destroy();
      this.orbitLines = null;
    }
  }

  // ---- 自定义 UI 控制 ----
  zoomIn(): void {
    const v = this.viewer;
    if (!v) return;
    const h = v.camera.positionCartographic?.height ?? 4e7;
    v.camera.zoomIn(h * 0.35);
  }
  zoomOut(): void {
    const v = this.viewer;
    if (!v) return;
    const h = v.camera.positionCartographic?.height ?? 4e7;
    v.camera.zoomOut(h * 0.35);
  }
  resetView(): void {
    const v = this.viewer;
    if (!v) return;
    v.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(0, 12, 4.0e7),
      duration: 1.0,
    });
  }

  getReadout(): SceneReadout {
    let utc = "";
    if (this.viewer) {
      const d = Cesium.JulianDate.toDate(this.viewer.clock.currentTime);
      utc = d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
    }
    return {
      drawn: this.points ? this.points.length : 0,
      groups: this.groupSummary,
      utc,
      orbitLines: !!this.orbitLines,
      building: this.building,
    };
  }

  destroy(): void {
    if (this.clockDriver !== null) {
      clearInterval(this.clockDriver);
      this.clockDriver = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.clearCollections();
    if (this.viewer) {
      if (this.tickListener) {
        this.viewer.clock.onTick.removeEventListener(this.tickListener);
        this.tickListener = null;
      }
      this.viewer.destroy();
      this.viewer = null;
    }
    this.payload = null;
  }
}
