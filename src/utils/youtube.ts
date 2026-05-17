// Xtream renvoie `youtube_trailer` tantôt comme ID brut, tantôt comme URL
// complète (watch?v=, youtu.be/, /embed/). Normalise vers l'ID seul.
export function youtubeId(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  // Déjà un ID nu (11 caractères base64-url).
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
}
