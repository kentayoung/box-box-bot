import type { DiscordCommandOption, DiscordInteraction } from '../types.js';
import { loadSchedule } from './schedule.js';
import {
  deleteGuildConfig,
  loadCatalog,
  loadGuildConfig,
  refreshCatalog,
  saveGuildConfig,
  syncGuild,
  type GuildConfig,
  type SeriesInfo,
  type WeeklyEnv,
} from './weekly.js';

const MAX_CHOICES = 25;
const MAX_CHOICE_LENGTH = 100;

interface Choice {
  name: string;
  value: string;
}

function matchesQuery(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => lower.includes(word));
}

function optionValue(options: DiscordCommandOption[] | undefined, name: string): string | undefined {
  const value = options?.find((option) => option.name === name)?.value;
  return value === undefined ? undefined : String(value);
}

function describe(name: string, catalog: SeriesInfo[] | null): string {
  return catalog?.find((series) => series.name === name)?.label ?? name;
}

export async function autocompleteWeekly(interaction: DiscordInteraction, env: WeeklyEnv, ctx: ExecutionContext): Promise<Choice[]> {
  const sub = interaction.data?.options?.[0];
  const focused = sub?.options?.find((option) => option.focused);
  if (!sub || !focused) return [];
  const query = String(focused.value ?? '');

  if (sub.name === 'remove' && interaction.guild_id) {
    const [config, catalog] = await Promise.all([loadGuildConfig(env, interaction.guild_id), loadCatalog(env)]);
    return (config?.series ?? [])
      .map((name, index) => ({ name: describe(name, catalog).slice(0, MAX_CHOICE_LENGTH), value: String(index) }))
      .filter((choice) => matchesQuery(choice.name, query))
      .slice(0, MAX_CHOICES);
  }

  const catalog = await loadCatalog(env);
  if (!catalog) {
    ctx.waitUntil(refreshCatalog(env).catch((err) => console.error('catalog refresh failed:', err)));
    return [];
  }

  return catalog
    .filter((series) => matchesQuery(series.label, query))
    .slice(0, MAX_CHOICES)
    .map((series) => ({ name: series.label.slice(0, MAX_CHOICE_LENGTH), value: series.name.slice(0, MAX_CHOICE_LENGTH) }));
}

async function syncAndDescribe(env: WeeklyEnv, guildId: string, config: GuildConfig, all: Awaited<ReturnType<typeof loadSchedule>>): Promise<string> {
  if (!config.thisWeekChannelId) {
    return 'Set where to post with `/weekly channel`.';
  }
  try {
    const schedule = await syncGuild(env, guildId, config, all);
    return schedule ? 'The post is up to date.' : 'None of your series have a race this week yet.';
  } catch (err) {
    console.error('weekly sync failed:', err);
    return "I saved that, but couldn't post. Check I can view and send messages in that channel.";
  }
}

export async function handleWeekly(interaction: DiscordInteraction, env: WeeklyEnv, reply: (content: string) => Promise<void>): Promise<void> {
  const guildId = interaction.guild_id;
  const sub = interaction.data?.options?.[0];

  try {
    if (!guildId || !sub) throw new Error('weekly used outside a guild or without a subcommand');
    const config = (await loadGuildConfig(env, guildId)) ?? { series: [] };

    if (sub.name === 'stop') {
      await deleteGuildConfig(env, guildId);
      await reply('The weekly post is off. The existing message stays where it is.');
      return;
    }

    if (sub.name === 'refresh') {
      if (config.series.length === 0) {
        await reply('Nothing is tracked yet. Add a series with `/weekly add`.');
        return;
      }
      await reply(await syncAndDescribe(env, guildId, config, await loadSchedule()));
      return;
    }

    if (sub.name === 'list') {
      const catalog = await loadCatalog(env);
      const channel = config.thisWeekChannelId ? `<#${config.thisWeekChannelId}>` : 'not set';
      const series = config.series.map((name) => `- ${describe(name, catalog)}`).join('\n') || 'Nothing yet. Add a series with `/weekly add`.';
      await reply(`**Channel:** ${channel}\n**Tracking:**\n${series}`);
      return;
    }

    if (sub.name === 'remove') {
      const [removed] = config.series.splice(Number(optionValue(sub.options, 'series')), 1);
      if (!removed) {
        await reply("Couldn't find that one. Pick it from the list as you type.");
        return;
      }
      await saveGuildConfig(env, guildId, config);
      await reply(`Stopped tracking ${describe(removed, await loadCatalog(env))}.`);
      return;
    }

    if (sub.name === 'channel') {
      const channel = optionValue(sub.options, 'channel');
      if (!channel) return;
      if (channel !== config.thisWeekChannelId) {
        config.thisWeekChannelId = channel;
        config.thisWeekMessageId = undefined;
        config.thisWeekStart = undefined;
      }
      await saveGuildConfig(env, guildId, config);
      await reply(`Channel saved. ${await syncAndDescribe(env, guildId, config, await loadSchedule())}`);
      return;
    }

    if (sub.name === 'add') {
      const name = optionValue(sub.options, 'series');
      const all = await loadSchedule();
      await refreshCatalog(env, all);

      const series = all.find((candidate) => candidate.name === name);
      if (!series) {
        await reply("I don't know that series. Pick it from the list as you type.");
        return;
      }

      const alreadyTracked = config.series.includes(series.name);
      if (!alreadyTracked) config.series.push(series.name);
      await saveGuildConfig(env, guildId, config);
      const status = await syncAndDescribe(env, guildId, config, all);
      await reply(`${alreadyTracked ? 'Already tracking' : 'Tracking'} ${describe(series.name, await loadCatalog(env))}. ${status}`);
      return;
    }
  } catch (err) {
    console.error('weekly command failed:', err);
    await reply("Couldn't do that right now. Try again in a bit.");
  }
}
