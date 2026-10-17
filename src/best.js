const STORAGE_KEY = 'magnetic-sort-best-v1';

export function loadBest(storage) {
  try {
    const data = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) || 'null');
    if (data?.version !== 1 || !data.scores || typeof data.scores !== 'object' || Array.isArray(data.scores)) return {};
    return Object.fromEntries(Object.entries(data.scores).filter(([level, moves]) =>
      /^[a-z][a-z-]*$/.test(level) && Number.isSafeInteger(moves) && moves > 0 && moves < 1000));
  } catch { return {}; }
}

export function rememberBest(scores, level, moves, storage) {
  if (!/^[a-z][a-z-]*$/.test(level) || !Number.isSafeInteger(moves) || moves < 1) {
    return { scores, improved: false };
  }
  if (scores[level] !== undefined && scores[level] <= moves) return { scores, improved: false };
  const next = { ...scores, [level]: moves };
  try { (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify({ version: 1, scores: next })); }
  catch { /* The session still remembers the result when storage is unavailable. */ }
  return { scores: next, improved: true };
}
