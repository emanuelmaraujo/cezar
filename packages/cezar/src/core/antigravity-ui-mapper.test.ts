import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAntigravityUiState, mapAntigravityMessage } from './antigravity-ui-mapper.ts';
import type { AgentEvent } from './agent-runner.ts';
import type { UiEvent } from './ui-events.ts';

// Derived from https://antigravity.google/docs/cli/headless/ (2026-10-14).
// ERROR/TitleCase parameters are also observed in the previous agy 1.3.3 captures.
// Subagent frame is doc-derived, not a claim of a live capture.
describe('Antigravity stream mapping', () => {
  it('replays the golden stream with immutable state and no duplicate result text', () => {
    let state = createAntigravityUiState();
    const events: UiEvent[] = [], v1: AgentEvent[] = [];
    const wire = readFileSync(new URL('./__fixtures__/antigravity/stream.ndjson', import.meta.url), 'utf8');
    for (const line of wire.trim().split('\n')) {
      const previous = state;
      const before = JSON.stringify([...state.items]);
      const mapped = mapAntigravityMessage(JSON.parse(line), state);
      state = mapped.state; events.push(...mapped.events); v1.push(...mapped.agentEvents);
      expect(JSON.stringify([...previous.items])).toBe(before);
    }
    const expected = JSON.parse(readFileSync(new URL('./__fixtures__/antigravity/stream.expected.json', import.meta.url), 'utf8'));
    expect(JSON.parse(JSON.stringify(events))).toStrictEqual(expected);
    expect(v1.filter(e => e.type === 'text').map(e => e.text).join('')).toBe('Hello\n');
  });
  it('ignores malformed and unknown frames', () => {
    const state = createAntigravityUiState();
    for (const value of [null, [], 'noise', 7, { event: 'unknown' }, { event: { toString: null } }]) {
      expect(mapAntigravityMessage(value, state)).toEqual({ state, events: [], agentEvents: [] });
    }
  });
  it('keeps unknown tool names as text even when they match object prototype keys', () => {
    const mapped = mapAntigravityMessage({ event: 'step_update', step_update: {
      step_index: 1, step_type: 'tool', state: 'DONE', tool_name: '__proto__',
    } }, createAntigravityUiState());
    expect(mapped.agentEvents).toContainEqual({ type: 'tool-call', id: 'step_1', tool: '__proto__', input: {} });
  });
  it('closes unfinished tools in both protocols on a failed turn', () => {
    const opened = mapAntigravityMessage({ event: 'step_update', step_update: { step_type: 'tool', state: 'ACTIVE', step_index: 1, tool_name: 'run_command' } }, createAntigravityUiState());
    const ended = mapAntigravityMessage({ event: 'result', result: { status: 'ERROR', error: 'denied' } }, opened.state);
    expect(ended.events).toContainEqual(expect.objectContaining({ type: 'item.completed', item: expect.objectContaining({ status: 'failed' }) }));
    expect(ended.agentEvents).toContainEqual(expect.objectContaining({ type: 'tool-result', isError: true }));
    expect(ended.agentEvents).toContainEqual({ type: 'error', message: 'denied' });
    expect(ended.events).toContainEqual({ type: 'session.error', message: 'denied', fatal: true });
  });
});
