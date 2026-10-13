/**
 * Client-side twin of public.normalize_name() in Postgres. The database remains the source of
 * truth for deduplication; this is used for instant search and for hints in the UI.
 */
export function normalizeName(input: string): string {
  const s = input
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  if (!s) return '';
  return s.replace(/^(the|a|an) +(.+)$/, '$2').trim();
}

/** Extract an invite code from a pasted code or a full join link. */
export function parseInviteInput(raw: string): string {
  const t = raw.trim();
  const m = t.match(/\/join\/([a-z0-9]+)/i);
  return (m ? m[1] : t).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalise a free-text tag list ("Noir, rain  ,NOIR") → ["noir","rain"]. */
export function parseTags(raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(/[,\n#]+/)) {
    const t = piece.trim().toLowerCase().slice(0, 24);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 12);
}
