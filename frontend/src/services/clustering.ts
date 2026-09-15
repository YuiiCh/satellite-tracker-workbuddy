// 一维基于“间隔”的聚类：用于把卫星按倾角 / 轨道高度分壳层。
// 倾角/高度相近的卫星归为一类，间隔超过 minGap 则断开。
import type { Cluster } from "../types";

export function cluster1D(values: number[], minGap: number): Cluster[] {
  const n = values.length;
  if (n === 0) return [];

  // 携带原始下标后按数值排序
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const clusters: Cluster[] = [];
  let current: Cluster = {
    label: "",
    min: indexed[0].value,
    max: indexed[0].value,
    indices: [indexed[0].index],
  };

  for (let k = 1; k < n; k++) {
    const gap = indexed[k].value - indexed[k - 1].value;
    if (gap > minGap) {
      clusters.push(current);
      current = {
        label: "",
        min: indexed[k].value,
        max: indexed[k].value,
        indices: [indexed[k].index],
      };
    } else {
      current.max = indexed[k].value;
      current.indices.push(indexed[k].index);
    }
  }
  clusters.push(current);

  // 生成标签并排序（按高度/倾角从小到大）
  clusters.forEach((c) => {
    c.label =
      Math.abs(c.max - c.min) < 1e-6
        ? `${c.min.toFixed(1)}`
        : `${c.min.toFixed(1)}~${c.max.toFixed(1)}`;
  });
  clusters.sort((a, b) => a.min - b.min);
  return clusters;
}
