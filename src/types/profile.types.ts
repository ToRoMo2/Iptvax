export type ProfileColor =
  | 'profile-1'
  | 'profile-2'
  | 'profile-3'
  | 'profile-4'
  | 'profile-5'
  | 'profile-6';

export interface IptvProfile {
  id: string;
  user_id: string;
  name: string;
  avatar: string;
  color: ProfileColor;
  xtream_server_url: string;
  xtream_username: string;
  xtream_password: string;
  created_at: string;
}

export interface IptvProfileInput {
  name: string;
  avatar: string;
  color: ProfileColor;
  xtream_server_url: string;
  xtream_username: string;
  xtream_password: string;
}

export const PROFILE_COLORS: ProfileColor[] = [
  'profile-1',
  'profile-2',
  'profile-3',
  'profile-4',
  'profile-5',
  'profile-6',
];

export const PROFILE_AVATARS = [
  '🎬', '🍿', '📺', '🎮', '⚽', '🎵',
  '🦊', '🐱', '🚀', '🌙', '🔥', '🌈',
  '👑', '🎨', '🦁', '🐼',
];
