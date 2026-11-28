import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playerFlair } from './flair.ts';

test('no streak and no stars: no flair', () => {
  assert.equal(playerFlair(0, 0), null);
});

test('a streak and no stars keeps the plain streak flair', () => {
  assert.equal(playerFlair(3, 0)?.text, 'Pushover · 3-day streak');
});

test('the flair gets grander as the stars add up', () => {
  assert.equal(playerFlair(3, 1)?.text, '★ 1 · Pusher · 3-day streak');
  assert.equal(playerFlair(3, 10)?.text, '★★ 10 · Shover · 3-day streak');
  assert.equal(playerFlair(3, 25)?.text, '★★★ 25 · Knockout · 3-day streak');
  assert.equal(playerFlair(3, 50)?.text, '👑 50 · Slime Royalty · 3-day streak');
  assert.equal(playerFlair(0, 120)?.text, '👑★ 120 · Island Legend');
  const colours = new Set([1, 10, 25, 50, 100].map((s) => playerFlair(1, s)?.backgroundColor));
  assert.equal(colours.size, 5, 'each tier has its own colour');
});

test('even the longest flair fits in Reddit’s 64 characters', () => {
  assert.ok(playerFlair(9999, 9999)!.text.length <= 64);
});
