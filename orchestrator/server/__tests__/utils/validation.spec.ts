import { describe, it, expect } from 'vitest';
import { WINDOW_NAME_RE } from '../../utils/validation';

describe('WINDOW_NAME_RE', () => {
  it.each([
    'main',
    'shell-1',
    'test_window',
    'MyWindow',
    'a',
    '123',
    'a-b_c',
  ])('matches valid name: %s', (name) => {
    expect(WINDOW_NAME_RE.test(name)).toBe(true);
  });

  it.each([
    '',
    'has space',
    'has.dot',
    'has/slash',
    'has:colon',
    'has@at',
    'über',
    'tab\ttab',
  ])('rejects invalid name: %s', (name) => {
    expect(WINDOW_NAME_RE.test(name)).toBe(false);
  });
});
