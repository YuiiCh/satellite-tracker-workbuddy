<script setup lang="ts">
import type { GroupInfo } from "../types";

defineProps<{
  mode: "all" | "constellation";
  multiplier: number;
  showOrbits: boolean;
  groups: GroupInfo[];
  selectedGroup: string;
  loading: boolean;
  satelliteCount: number;
  refreshPeriod: number;
}>();

const emit = defineEmits<{
  (e: "update:mode", v: "all" | "constellation"): void;
  (e: "update:multiplier", v: number): void;
  (e: "update:showOrbits", v: boolean): void;
  (e: "update:selectedGroup", v: string): void;
  (e: "refresh"): void;
}>();

const presets = [1, 10, 60, 600];
</script>

<template>
  <aside class="panel">
    <div class="brand">
      <span class="logo">🛰️</span>
      <div>
        <div class="title">卫星实时可视化</div>
        <div class="sub">Vue3 · Cesium · TLE</div>
      </div>
    </div>

    <section>
      <label class="lbl">展示模式</label>
      <div class="seg">
        <button
          :class="{ active: mode === 'all' }"
          @click="emit('update:mode', 'all')"
        >
          全部卫星 (Cesium)
        </button>
        <button
          :class="{ active: mode === 'constellation' }"
          @click="emit('update:mode', 'constellation')"
        >
          单星座聚类 (散点)
        </button>
      </div>
    </section>

    <section v-if="mode === 'all'">
      <label class="lbl">时间倍率 M = {{ multiplier }}×（实时为 1）</label>
      <input
        type="range"
        min="0.5"
        max="20"
        step="0.5"
        :value="multiplier"
        @input="emit('update:multiplier', Number(($event.target as HTMLInputElement).value))"
      />
      <div class="presets">
        <button
          v-for="p in presets"
          :key="p"
          :class="{ active: multiplier === p }"
          @click="emit('update:multiplier', p)"
        >
          {{ p }}×
        </button>
      </div>
      <label class="chk">
        <input
          type="checkbox"
          :checked="showOrbits"
          @change="emit('update:showOrbits', ($event.target as HTMLInputElement).checked)"
        />
        显示轨道折线
      </label>
      <p class="hint">M 越大：预测时间窗越长、采样率越低（轨道预览越粗略）。</p>
    </section>

    <section v-else>
      <label class="lbl">选择星座 / 卫星群</label>
      <select
        :value="selectedGroup"
        @change="emit('update:selectedGroup', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="g in groups" :key="g.group_name" :value="g.group_name">
          {{ g.group_name }}（{{ g.satellite_count }}）
        </option>
      </select>
      <p class="hint">
        按“倾角”聚类分壳层，每层内再按“轨道高度”聚类；散点图 X=RAAN、Y=纬度幅角。
      </p>
    </section>

    <section class="meta">
      <div>当前数据：<b>{{ satelliteCount }}</b> 颗</div>
      <div>刷新周期：{{ Math.round(refreshPeriod / 60) }} 分钟</div>
      <button class="refresh" :disabled="loading" @click="emit('refresh')">
        {{ loading ? "加载中…" : "重新拉取" }}
      </button>
    </section>
  </aside>
</template>

<style scoped>
.panel {
  width: 280px;
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow: auto;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  font-size: 26px;
}
.title {
  font-weight: 600;
  font-size: 15px;
}
.sub {
  color: var(--muted);
  font-size: 11px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.lbl {
  color: var(--muted);
  font-size: 12px;
}
.seg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seg button,
.presets button,
.refresh,
select {
  background: var(--panel-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
}
.seg button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.presets {
  display: flex;
  gap: 6px;
}
.presets button {
  flex: 1;
}
.presets button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.chk {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
.hint {
  color: var(--muted);
  font-size: 11px;
  line-height: 1.5;
  margin: 0;
}
.meta {
  margin-top: auto;
  font-size: 12px;
  color: var(--muted);
  gap: 6px;
}
.meta b {
  color: var(--text);
}
.refresh {
  margin-top: 6px;
}
.refresh:disabled {
  opacity: 0.6;
  cursor: default;
}
input[type="range"] {
  width: 100%;
}
</style>
