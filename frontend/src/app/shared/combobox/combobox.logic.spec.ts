import { describe, expect, it } from 'vitest';
import { canCreateOption } from './combobox.logic';

describe('canCreateOption', () => {
  it('offers a name with no matches', () => {
    expect(canCreateOption('Faber', [])).toBe(true);
  });

  it('offers a name that is only similar to an existing one', () => {
    expect(canCreateOption('Fa', ['Faber'])).toBe(true);
  });

  it('offers a name that is contained in several existing ones', () => {
    expect(canCreateOption('Fa', ['Faber', 'Fanta 4'])).toBe(true);
  });

  it('hides an identical name', () => {
    expect(canCreateOption('Faber', ['Faber'])).toBe(false);
  });

  it('hides an identical name among similar ones', () => {
    expect(canCreateOption('Fa', ['Fa', 'Faber'])).toBe(false);
  });

  it('ignores case', () => {
    expect(canCreateOption('fABER', ['Faber'])).toBe(false);
  });

  it('ignores surrounding whitespace', () => {
    expect(canCreateOption('  Faber ', ['Faber'])).toBe(false);
  });

  it('does not offer a blank query', () => {
    expect(canCreateOption('', [])).toBe(false);
    expect(canCreateOption('   ', [])).toBe(false);
  });
});
