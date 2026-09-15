// 轨道力学工具：基于 satellite.js 解析 TLE、传播到指定时刻、由状态矢量反算轨道根数。
import * as satellite from "satellite.js";
import type { OrbitalElements, TleRecord } from "../types";

const MU = 398600.4418; // 地球引力常数 km^3/s^2
const RE = 6378.137; // 地球平均半径 km

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface EciSample {
  date: Date;
  x: number; // km (TEME/ECI)
  y: number;
  z: number;
}

// ---------- 基础向量运算 ----------
const norm = (v: Vec3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const clamp = (x: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, x));
const TWO_PI = Math.PI * 2;

// ---------- satellite.js 封装 ----------
export function parseSatrec(rec: TleRecord): satellite.SatRec | null {
  try {
    const s = satellite.twoline2satrec(rec.line1, rec.line2);
    if (!s || !s.no) return null;
    return s;
  } catch {
    return null;
  }
}

export function orbitalPeriodSec(satrec: satellite.SatRec): number {
  // satrec.no 单位 rad/min
  const omega = satrec.no / 60; // rad/s
  return TWO_PI / omega;
}

export function propagateEci(
  satrec: satellite.SatRec,
  date: Date,
): { position: Vec3; velocity: Vec3 } | null {
  const pv = satellite.propagate(satrec, date);
  const p = pv.position as Vec3 | false;
  const v = pv.velocity as Vec3 | false;
  if (!p || !v) return null;
  return { position: p, velocity: v };
}

// ---------- 由状态矢量反算轨道根数 ----------
export function keplerianFromEci(
  r: Vec3,
  v: Vec3,
): {
  a: number;
  e: number;
  inclinationDeg: number;
  raanDeg: number;
  argLatDeg: number;
  altitudeKm: number;
} {
  const rmag = norm(r);
  const vmag = norm(v);
  const h = cross(r, v);
  const hmag = norm(h);
  const n = { x: -h.y, y: h.x, z: 0 };
  const nmag = norm(n);

  const energy = (vmag * vmag) / 2 - MU / rmag;
  const a = -MU / (2 * energy);

  const rv = dot(r, v);
  const evec: Vec3 = {
    x: ((vmag * vmag - MU / rmag) * r.x - rv * v.x) / MU,
    y: ((vmag * vmag - MU / rmag) * r.y - rv * v.y) / MU,
    z: ((vmag * vmag - MU / rmag) * r.z - rv * v.z) / MU,
  };
  const e = norm(evec);

  const inclinationDeg =
    hmag > 1e-12 ? (Math.acos(clamp(h.z / hmag, -1, 1)) * 180) / Math.PI : 0;

  let raanDeg = 0;
  if (nmag > 1e-9) {
    let raan = Math.acos(clamp(n.x / nmag, -1, 1));
    if (n.y < 0) raan = TWO_PI - raan;
    raanDeg = (raan * 180) / Math.PI;
  }

  // 纬度幅角 u = 近地点幅角 + 真近点角（对圆轨道同样适用，避免 e≈0 奇异）
  let argLatDeg = 0;
  if (nmag > 1e-9 && hmag > 1e-9) {
    const nhat = { x: n.x / nmag, y: n.y / nmag, z: n.z / nmag };
    const rhat = { x: r.x / rmag, y: r.y / rmag, z: r.z / rmag };
    const hhat = { x: h.x / hmag, y: h.y / hmag, z: h.z / hmag };
    const cnr = cross(nhat, rhat);
    let u = Math.atan2(dot(cnr, hhat), dot(nhat, rhat));
    if (u < 0) u += TWO_PI;
    argLatDeg = (u * 180) / Math.PI;
  }

  return {
    a,
    e,
    inclinationDeg,
    raanDeg,
    argLatDeg,
    altitudeKm: a - RE,
  };
}

// ---------- 单颗卫星在当前时刻的轨道根数 ----------
export function elementsAt(rec: TleRecord, date: Date): OrbitalElements {
  const base: OrbitalElements = {
    norad_id: rec.norad_id,
    name: rec.name,
    group: rec.group_name,
    inclinationDeg: 0,
    altitudeKm: 0,
    raanDeg: 0,
    argLatDeg: 0,
    semiMajorAxisKm: 0,
    valid: false,
  };
  const satrec = parseSatrec(rec);
  if (!satrec) return base;
  const pv = propagateEci(satrec, date);
  if (!pv) return base;
  const k = keplerianFromEci(pv.position, pv.velocity);
  return {
    ...base,
    inclinationDeg: k.inclinationDeg,
    altitudeKm: k.altitudeKm,
    raanDeg: k.raanDeg,
    argLatDeg: k.argLatDeg,
    semiMajorAxisKm: k.a,
    valid: true,
  };
}

// ---------- 采样：用于 Cesium 绘制 ----------
// 采样一圈轨道（惯性系下的轨道折线）。从当前时刻起采样一整圈即可，
// 轨道形状在惯性系中近似固定。
export function sampleOrbitEci(
  satrec: satellite.SatRec,
  samples = 64,
): Vec3[] {
  const ep = new Date();
  const T = orbitalPeriodSec(satrec);
  const out: Vec3[] = [];
  for (let k = 0; k <= samples; k++) {
    const t = new Date(ep.getTime() + (T * k) / samples);
    const pv = propagateEci(satrec, t);
    if (pv) out.push(pv.position);
  }
  return out;
}

// 采样未来一段时间内的轨迹点（用于卫星实时位置）
export function sampleTrackEci(
  satrec: satellite.SatRec,
  start: Date,
  durationSec: number,
  samples: number,
): EciSample[] {
  const out: EciSample[] = [];
  for (let k = 0; k < samples; k++) {
    const frac = samples === 1 ? 0 : k / (samples - 1);
    const t = new Date(start.getTime() + durationSec * frac);
    const pv = propagateEci(satrec, t);
    if (pv) out.push({ date: t, x: pv.position.x, y: pv.position.y, z: pv.position.z });
  }
  return out;
}
