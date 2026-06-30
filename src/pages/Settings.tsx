import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useI18n } from '../contexts/I18nContext';
import { LOCALE_NAMES, type Locale, type TranslationKey } from '../i18n';
import {
  type SubSize, type SubBg, type SubColor,
  loadSubPrefs, saveSubPrefs,
  PREVIEW_PX, CHIP_PX, SUB_COLOR_HEX, SUB_BG_CSS, SUB_OUTLINE, SUB_SOFT_SHADOW,
} from '../utils/subtitlePrefs';
import { TmdbAttribution } from '../components/TmdbAttribution';
import { PREMIUM_ENABLED } from '../config/monetization';
import styles from './Settings.module.css';

type Tab = 'account' | 'playback' | 'about';

// ── Toggle switch component ────────────────────────────────────────────────────
function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.toggle}>
      <input
        id={id}
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleTrack} />
      <span className={styles.toggleThumb} />
    </label>
  );
}

// ── Row components ────────────────────────────────────────────────────────────
function InfoRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${muted ? styles.rowValueMuted : ''}`}>{value}</span>
    </div>
  );
}

function ToggleRow({ label, description, id, checked, onChange }: {
  label: string;
  description?: string;
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      <Toggle id={id} checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconUser() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
}
function IconPlay() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
}
function IconInfo() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>;
}
function IconLogout() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
}

const TABS: { id: Tab; labelKey: TranslationKey; Icon: () => JSX.Element }[] = [
  { id: 'account',  labelKey: 'settings.tabAccount',  Icon: IconUser },
  { id: 'playback', labelKey: 'settings.tabPlayback', Icon: IconPlay },
  { id: 'about',    labelKey: 'settings.tabAbout',    Icon: IconInfo },
];

export function Settings() {
  const { userInfo, credentials } = useXtream();
  const { activeProfile, clearActiveProfile, setProfilePublic } =
    useIptvProfile();
  const { isPremium, subscription } = useSubscription();
  const { t, locale, locales, setLocale, fmtDate } = useI18n();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('account');
  const [publicBusy, setPublicBusy] = useState(false);

  const planLabel =
    subscription.plan === 'yearly'
      ? t('premium.planYearly')
      : subscription.plan === 'monthly'
        ? t('premium.planMonthly')
        : null;
  const renewDate = subscription.currentPeriodEnd
    ? fmtDate(subscription.currentPeriodEnd)
    : null;

  const handleTogglePublic = async (next: boolean) => {
    if (!activeProfile || publicBusy) return;
    setPublicBusy(true);
    try {
      await setProfilePublic(activeProfile.id, next);
    } catch {
      // L'état dérive de activeProfile : pas de maj en cas d'échec → no-op.
    } finally {
      setPublicBusy(false);
    }
  };

  // Playback settings (stored in state — could persist to localStorage)
  const [autoPlay, setAutoPlay]     = useState(true);
  const [hwDecode, setHwDecode]     = useState(true);
  const [remembPos, setRemembPos]   = useState(true);

  // Préférences de sous-titres par défaut (partagées avec le lecteur via la même
  // clé localStorage — voir src/utils/subtitlePrefs.ts). Réglées ici, elles
  // deviennent le style par défaut à l'ouverture du lecteur.
  const [subPrefs] = useState(loadSubPrefs);
  const [subSize, setSubSize]   = useState<SubSize>(subPrefs.size);
  const [subColor, setSubColor] = useState<SubColor>(subPrefs.color);
  const [subBg, setSubBg]       = useState<SubBg>(subPrefs.bg);
  useEffect(() => {
    saveSubPrefs({ size: subSize, color: subColor, bg: subBg });
  }, [subSize, subColor, subBg]);

  // Expiry
  const expiryDate = userInfo?.exp_date
    ? fmtDate(parseInt(userInfo.exp_date) * 1000)
    : null;

  const isExpired = userInfo?.status === 'Expired';

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        {/* ── Header ── */}
        <header className={styles.header}>
          <h1 className={styles.title}>{t('settings.title')}</h1>
          <p className={styles.sub}>{t('settings.subtitle')}</p>
        </header>

        {/* ── Tab bar ── */}
        <div className={styles.tabs}>
          {TABS.map(({ id, labelKey, Icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className={styles.content}>

          {/* ── Account tab ── */}
          {tab === 'account' && (
            <>
              <div className={styles.col}>
              {PREMIUM_ENABLED ? (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.subscription')}</div>
                <div className={styles.row}>
                  <span className={styles.rowLabel}>{t('settings.plan')}</span>
                  <span
                    className={`${styles.badge} ${
                      isPremium ? styles.badgeActive : styles.badgeExpired
                    }`}
                  >
                    <span className={styles.badgePulse} />
                    {isPremium ? t('common.premium') : t('common.free')}
                  </span>
                </div>
                {isPremium && planLabel && <InfoRow label={t('settings.type')} value={planLabel} />}
                {isPremium && renewDate && (
                  <InfoRow
                    label={subscription.cancelAtPeriodEnd ? t('settings.end') : t('settings.renewal')}
                    value={renewDate}
                  />
                )}
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowLabel}>
                      {isPremium ? t('settings.manageSub') : t('settings.goPremiumTitle')}
                    </div>
                    <div className={styles.rowDesc}>
                      {isPremium
                        ? t('settings.manageDesc')
                        : t('settings.goPremiumDesc')}
                    </div>
                  </div>
                  <button
                    className={styles.premiumBtn}
                    onClick={() => navigate('/premium')}
                  >
                    {isPremium ? t('settings.manage') : t('common.goPremium')}
                  </button>
                </div>
              </section>
              ) : (
              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.subscription')}</div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowLabel}>Toutes les fonctionnalités sont incluses</div>
                    <div className={styles.rowDesc}>
                      Umbra est gratuit : profils, sync, Mon ciné, Communauté et
                      téléchargements sont accessibles sans abonnement.
                    </div>
                  </div>
                </div>
              </section>
              )}

              {userInfo && (
                <section className={styles.section}>
                  <div className={styles.sectionLabel}>{t('settings.accountInfo')}</div>
                  <InfoRow label={t('settings.user')} value={userInfo.username} />
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>{t('settings.status')}</span>
                    <span className={`${styles.badge} ${isExpired ? styles.badgeExpired : styles.badgeActive}`}>
                      <span className={styles.badgePulse} />
                      {isExpired ? t('settings.expired') : t('settings.active')}
                    </span>
                  </div>
                  {expiryDate && <InfoRow label={t('settings.expiration')} value={expiryDate} />}
                  <InfoRow label={t('settings.maxConnections')} value={userInfo.max_connections} />
                  <InfoRow label={t('settings.activeConnections')} value={userInfo.active_cons} />
                </section>
              )}
              </div>

              <div className={styles.col}>
              {credentials && (
                <section className={styles.section}>
                  <div className={styles.sectionLabel}>{t('settings.server')}</div>
                  <InfoRow label={t('settings.url')} value={credentials.serverUrl} />
                  <InfoRow label={t('settings.login')} value={credentials.username} />
                  <InfoRow label={t('settings.protocol')} value={credentials.serverUrl.startsWith('https') ? t('settings.protocolHttps') : t('settings.protocolHttp')} muted />
                </section>
              )}

              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.profile')}</div>
                {activeProfile && <InfoRow label={t('settings.activeProfile')} value={`${activeProfile.avatar}  ${activeProfile.name}`} />}
                {activeProfile && isPremium && (
                  <ToggleRow
                    id="public-cine"
                    label={t('settings.makePublic')}
                    description={t('settings.makePublicDesc')}
                    checked={activeProfile.is_public}
                    onChange={handleTogglePublic}
                  />
                )}
                {activeProfile && !isPremium && (
                  <div className={styles.row}>
                    <div className={styles.rowText}>
                      <div className={styles.rowLabel}>{t('settings.makePublicLocked')}</div>
                      <div className={styles.rowDesc}>
                        {t('settings.communityPremiumOnly')}
                      </div>
                    </div>
                    <button
                      className={styles.premiumBtn}
                      onClick={() => navigate('/premium')}
                    >
                      {t('common.goPremium')}
                    </button>
                  </div>
                )}
                {activeProfile?.is_public && activeProfile.discriminator && (
                  <InfoRow
                    label={t('settings.publicId')}
                    value={`${activeProfile.name}#${activeProfile.discriminator}`}
                  />
                )}
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowLabel}>{t('settings.changeProfile')}</div>
                    <div className={styles.rowDesc}>{t('settings.changeProfileDesc')}</div>
                  </div>
                  <button className={styles.logoutBtn} onClick={clearActiveProfile}>
                    <IconLogout />
                    {t('settings.changeProfile')}
                  </button>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.languageSection')}</div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowLabel}>{t('settings.language')}</div>
                    <div className={styles.rowDesc}>{t('settings.languageDesc')}</div>
                  </div>
                  <select
                    className={styles.selectBtn}
                    value={locale}
                    onChange={(e) => setLocale(e.target.value as Locale)}
                    aria-label={t('settings.language')}
                  >
                    {locales.map((l) => (
                      <option key={l} value={l}>{LOCALE_NAMES[l]}</option>
                    ))}
                  </select>
                </div>
              </section>
              </div>
            </>
          )}

          {/* ── Playback tab ── */}
          {tab === 'playback' && (
            <>
              <div className={styles.col}>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.autoplaySection')}</div>
                <ToggleRow
                  id="autoplay"
                  label={t('settings.autoplay')}
                  description={t('settings.autoplayDesc')}
                  checked={autoPlay}
                  onChange={setAutoPlay}
                />
                <ToggleRow
                  id="remembpos"
                  label={t('settings.rememberPos')}
                  description={t('settings.rememberPosDesc')}
                  checked={remembPos}
                  onChange={setRemembPos}
                />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.performance')}</div>
                <ToggleRow
                  id="hwdecode"
                  label={t('settings.hwDecode')}
                  description={t('settings.hwDecodeDesc')}
                  checked={hwDecode}
                  onChange={setHwDecode}
                />
              </section>
              </div>

              <div className={styles.col}>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.subtitlesSection')}</div>
                <div className={styles.subDesc}>{t('settings.subtitlesDesc')}</div>

                {/* Aperçu live des sous-titres avec les réglages courants */}
                <div className={styles.subPreview}>
                  <span
                    style={{
                      fontSize: PREVIEW_PX[subSize],
                      color: SUB_COLOR_HEX[subColor],
                      background: SUB_BG_CSS[subBg],
                      textShadow: subBg === 'none' ? SUB_OUTLINE : SUB_SOFT_SHADOW,
                      padding: subBg === 'none' ? '0 6px' : '4px 14px',
                      borderRadius: 'var(--r-ui)',
                      fontWeight: 700,
                      letterSpacing: '-0.005em',
                      lineHeight: 1.3,
                      textAlign: 'center',
                    }}
                  >
                    {t('settings.subPreviewText')}
                  </span>
                </div>

                {/* Taille */}
                <div className={styles.subRow}>
                  <span className={styles.rowLabel}>{t('settings.subSize')}</span>
                  <div className={styles.subChips}>
                    {(['sm', 'md', 'lg', 'xl'] as SubSize[]).map((sz) => (
                      <button
                        key={sz}
                        className={`${styles.subChip} ${subSize === sz ? styles.subChipActive : ''}`}
                        onClick={() => setSubSize(sz)}
                        title={sz.toUpperCase()}
                      >
                        <span style={{ fontSize: CHIP_PX[sz] }}>Aa</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Couleur */}
                <div className={styles.subRow}>
                  <span className={styles.rowLabel}>{t('settings.subColor')}</span>
                  <div className={styles.subChips}>
                    {(['white', 'yellow', 'cyan', 'green'] as SubColor[]).map((c) => (
                      <button
                        key={c}
                        className={`${styles.subChip} ${subColor === c ? styles.subChipActive : ''}`}
                        onClick={() => setSubColor(c)}
                      >
                        <span style={{ color: SUB_COLOR_HEX[c], textShadow: SUB_OUTLINE, fontSize: 17 }}>Aa</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fond */}
                <div className={styles.subRow}>
                  <span className={styles.rowLabel}>{t('settings.subBackground')}</span>
                  <div className={styles.subChips}>
                    {(['none', 'semi', 'solid'] as SubBg[]).map((b) => (
                      <button
                        key={b}
                        className={`${styles.subChip} ${subBg === b ? styles.subChipActive : ''}`}
                        onClick={() => setSubBg(b)}
                      >
                        <span
                          style={{
                            background: SUB_BG_CSS[b],
                            color: '#fff',
                            padding: '2px 8px',
                            borderRadius: 'var(--r-ui)',
                            fontSize: 15,
                            textShadow: b === 'none' ? SUB_OUTLINE : SUB_SOFT_SHADOW,
                          }}
                        >Aa</span>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.streamFormat')}</div>
                <InfoRow label={t('settings.liveTv')} value={t('settings.liveTvVal')} muted />
                <InfoRow label={t('settings.moviesLabel')} value={t('settings.moviesVal')} muted />
                <InfoRow label={t('settings.seriesLabel')} value={t('settings.seriesVal')} muted />
              </section>
              </div>
            </>
          )}

          {/* ── About tab ── */}
          {tab === 'about' && (
            <>
              <div className={styles.col}>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Iptvax</div>
                <InfoRow label={t('settings.version')} value="2.4.0" />
                <InfoRow label={t('settings.build')} value="2026.05" muted />
                <InfoRow label={t('settings.framework')} value="React 18 · Vite · TypeScript" muted />
                <InfoRow label={t('settings.videoRender')} value="HLS.js · Video.js" muted />
              </section>
              </div>

              <div className={styles.col}>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>{t('settings.features')}</div>
                <InfoRow label={t('settings.liveTv')} value={t('settings.supported')} />
                <InfoRow label={t('settings.moviesVod')} value={t('settings.supported')} />
                <InfoRow label={t('settings.seriesLabel')} value={t('settings.supported')} />
                <InfoRow label={t('settings.favorites')} value={t('settings.supported')} />
                <InfoRow label={t('settings.globalSearch')} value={t('settings.supported')} />
                <InfoRow label={t('settings.playHistory')} value={t('settings.supported')} />
                <InfoRow label={t('settings.fourK')} value={t('settings.perServer')} muted />
              </section>

              <div className={styles.versionChip}>
                <span>Iptvax</span>
                <span className={styles.versionDot} />
                <span>v2.4.0</span>
                <span className={styles.versionDot} />
                <span>{t('settings.tlsSecure')}</span>
              </div>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>Crédits</div>
                <TmdbAttribution />
              </section>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
