import type { FoeKind } from '../shared/sim';

/** Each kind of foe in a name and one short line. */
export const KIND_INFO: Record<FoeKind, { name: string; line: string }> = {
  chaser: { name: 'Chaser', line: 'Charges at you.' },
  dodger: { name: 'Dodger', line: 'Keeps away from you and from the edge.' },
  mirror: { name: 'Mirror', line: 'Does the opposite of your move.' },
  sleeper: { name: 'Sleeper', line: 'Never moves.' },
  bomb: { name: 'Bomb', line: 'Never moves. Hit it and it blasts everyone near it away.' },
};
