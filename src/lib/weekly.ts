import { DiscordError, discordRequest } from './discord.js';
import { buildWeeklySchedule, displayName, formatWeekRange, loadSchedule, type SeriesSchedule, type WeeklySchedule } from './schedule.js';

const CONFIG_PREFIX = 'guild:';
const CATALOG_KEY = 'catalog';
const MAX_MESSAGE_LENGTH = 2000;
const MAX_CARS_LENGTH = 200;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

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

const DAY_NUMBERS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_PATTERN = /\b(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)days?\b/gi;

const CAR_CLASSES: [RegExp, string][] = [
  [/GTP|Hybrid V8/, 'GTP'],
  [/499P|LMH/, 'LMH'],
  [/P217/, 'P217'],
  [/P320/, 'P320'],
  [/GT3/, 'GT3'],
  [/GT4/, 'GT4'],
  [/GTE/, 'GTE'],
  [/TCR/, 'TCR'],
];

function groupByClass(cars: string[]): string[] {
  const grouped = cars.map((car) => CAR_CLASSES.find(([pattern]) => pattern.test(car))?.[1] ?? car);
  return [...new Set(grouped)];
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

  const grouped = groupByClass(all);
  if (grouped.length < all.length) return grouped.join(', ');

  const shown: string[] = [];
  let length = 0;
  for (const car of all) {
    if (shown.length > 0 && length + car.length > MAX_CARS_LENGTH) break;
    shown.push(car);
    length += car.length + 2;
  }
  return all.length > shown.length ? `${shown.join(', ')} +${all.length - shown.length} more` : shown.join(', ');
}

export function formatRaceTimes(races: string, eventStart: number): string {
  const eventDay = new Date(eventStart).getUTCDay();
  const days = [...races.matchAll(DAY_PATTERN)];
  const instants = new Set<number>();

  for (const [index, day] of days.entries()) {
    const text = races.slice((day.index ?? 0) + day[0].length, days[index + 1]?.index);
    const offset = ((DAY_NUMBERS[day[1].slice(0, 3).toLowerCase()] - eventDay + 8) % 7) - 1;
    for (const [, hour, minute] of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\b/g)) {
      instants.add(eventStart + offset * DAY_MS + Number(hour) * HOUR_MS + Number(minute ?? 0) * 60_000);
    }
  }

  const parts = (time: number) => {
    const formatted = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Denver' }).formatToParts(time);
    const get = (type: string) => formatted.find((part) => part.type === type)?.value ?? '';
    const minute = get('minute') === '00' ? '' : `:${get('minute')}`;
    return { day: get('weekday'), time: `${get('hour')}${minute}${get('dayPeriod').toLowerCase()}` };
  };

  const byDay = new Map<string, string[]>();
  for (const time of [...instants].sort((a, b) => a - b)) {
    const { day, time: label } = parts(time);
    byDay.set(day, [...(byDay.get(day) ?? []), label]);
  }
  return byDay.size === 0 ? '' : `${[...byDay].map(([day, times]) => `${day} ${times.join(', ')}`).join(' · ')} MT`;
}

export function formatThisWeek(schedule: WeeklySchedule): string {
  const header = [`# ${[schedule.season, `Week ${schedule.week}`].filter(Boolean).join(' ')}`, `## ${formatWeekRange(schedule.start)}`].join('\n');

  let content = header;
  let category = '';
  for (const entry of schedule.entries) {
    const heading = entry.category === category ? '' : `\n\n### ${entry.category}`;
    const details = [entry.track, entry.cars && `***${formatCars(entry.cars)}***`].filter(Boolean).join(' · ');
    const times = entry.races && formatRaceTimes(entry.races, entry.start);
    const line = `\n**${entry.series}**: ${details}${times ? `\n-# ${times}` : ''}`;
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
  if (!config.thisWeekChannelId) {
    console.log(`guild ${guildId}: no channel set, skipping the weekly post`);
    return undefined;
  }

  const schedule = buildWeeklySchedule(all, config.series, new Date(now.getTime() + LOOKAHEAD_MS));
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
