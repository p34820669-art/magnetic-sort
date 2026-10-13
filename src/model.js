export const CAPACITY = 4;

export function createState(tubes, locks = []) {
  const board = tubes.map(tube => [...tube]);
  const counts = new Map();
  for (const tube of board) {
    if (tube.length > CAPACITY) throw new Error('Container overflow');
    for (const color of tube) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  if ([...counts.values()].some(count => count !== CAPACITY)) {
    throw new Error('Each color must occur exactly four times');
  }
  if (!Array.isArray(locks) || (locks.length && locks.length !== board.length)) throw new Error('Locks must match containers');
  const closures = board.map((_, index) => locks[index] ?? null);
  for (const [index, color] of closures.entries()) {
    if (color !== null && (!counts.has(color) || board[index].includes(color))) {
      throw new Error('Lock needs a color outside its own container');
    }
  }
  return { tubes: board, locks: closures, cleared: [], moves: 0 };
}

export function cloneState(state) {
  return { tubes: state.tubes.map(tube => [...tube]), locks: [...state.locks], cleared: [...state.cleared], moves: state.moves };
}

// Arrays run bottom to top. The resolver has no renderer or platform dependency.
export function planMove(state, source) {
  if (state.locks[source]) return { valid: false, reason: 'locked', color: state.locks[source] };
  const selected = state.tubes[source];
  if (!selected?.length) return { valid: false, reason: 'empty' };
  const color = selected.at(-1);
  let destination = state.tubes.findIndex((tube, index) =>
    !state.locks[index] && tube.length > 0 && tube.length < CAPACITY && tube.every(item => item === color));
  if (destination < 0) destination = state.tubes.findIndex((tube, index) => !state.locks[index] && tube.length === 0);
  if (destination < 0) return { valid: false, reason: 'no-space', color };

  const next = cloneState(state);
  const transfers = [];
  const order = [source, ...state.tubes.map((_, index) => index).filter(index => index !== source)];
  for (const index of order) {
    if (index === destination || next.locks[index]) continue;
    const tube = next.tubes[index];
    while (tube.at(-1) === color && next.tubes[destination].length < CAPACITY) {
      transfers.push({ from: index, fromSlot: tube.length - 1,
        to: destination, toSlot: next.tubes[destination].length, color });
      next.tubes[destination].push(tube.pop());
    }
  }
  if (transfers.length === 0) return { valid: false, reason: 'covered', color };
  const dispatch = next.tubes[destination].length === CAPACITY;
  const unlocked = [];
  if (dispatch) {
    next.tubes[destination] = [];
    next.cleared.push(color);
    next.locks.forEach((key, index) => {
      if (key === color) { next.locks[index] = null; unlocked.push(index); }
    });
  }
  next.moves += 1;
  return { valid: true, color, destination, transfers, dispatch, unlocked, next };
}

export function legalMoves(state) {
  return state.tubes.map((_, index) => index).filter(index => planMove(state, index).valid);
}

export function status(state) {
  if (state.tubes.every(tube => tube.length === 0)) return 'won';
  return legalMoves(state).length ? 'playing' : 'stuck';
}

export class PuzzleSession {
  constructor(tubes, locks) {
    this.initial = createState(tubes, locks);
    this.state = cloneState(this.initial);
    this.history = [];
  }
  move(source) {
    const move = planMove(this.state, source);
    if (!move.valid) return move;
    this.history.push(cloneState(this.state));
    this.state = move.next;
    return move;
  }
  undo() {
    if (!this.history.length) return false;
    this.state = this.history.pop();
    return true;
  }
  restart() {
    this.state = cloneState(this.initial);
    this.history = [];
  }
}
