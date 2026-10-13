import { DiscordError, discordRequest } from './discord.js';
import { buildWeeklySchedule, displayName, formatWeekRange, loadSchedule, type SeriesSchedule, type WeeklySchedule } from './schedule.js';

const CONFIG_PREFIX = 'guild:';
const CATALOG_KEY = 'catalog';
const MAX_MESSAGE_LENGTH = 2000;

export interface SeriesInfo {
  name: string;
  label: string;
}

export interface GuildConfig {
  series: string[];
  thisWeekChannelId?: string;
  thisWeekMessageId?: string;
  thisWeekStart?: number;
}

export interface WeeklyEnv {
  CONFIG: KVNamespace;
  DISCORD_TOKEN: string;
}

export async function loadGuildConfig(env: WeeklyEnv, guildId: string): Promise<GuildConfig | null> {
  const stored = await env.CONFIG.get<GuildConfig & { tracked?: { series: string }[] }>(`${CONFIG_PREFIX}${guildId}`, 'json');
  if (!stored) return null;
  return { ...stored, series: stored.series ?? [...new Set((stored.tracked ?? []).map((item) => item.series))] };
}

export async function saveGuildConfig(env: WeeklyEnv, guildId: string, config: GuildConfig): Promise<void> {
  await env.CONFIG.put(`${CONFIG_PREFIX}${guildId}`, JSON.stringify(config));
}

export async function deleteGuildConfig(env: WeeklyEnv, guildId: string): Promise<void> {
  await env.CONFIG.delete(`${CONFIG_PREFIX}${guildId}`);
}

export async function refreshCatalog(env: WeeklyEnv, all?: SeriesSchedule[]): Promise<SeriesInfo[]> {
  const catalog = (all ?? (await loadSchedule())).map((series) => ({
    name: series.name,
    label: displayName(series.name),
  }));
  await env.CONFIG.put(CATALOG_KEY, JSON.stringify(catalog));
  return catalog;
}

export async function loadCatalog(env: WeeklyEnv): Promise<SeriesInfo[] | null> {
  return env.CONFIG.get<SeriesInfo[]>(CATALOG_KEY, 'json');
}

export function formatThisWeek(schedule: WeeklySchedule): string {
  const header = [`# ${schedule.season}`, `## Week ${schedule.week} · ${formatWeekRange(schedule.start)}`].filter(Boolean).join('\n');
  const lines = schedule.entries.map((entry) => `**${entry.series}**: ${[entry.track, entry.length].filter(Boolean).join(' · ')}`);

  let content = `${header}\n\n`;
  for (const line of lines) {
    if (content.length + line.length + 1 > MAX_MESSAGE_LENGTH) break;
    content += `${line}\n`;
  }
  return content.trimEnd();
}

async function postThisWeek(env: WeeklyEnv, config: GuildConfig, schedule: WeeklySchedule): Promise<void> {
  if (!config.thisWeekChannelId) return;
  const path = `/channels/${config.thisWeekChannelId}/messages`;
  const body = JSON.stringify({ content: formatThisWeek(schedule) });

  if (config.thisWeekMessageId && config.thisWeekStart === schedule.start) {
    try {
      await discordRequest(env.DISCORD_TOKEN, `${path}/${config.thisWeekMessageId}`, { method: 'PATCH', body });
      return;
    } catch (err) {
      if (!(err instanceof DiscordError && err.status === 404)) throw err;
    }
  }

  const message = await discordRequest<{ id: string }>(env.DISCORD_TOKEN, path, { method: 'POST', body });
  config.thisWeekMessageId = message.id;
  config.thisWeekStart = schedule.start;
}

export async function syncGuild(env: WeeklyEnv, guildId: string, config: GuildConfig, all: SeriesSchedule[], now = new Date()): Promise<WeeklySchedule | undefined> {
  const schedule = buildWeeklySchedule(all, config.series, now);
  if (!schedule) {
    console.log(`guild ${guildId}: no tracked series has a current week, leaving channels untouched`);
    return undefined;
  }

  try {
    await postThisWeek(env, config, schedule);
  } finally {
    await saveGuildConfig(env, guildId, config);
  }
  return schedule;
}

export async function syncAllGuilds(env: WeeklyEnv): Promise<void> {
  const all = await loadSchedule();
  await refreshCatalog(env, all);

  const { keys } = await env.CONFIG.list({ prefix: CONFIG_PREFIX });
  for (const { name } of keys) {
    const guildId = name.slice(CONFIG_PREFIX.length);
    try {
      const config = await loadGuildConfig(env, guildId);
      if (config) await syncGuild(env, guildId, config, all);
    } catch (err) {
      console.error(`weekly sync failed for guild ${guildId}:`, err);
    }
  }
}
