// 共享类型定义

export interface TleRecord {
  norad_id: number;
  group_name: string;
  name: string;
  line1: string;
  line2: string;
  epoch: string | null;
  updated_at: string;
}

export interface GroupInfo {
  group_name: string;
  satellite_count: number;
  updated_at: string | null;
  last_status: string | null;
  last_success: string | null;
  last_attempt: string | null;
}

// 由 TLE 传播得到的瞬时轨道根数（当前时刻）
export interface OrbitalElements {
  norad_id: number;
  name: string;
  group: string;
  // 倾角 (deg)
  inclinationDeg: number;
  // 轨道高度 (km, 半长轴 - 地球半径)
  altitudeKm: number;
  // 升交点赤经 RAAN (deg, 0-360)
  raanDeg: number;
  // 纬度幅角 = 近地点幅角 + 真近点角 (deg, 0-360)
  argLatDeg: number;
  // 半长轴 (km)
  semiMajorAxisKm: number;
  valid: boolean;
}

// 聚类结果
export interface Cluster {
  label: string;
  min: number;
  max: number;
  indices: number[];
}
