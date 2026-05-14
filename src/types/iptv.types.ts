export interface Channel {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
}

export interface ChannelGroup {
  name: string;
  channels: Channel[];
}

export interface PlaylistSource {
  id: string;
  name: string;
  url: string;
  addedAt: number;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
