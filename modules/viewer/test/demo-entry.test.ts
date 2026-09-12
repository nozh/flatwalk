import { describe, expect, it, vi } from 'vitest';
import { mountDemoEntry } from '../src/demo-entry';

describe('mountDemoEntry', () => {
  it('sets src=fixture&demo=1 before opening the apartment', async () => {
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    window.history.replaceState(null, '', '/');
    const open = vi.fn(async () => {});
    mountDemoEntry(root, open);
    root.querySelector<HTMLButtonElement>('.demo-skip')?.click();
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe('?src=fixture&demo=1');
    expect(root.querySelector('.demo-note')?.textContent).toMatch(/not analyzed/i);
  });
});
