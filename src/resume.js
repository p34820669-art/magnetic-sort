import { PuzzleSession } from './model.js?v=0.17.0';

const STORAGE_KEY = 'magnetic-sort-run-v1';
const MAX_ACTIONS = 1000;
const layoutKey = level => JSON.stringify([level.tubes, level.locks ?? []]);

// Replaying validated inputs reconstructs both the board and its undo history.
export function loadRun(levels, storage) {
  try {
    const data = JSON.parse((storage ?? localStorage).getItem(STORAGE_KEY) || 'null');
    if (data?.version !== 1 || !Array.isArray(data.actions) || data.actions.length > MAX_ACTIONS) return null;
    const index = levels.findIndex(level => level.lesson === data.level);
    if (index < 0 || layoutKey(levels[index]) !== data.layout) return null;
    const level = levels[index], session = new PuzzleSession(level.tubes, level.locks);
    for (const source of data.actions) {
      if (!Number.isInteger(source) || source < 0 || source >= level.tubes.length || !session.move(source).valid) return null;
    }
    return { index, session, actions: [...data.actions] };
  } catch { return null; }
}

export function saveRun(level, actions, storage) {
  if (!Array.isArray(actions) || actions.length > MAX_ACTIONS ||
      actions.some(source => !Number.isInteger(source) || source < 0 || source >= level.tubes.length)) return false;
  try {
    (storage ?? localStorage).setItem(STORAGE_KEY, JSON.stringify({ version: 1,
      level: level.lesson, layout: layoutKey(level), actions }));
    return true;
  } catch { return false; }
}
