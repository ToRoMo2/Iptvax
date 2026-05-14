import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import type { Channel } from '../types/iptv.types';
import { safeImgUrl } from '../utils/image';
import styles from './ChannelCard.module.css';

interface Props {
  channel: Channel;
  isFavorite?: boolean;
  onSelect: (channel: Channel) => void;
  onFavorite?: (channel: Channel) => void;
  focusKey?: string;
}

export function ChannelCard({ channel, isFavorite, onSelect, onFavorite, focusKey }: Props) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: () => onSelect(channel),
  });

  return (
    <div
      ref={ref}
      className={`${styles.card} ${focused ? styles.focused : ''}`}
      onClick={() => onSelect(channel)}
    >
      {safeImgUrl(channel.logo) ? (
        <img src={safeImgUrl(channel.logo)} alt={channel.name} className={styles.logo} />
      ) : (
        <div className={styles.placeholder}>
          {channel.name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className={styles.name}>{channel.name}</span>
      {onFavorite && (
        <button
          className={`${styles.favBtn} ${isFavorite ? styles.favActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onFavorite(channel); }}
          aria-label="Favori"
        >
          ★
        </button>
      )}
    </div>
  );
}
