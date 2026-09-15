import type { GroupInfo, TleRecord } from "../types";

const API_BASE: string =
  import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`请求 ${path} 失败 (${resp.status}): ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as T;
}

export const api = {
  baseUrl: API_BASE,

  async health(): Promise<{
    status: string;
    total_satellites: number;
    groups: number;
    refresh_period_seconds: number;
  }> {
    return getJson("/api/health");
  },

  async groups(): Promise<GroupInfo[]> {
    const data = await getJson<{ groups: GroupInfo[] }>("/api/groups");
    return data.groups;
  },

  async satellites(group?: string): Promise<TleRecord[]> {
    const path = group ? `/api/satellites?group=${encodeURIComponent(group)}` : "/api/satellites";
    const data = await getJson<{ satellites: TleRecord[] }>(path);
    return data.satellites;
  },
};
