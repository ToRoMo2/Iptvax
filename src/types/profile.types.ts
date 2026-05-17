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
  /** Ciné public (opt-in) : notes & critiques visibles par la communauté. */
  is_public: boolean;
  /** Discriminateur Discord-style (« 0042 ») unique par nom — null tant que
   *  le profil n'a jamais été rendu public. */
  discriminator: string | null;
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
