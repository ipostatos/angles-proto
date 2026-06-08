// Pure diff between two v2 catalog snapshots, used server-side to derive the
// change_log audit trail on save. No I/O, no side effects.

/**
 * @typedef {Object} ChangeEvent
 * @property {('hold_added'|'hold_renamed'|'hold_deleted'|'angle_added'|'angle_changed'|'angle_deleted')} action
 * @property {string|null} entity      Human-readable hold name.
 * @property {string|null} field       'name' | 'value' | 'saw' | saw value (for angle add/delete) | null.
 * @property {string|null} oldValue
 * @property {string|null} newValue
 */

function asArray(x) {
    return Array.isArray(x) ? x : [];
}

/**
 * Compare two v2 catalog snapshots ({ version, holds, angles }) matched by
 * stable id and return an ordered list of change events shaped like change_log
 * rows (minus username/created_at).
 *
 * Per-action column meaning:
 *   hold_added    entity=new name,  field=null,    old=null,     new=null
 *   hold_deleted  entity=old name,  field=null,    old=null,     new=null
 *   hold_renamed  entity=new name,  field='name',  old=old name, new=new name
 *   angle_added   entity=hold name, field=saw,     old=null,     new=value
 *   angle_deleted entity=hold name, field=saw,     old=value,    new=null
 *   angle_changed entity=hold name, field='value', old=old val,  new=new val
 *   angle_changed entity=hold name, field='saw',   old=old saw,  new=new saw
 *
 * Image fields (hold.coverImage, angle.drawing) are intentionally ignored.
 *
 * @param {{holds?: Array, angles?: Array}|null|undefined} oldDb
 * @param {{holds?: Array, angles?: Array}|null|undefined} newDb
 * @returns {ChangeEvent[]}
 */
export function diffStates(oldDb, newDb) {
    const oldHolds = asArray(oldDb?.holds);
    const newHolds = asArray(newDb?.holds);
    const oldAngles = asArray(oldDb?.angles);
    const newAngles = asArray(newDb?.angles);

    const oldHoldById = new Map(oldHolds.map((h) => [h.id, h]));
    const newHoldById = new Map(newHolds.map((h) => [h.id, h]));
    const nameNew = (id) => newHoldById.get(id)?.name ?? oldHoldById.get(id)?.name ?? null;
    const nameOld = (id) => oldHoldById.get(id)?.name ?? newHoldById.get(id)?.name ?? null;

    const events = [];

    // Holds: added + renamed (iterate new for stable ordering)
    for (const h of newHolds) {
        const prev = oldHoldById.get(h.id);
        if (!prev) {
            events.push({ action: 'hold_added', entity: h.name, field: null, oldValue: null, newValue: null });
        } else if (prev.name !== h.name) {
            events.push({ action: 'hold_renamed', entity: h.name, field: 'name', oldValue: prev.name, newValue: h.name });
        }
    }
    // Holds: deleted
    for (const h of oldHolds) {
        if (!newHoldById.has(h.id)) {
            events.push({ action: 'hold_deleted', entity: h.name, field: null, oldValue: null, newValue: null });
        }
    }

    const oldAngleById = new Map(oldAngles.map((a) => [a.id, a]));
    const newAngleById = new Map(newAngles.map((a) => [a.id, a]));

    // Angles: added + changed (iterate new)
    for (const a of newAngles) {
        const prev = oldAngleById.get(a.id);
        if (!prev) {
            events.push({ action: 'angle_added', entity: nameNew(a.holdId), field: a.saw, oldValue: null, newValue: String(a.value) });
            continue;
        }
        if (Number(prev.value) !== Number(a.value)) {
            events.push({ action: 'angle_changed', entity: nameNew(a.holdId), field: 'value', oldValue: String(prev.value), newValue: String(a.value) });
        }
        if (prev.saw !== a.saw) {
            events.push({ action: 'angle_changed', entity: nameNew(a.holdId), field: 'saw', oldValue: prev.saw, newValue: a.saw });
        }
    }
    // Angles: deleted
    for (const a of oldAngles) {
        if (!newAngleById.has(a.id)) {
            events.push({ action: 'angle_deleted', entity: nameOld(a.holdId), field: a.saw, oldValue: String(a.value), newValue: null });
        }
    }

    return events;
}
