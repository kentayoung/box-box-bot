import { InteractionResponseType, InteractionType, verifyKey } from 'discord-interactions';
import { boxBoxCommand } from './commands/box-box.js';
import { statsCommand } from './commands/stats.js';
import { trackInsightsCommand } from './commands/track-insights.js';
import { weeklyCommand } from './commands/weekly.js';
import { generatePepTalk, generateTrackInsights } from './lib/gemini.js';
import { fetchCareerStats, formatCareerStatsSummary } from './lib/iracing-stats.js';
import { buildTrackVideoLinks } from './lib/track-links.js';
import { syncAllGuilds } from './lib/weekly.js';
import { autocompleteWeekly, handleWeekly } from './lib/weekly-command.js';
import type { DiscordCommandOption, DiscordInteraction, PepTalkInput } from './types.js';

export interface Env {
  DISCORD_PUBLIC_KEY: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  DISCORD_TOKEN: string;
  CONFIG: KVNamespace;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

function extractInput(options: DiscordCommandOption[] | undefined): PepTalkInput {
  const values = new Map((options ?? []).map((option) => [option.name, option.value]));
  return {
    name: values.get('name') as string | undefined,
    track: values.get('track') as string | undefined,
    series: values.get('series') as string | undefined,
    mood: values.get('mood') as string | undefined,
    context: values.get('context') as string | undefined,
  };
}

function extractCustId(options: DiscordCommandOption[] | undefined): number | undefined {
  const value = options?.find((option) => option.name === 'cust_id')?.value;
  return typeof value === 'number' ? value : undefined;
}

async function editOriginalResponse(applicationId: string, token: string, content: string): Promise<void> {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}/messages/@original`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}

async function handleBoxBox(interaction: DiscordInteraction, env: Env): Promise<void> {
  try {
    const input = extractInput(interaction.data?.options);

    const custId = extractCustId(interaction.data?.options);
    if (custId !== undefined) {
      try {
        input.statsSummary = formatCareerStatsSummary(await fetchCareerStats(String(custId)));
      } catch (err) {
        console.error('stats lookup for box-box failed, continuing without it:', err);
      }
    }

    const text = await generatePepTalk(input, {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    await editOriginalResponse(interaction.application_id, interaction.token, text);
  } catch (err) {
    console.error('box-box generation failed:', err);
    await editOriginalResponse(
      interaction.application_id,
      interaction.token,
      "Couldn't fire up your pep talk right now — the AI pit crew is having issues. Try again in a bit! 🏁",
    );
  }
}

async function handleStats(interaction: DiscordInteraction): Promise<void> {
  const values = new Map((interaction.data?.options ?? []).map((option) => [option.name, option.value]));
  const name = values.get('name') as string | undefined;
  const custId = extractCustId(interaction.data?.options);
  try {
    if (custId === undefined) {
      throw new Error('cust_id missing or not an integer');
    }
    const stats = await fetchCareerStats(String(custId));
    const summary = formatCareerStatsSummary(stats);
    const heading = name ? `${name} (${custId})` : String(custId);
    await editOriginalResponse(interaction.application_id, interaction.token, `**Career stats for ${heading}**\n${summary}`);
  } catch (err) {
    console.error('stats lookup failed:', err);
    await editOriginalResponse(
      interaction.application_id,
      interaction.token,
      "Couldn't find stats for that customer ID — double check the number and try again.",
    );
  }
}

async function handleTrackInsights(interaction: DiscordInteraction, env: Env): Promise<void> {
  const values = new Map((interaction.data?.options ?? []).map((option) => [option.name, option.value]));
  const track = values.get('track') as string | undefined;
  const car = values.get('car') as string | undefined;

  try {
    if (!track) {
      throw new Error('track missing');
    }
    const insights = await generateTrackInsights(track, car, {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    const links = buildTrackVideoLinks(track, car);
    const heading = car ? `${track} — ${car}` : track;
    await editOriginalResponse(interaction.application_id, interaction.token, `**${heading}**\n${insights}\n\n${links}`);
  } catch (err) {
    console.error('track-insights failed:', err);
    await editOriginalResponse(
      interaction.application_id,
      interaction.token,
      "Couldn't pull track insights right now — try again in a bit! 🏁",
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Expected POST', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();

    if (!signature || !timestamp || !(await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY))) {
      return new Response('Bad request signature', { status: 401 });
    }

    const interaction = JSON.parse(body) as DiscordInteraction;

    if (interaction.type === InteractionType.PING) {
      return jsonResponse({ type: InteractionResponseType.PONG });
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (interaction.data?.name === boxBoxCommand.name) {
        ctx.waitUntil(handleBoxBox(interaction, env));
        return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
      }
      if (interaction.data?.name === statsCommand.name) {
        ctx.waitUntil(handleStats(interaction));
        return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
      }
      if (interaction.data?.name === trackInsightsCommand.name) {
        ctx.waitUntil(handleTrackInsights(interaction, env));
        return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE });
      }
      if (interaction.data?.name === weeklyCommand.name) {
        ctx.waitUntil(handleWeekly(interaction, env, (content) => editOriginalResponse(interaction.application_id, interaction.token, content)));
        return jsonResponse({ type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: 64 } });
      }
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE && interaction.data?.name === weeklyCommand.name) {
      const choices = await autocompleteWeekly(interaction, env, ctx);
      return jsonResponse({ type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices } });
    }

    return new Response('Unknown interaction', { status: 400 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      syncAllGuilds(env).catch((err) => {
        console.error('weekly sync failed:', err);
      }),
    );
  },
};
