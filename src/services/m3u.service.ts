import type { Channel, ChannelGroup } from '../types/iptv.types';

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([\w-]+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

export function parseM3U(content: string): Channel[] {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  const channels: Channel[] = [];
  let pending: Partial<Channel> | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const attrs = parseAttributes(line);
      const name = line.split(',').pop()?.trim() ?? 'Unknown';
      pending = {
        id: crypto.randomUUID(),
        name,
        logo: attrs['tvg-logo'],
        group: attrs['group-title'],
        tvgId: attrs['tvg-id'],
      };
    } else if (pending && !line.startsWith('#')) {
      channels.push({ ...(pending as Channel), url: line });
      pending = null;
    }
  }

  return channels;
}

export function groupChannels(channels: Channel[]): ChannelGroup[] {
  const map = new Map<string, Channel[]>();

  for (const ch of channels) {
    const key = ch.group ?? 'Autres';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(ch);
  }

  return Array.from(map.entries()).map(([name, chs]) => ({ name, channels: chs }));
}

export async function fetchPlaylist(url: string): Promise<Channel[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Erreur HTTP ${res.status}`);
  const text = await res.text();
  return parseM3U(text);
}
