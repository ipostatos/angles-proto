import { describe, it, expect } from 'vitest';
import { diffStates } from './diff.js';

/**
 * diffStates(oldDb, newDb) compares two v2 catalog snapshots
 * ({ version, holds, angles }) matched by stable id and returns an ordered
 * list of change events shaped like change_log rows (minus username/created_at):
 *
 *   { action, entity, field, oldValue, newValue }
 *
 * Per-action column meaning:
 *   hold_added    entity=new name,  field=null,  old=null,     new=null
 *   hold_deleted  entity=old name,  field=null,  old=null,     new=null
 *   hold_renamed  entity=new name,  field='name',old=old name, new=new name
 *   angle_added   entity=hold name, field=saw,   old=null,     new=value
 *   angle_deleted entity=hold name, field=saw,   old=value,    new=null
 *   angle_changed entity=hold name, field='value', old=old val, new=new val
 *   angle_changed entity=hold name, field='saw',   old=old saw, new=new saw
 *
 * Numeric values are serialized with String().
 */

const hold = (id, name, extra = {}) => ({ id, name, ...extra });
const angle = (id, holdId, value, saw, extra = {}) => ({ id, holdId, value, saw, ...extra });

const db = (holds, angles) => ({ version: 2, holds, angles });

describe('diffStates', () => {
    it('returns [] when nothing changed', () => {
        const holds = [hold('h1', 'Austin')];
        const angles = [angle('a1', 'h1', 28.2, 'main')];
        const before = db(holds, angles);
        const after = db([hold('h1', 'Austin')], [angle('a1', 'h1', 28.2, 'main')]);
        expect(diffStates(before, after)).toEqual([]);
    });

    it('detects hold_added', () => {
        const before = db([hold('h1', 'Austin')], []);
        const after = db([hold('h1', 'Austin'), hold('h2', 'Avalon')], []);
        expect(diffStates(before, after)).toEqual([
            { action: 'hold_added', entity: 'Avalon', field: null, oldValue: null, newValue: null },
        ]);
    });

    it('detects hold_deleted', () => {
        const before = db([hold('h1', 'Austin'), hold('h2', 'Avalon')], []);
        const after = db([hold('h1', 'Austin')], []);
        expect(diffStates(before, after)).toEqual([
            { action: 'hold_deleted', entity: 'Avalon', field: null, oldValue: null, newValue: null },
        ]);
    });

    it('detects hold_renamed (same id, different name)', () => {
        const before = db([hold('h1', 'Austin')], []);
        const after = db([hold('h1', 'Boston')], []);
        expect(diffStates(before, after)).toEqual([
            { action: 'hold_renamed', entity: 'Boston', field: 'name', oldValue: 'Austin', newValue: 'Boston' },
        ]);
    });

    it('detects angle_added (entity=hold name, field=saw, new=value)', () => {
        const holds = [hold('h1', 'Austin')];
        const before = db(holds, []);
        const after = db(holds, [angle('a1', 'h1', 28.2, 'main')]);
        expect(diffStates(before, after)).toEqual([
            { action: 'angle_added', entity: 'Austin', field: 'main', oldValue: null, newValue: '28.2' },
        ]);
    });

    it('detects angle_deleted (entity resolved from old snapshot)', () => {
        const holds = [hold('h1', 'Austin')];
        const before = db(holds, [angle('a1', 'h1', 28.2, 'main')]);
        const after = db(holds, []);
        expect(diffStates(before, after)).toEqual([
            { action: 'angle_deleted', entity: 'Austin', field: 'main', oldValue: '28.2', newValue: null },
        ]);
    });

    it('detects angle_changed for value', () => {
        const holds = [hold('h1', 'Austin')];
        const before = db(holds, [angle('a1', 'h1', 28.2, 'main')]);
        const after = db(holds, [angle('a1', 'h1', 30, 'main')]);
        expect(diffStates(before, after)).toEqual([
            { action: 'angle_changed', entity: 'Austin', field: 'value', oldValue: '28.2', newValue: '30' },
        ]);
    });

    it('detects angle_changed for saw', () => {
        const holds = [hold('h1', 'Austin')];
        const before = db(holds, [angle('a1', 'h1', 28.2, 'main')]);
        const after = db(holds, [angle('a1', 'h1', 28.2, 'stefan')]);
        expect(diffStates(before, after)).toEqual([
            { action: 'angle_changed', entity: 'Austin', field: 'saw', oldValue: 'main', newValue: 'stefan' },
        ]);
    });

    it('emits two events when both value and saw change on one angle', () => {
        const holds = [hold('h1', 'Austin')];
        const before = db(holds, [angle('a1', 'h1', 28.2, 'main')]);
        const after = db(holds, [angle('a1', 'h1', 30, 'stefan')]);
        const events = diffStates(before, after);
        expect(events).toContainEqual(
            { action: 'angle_changed', entity: 'Austin', field: 'value', oldValue: '28.2', newValue: '30' },
        );
        expect(events).toContainEqual(
            { action: 'angle_changed', entity: 'Austin', field: 'saw', oldValue: 'main', newValue: 'stefan' },
        );
        expect(events).toHaveLength(2);
    });

    it('does NOT log image-only changes (drawing / coverImage)', () => {
        const before = db(
            [hold('h1', 'Austin')],
            [angle('a1', 'h1', 28.2, 'main')],
        );
        const after = db(
            [hold('h1', 'Austin', { coverImage: 'data:image/png;base64,xxx' })],
            [angle('a1', 'h1', 28.2, 'main', { drawing: 'data:image/png;base64,yyy' })],
        );
        expect(diffStates(before, after)).toEqual([]);
    });

    it('handles null / empty inputs without throwing', () => {
        expect(diffStates(null, null)).toEqual([]);
        expect(diffStates({}, {})).toEqual([]);
        expect(diffStates(db([], []), db([], []))).toEqual([]);
    });
});
