<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api } from "./services/api";
import type { GroupInfo, TleRecord } from "./types";
import CesiumGlobe from "./components/CesiumGlobe.vue";
import ConstellationScatter from "./components/ConstellationScatter.vue";
import ControlPanel from "./components/ControlPanel.vue";

const mode = ref<"all" | "constellation">("all");
const multiplier = ref(Number(import.meta.env.VITE_DEFAULT_M ?? 1));
const showOrbits = ref(true);
const selectedGroup = ref("");
const groups = ref<GroupInfo[]>([]);
const allSatellites = ref<TleRecord[]>([]);
const groupCache = ref<Record<string, TleRecord[]>>({});
const loading = ref(false);
const dataError = ref("");
const refreshPeriod = ref(7200);
const cesiumStats = ref<{ added: number; skipped: number }>({ added: 0, skipped: 0 });

const currentGroupSats = computed<TleRecord[]>(
  () => groupCache.value[selectedGroup.value] ?? [],
);

const satelliteCount = computed(() =>
  mode.value === "all"
    ? allSatellites.value.length
    : currentGroupSats.value.length,
);

async function loadGroups() {
  try {
    const g = await api.groups();
    groups.value = g;
    const withData = g.filter((x) => x.satellite_count > 0).sort(
      (a, b) => b.satellite_count - a.satellite_count,
    );
    if (withData.length && !selectedGroup.value) {
      selectedGroup.value = withData[0].group_name;
    }
  } catch (e) {
    dataError.value = `获取星座列表失败：${(e as Error).message}`;
  }
}

async function loadAll() {
  loading.value = true;
  dataError.value = "";
  try {
    allSatellites.value = await api.satellites();
    const h = await api.health().catch(() => null);
    if (h) refreshPeriod.value = h.refresh_period_seconds;
  } catch (e) {
    dataError.value = `获取全部卫星失败：${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
}

async function loadGroup(g: string) {
  if (!g) return;
  if (groupCache.value[g]) return;
  loading.value = true;
  dataError.value = "";
  try {
    groupCache.value = { ...groupCache.value, [g]: await api.satellites(g) };
  } catch (e) {
    dataError.value = `获取星座 ${g} 失败：${(e as Error).message}`;
  } finally {
    loading.value = false;
  }
}

async function refreshAll() {
  // 触发后端立即刷新，并重新拉取前端数据
  loading.value = true;
  try {
    await fetch(`${api.baseUrl}/api/refresh`, { method: "POST" }).catch(() => {});
    await loadGroups();
    if (mode.value === "all") {
      await loadAll();
    } else if (selectedGroup.value) {
      groupCache.value = {};
      await loadGroup(selectedGroup.value);
    }
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await loadGroups();
  await loadAll();
  if (selectedGroup.value) await loadGroup(selectedGroup.value);
});

watch(mode, async (m) => {
  if (m === "constellation" && selectedGroup.value) {
    await loadGroup(selectedGroup.value);
  }
});

watch(selectedGroup, async (g) => {
  if (mode.value === "constellation" && g) {
    await loadGroup(g);
  }
});

function onStats(s: { added: number; skipped: number }) {
  cesiumStats.value = s;
}
</script>

<template>
  <div class="layout">
    <ControlPanel
      v-model:mode="mode"
      v-model:multiplier="multiplier"
      v-model:showOrbits="showOrbits"
      v-model:selectedGroup="selectedGroup"
      :groups="groups"
      :loading="loading"
      :satellite-count="satelliteCount"
      :refresh-period="refreshPeriod"
      @refresh="refreshAll"
    />

    <main class="content">
      <div class="content-head">
        <span v-if="mode === 'all'">全部卫星 · Cesium 三维视图</span>
        <span v-else>星座聚类 · {{ selectedGroup || "—" }}</span>
        <span v-if="mode === 'all'" class="stat">
          已绘制 {{ cesiumStats.added }} 颗<span v-if="cesiumStats.skipped">
            （跳过 {{ cesiumStats.skipped }}）</span
          >
        </span>
        <span v-else class="stat">共 {{ satelliteCount }} 颗</span>
      </div>

      <div v-if="dataError" class="err">{{ dataError }}</div>

      <div v-if="loading" class="loading">加载中…</div>

      <div class="view">
        <CesiumGlobe
          v-if="mode === 'all'"
          :satellites="allSatellites"
          :multiplier="multiplier"
          :show-orbits="showOrbits"
          @stats="onStats"
        />
        <ConstellationScatter
          v-else
          :satellites="currentGroupSats"
        />
      </div>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100%;
}
.content {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.content-head {
  height: 40px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.stat {
  color: var(--muted);
  margin-left: auto;
}
.view {
  position: relative;
  flex: 1;
  min-height: 0;
}
.loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(7, 17, 29, 0.6);
  z-index: 5;
}
.err {
  position: absolute;
  top: 48px;
  left: 16px;
  right: 16px;
  z-index: 10;
  background: #3a1620;
  border: 1px solid #ff6b6b;
  color: #ffd0d0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
</style>
