import { ApplicationCommandOptionType, ChannelType } from '../types.js';

const MANAGE_GUILD = String(1 << 5);

export const weeklyCommand = {
  name: 'weekly',
  description: "Weekly iRacing track list for your series",
  default_member_permissions: MANAGE_GUILD,
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'add',
      description: 'Add a series to the weekly list',
      options: [{ type: ApplicationCommandOptionType.STRING, name: 'series', description: 'Series to track', required: true, autocomplete: true }],
    },
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'remove',
      description: 'Remove a series from the weekly list',
      options: [{ type: ApplicationCommandOptionType.STRING, name: 'series', description: 'Tracked series to remove', required: true, autocomplete: true }],
    },
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'channel',
      description: 'Choose where the weekly track list is posted',
      options: [
        {
          type: ApplicationCommandOptionType.CHANNEL,
          name: 'channel',
          description: 'Text channel for the weekly track list',
          required: true,
          channel_types: [ChannelType.GUILD_TEXT, ChannelType.GUILD_ANNOUNCEMENT],
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'refresh',
      description: 'Update the weekly post now',
    },
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'list',
      description: 'Show what is being tracked',
    },
    {
      type: ApplicationCommandOptionType.SUB_COMMAND,
      name: 'stop',
      description: 'Stop the weekly post for this server',
    },
  ],
};
