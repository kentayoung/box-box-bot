import { DiscordError, discordRequest } from './discord.js';
import { buildWeeklySchedule, displayName, formatWeekRange, loadSchedule, type SeriesSchedule, type WeeklySchedule } from './schedule.js';

const CONFIG_PREFIX = 'guild:';
const CATALOG_KEY = 'catalog';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CARS_LENGTH = 200;

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

function commonClass(cars: string[]): string {
  const [first, ...rest] = cars.map((car) => car.split(/[\s.]+/).filter((token) => /[A-Za-z0-9]/.test(token)));
  const shared = first.filter((token) => rest.every((tokens) => tokens.includes(token)));
  const label = shared.join(' ');
  return /[A-Za-z]/.test(label) && label.length >= 3 ? label : '';
}

export function formatCars(cars: string): string {
  const all = cars.split(/,\s*/);
  const label = all.length > 1 ? commonClass(all) : '';
  if (label) return label;

  const shown: string[] = [];
  let length = 0;
  for (const car of all) {
    if (shown.length > 0 && length + car.length > MAX_CARS_LENGTH) break;
    shown.push(car);
    length += car.length + 2;
  }
  return all.length > shown.length ? `${shown.join(', ')} +${all.length - shown.length} more` : shown.join(', ');
}

export function formatThisWeek(schedule: WeeklySchedule): string {
  const header = [`# ${schedule.season}`, `## Week ${schedule.week} · ${formatWeekRange(schedule.start)}`].filter(Boolean).join('\n');

  let content = header;
  let category = '';
  for (const entry of schedule.entries) {
    const heading = entry.category === category ? '' : `\n\n### ${entry.category}`;
    const cars = entry.cars ? `\n-# ${formatCars(entry.cars)}` : '';
    const line = `\n**${entry.series}**: ${[entry.track, entry.length].filter(Boolean).join(' · ')}${cars}`;
    if (content.length + heading.length + line.length > MAX_MESSAGE_LENGTH) break;
    category = entry.category;
    content += heading + line;
  }
  return content;
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
