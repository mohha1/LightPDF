import { describe, expect, it } from 'vitest';
import { History } from '../src/editor/history';

describe('History', () => {
  it('undoes and redoes', () => {
    const history = new History('a');
    history.push('b');
    history.push('c');
    expect(history.undo()).toBe(true);
    expect(history.present).toBe('b');
    expect(history.redo()).toBe(true);
    expect(history.present).toBe('c');
    expect(history.redo()).toBe(false);
  });

  it('drops the redo stack on a new change and ignores no-ops', () => {
    const history = new History('a');
    history.push('b');
    history.undo();
    history.push('c');
    expect(history.canRedo).toBe(false);
    expect(history.push('c')).toBe(false);
    expect(history.undo()).toBe(true);
    expect(history.present).toBe('a');
  });

  it('keeps at most `limit` undo steps', () => {
    const history = new History(0, 3);
    for (let i = 1; i <= 5; i++) history.push(i);
    let undos = 0;
    while (history.undo()) undos++;
    expect(undos).toBe(3);
    expect(history.present).toBe(2);
  });
});
