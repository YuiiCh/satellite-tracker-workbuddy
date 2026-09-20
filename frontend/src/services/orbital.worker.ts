// 轨道计算 Web Worker：在独立线程中解析 TLE、传播，并把 ECI(TEME) 坐标
// 按 GMST 旋转为 ECEF（固定系）坐标。返回紧凑的 Float32Array，主线程零拷贝接收。
//
// 关键修复（卫星“显示数秒后消失”的根因）：
//   旧实现依赖 Cesium 的 SampledPositionProperty(INERTIAL)，渲染时需要
//   ICRF→Fixed 变换矩阵；在无 Cesium Ion token 时该矩阵数秒后返回 undefined，
//   导致点位无法渲染。改为在 Worker 内直接产出 ECEF，主线程只做插值，彻底规避该问题。
import * as satellite from "satellite.js";

export interface SatInput {
  line1: string;
  line2: string;
  norad_id: number;
  name: string;
  group_name: string;
}

export interface BuildRequest {
  type: "build";
  buildId: number;
  sats: SatInput[];
  epochMs: number;
  windowSec: number;
  samples: number;
}

export interface BuildResult {
  type: "done";
  buildId: number;
  epochMs: number;
  windowSec: number;
  samples: number;
  times: Float64Array; // 长度 = samples，相对 epoch 的秒数
  positions: Float32Array; // 长度 = N * samples * 3，ECEF km
  groups: string[]; // 长度 = N
  noradIds: number[]; // 长度 = N
  skipped: number;
  buildMs: number;
}

interface WorkerCtx {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: BuildResult, transfer: Transferable[]): void;
}
const ctx = self as unknown as WorkerCtx;

ctx.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { sats, epochMs, windowSec, samples, buildId } = e.data;
  const t0 = Date.now();
  const S = Math.max(2, samples | 0);

  const times = new Float64Array(S);
  for (let k = 0; k < S; k++) {
    times[k] = windowSec * (S === 1 ? 0 : k / (S - 1));
  }

  // 第一遍：解析并筛除无效卫星
  const valid: { rec: satellite.SatRec; group: string; norad: number }[] = [];
  let skipped = 0;
  for (const s of sats) {
    let rec: satellite.SatRec | null = null;
    try {
      rec = satellite.twoline2satrec(s.line1, s.line2);
    } catch {
      rec = null;
    }
    if (!rec || !rec.no) {
      skipped++;
      continue;
    }
    valid.push({ rec, group: s.group_name, norad: s.norad_id });
  }

  const N = valid.length;
  const positions = new Float32Array(N * S * 3);

  // 第二遍：逐采样点传播 + ECI(TEME)→ECEF（绕 Z 轴按 GMST 旋转）
  for (let i = 0; i < N; i++) {
    const { rec } = valid[i];
    for (let k = 0; k < S; k++) {
      const tMs = epochMs + times[k] * 1000;
      const tDate = new Date(tMs);
      const pv = satellite.propagate(rec, tDate);
      const pos = pv.position as { x: number; y: number; z: number } | false;
      const base = (i * S + k) * 3;
      if (!pos) {
        positions[base] = 0;
        positions[base + 1] = 0;
        positions[base + 2] = 0;
        continue;
      }
      // GMST（弧度）：TEME 与 ECEF 仅差此旋转
      const gmst = satellite.gstime(tDate);
      const c = Math.cos(gmst);
      const s = Math.sin(gmst);
      const x = pos.x;
      const y = pos.y;
      const z = pos.z;
      // [ECEF] = Rz(GMST) · [ECI]
      positions[base] = x * c + y * s;
      positions[base + 1] = -x * s + y * c;
      positions[base + 2] = z;
    }
  }

  const result: BuildResult = {
    type: "done",
    buildId,
    epochMs,
    windowSec,
    samples: S,
    times,
    positions,
    groups: valid.map((v) => v.group),
    noradIds: valid.map((v) => v.norad),
    skipped,
    buildMs: Date.now() - t0,
  };
  // 零拷贝转移缓冲区
  ctx.postMessage(result, [times.buffer, positions.buffer]);
};

export {};
