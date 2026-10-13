export const ApplicationCommandOptionType = {
  SUB_COMMAND: 1,
  STRING: 3,
  INTEGER: 4,
  CHANNEL: 7,
} as const;

export interface PepTalkInput {
  name?: string;
  track?: string;
  series?: string;
  mood?: string;
  context?: string;
  statsSummary?: string;
}

export const ChannelType = {
  GUILD_TEXT: 0,
  GUILD_ANNOUNCEMENT: 5,
} as const;

export interface DiscordCommandOption {
  name: string;
  value?: string | number;
  focused?: boolean;
  options?: DiscordCommandOption[];
}

export interface DiscordInteraction {
  type: number;
  application_id: string;
  guild_id?: string;
  token: string;
  data?: {
    name: string;
    options?: DiscordCommandOption[];
  };
}
