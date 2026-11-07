import assert from 'node:assert/strict';
import {sleepEditError, pastSleepReadOnly, futureSleepReadOnly} from '../modules/wellness/sleep_edit_window';

const wednesday = new Date('2026-10-28T09:00:00Z');
assert.equal(sleepEditError('2026-10-26', 330, wednesday), null);
assert.equal(sleepEditError('2026-10-28', 330, wednesday), null);
assert.equal(sleepEditError('2026-10-25', 330, wednesday), pastSleepReadOnly);
assert.equal(sleepEditError('2026-10-29', 330, wednesday), futureSleepReadOnly);
// The same instant is Monday in India and Sunday west of UTC.
const boundary = new Date('2026-10-25T22:30:00Z');
assert.equal(sleepEditError('2026-10-25', 330, boundary), pastSleepReadOnly);
assert.equal(sleepEditError('2026-10-25', -420, boundary), null);
assert.equal(sleepEditError('2026-10-26', -420, boundary), futureSleepReadOnly);
assert.equal(sleepEditError('2026-10-26', 330, boundary), null);
// A week crossing both a month and year still starts on Monday.
const january = new Date('2027-01-01T12:00:00Z');
assert.equal(sleepEditError('2026-12-28', 60, january), null);
assert.equal(sleepEditError('2026-12-27', 60, january), pastSleepReadOnly);
assert.equal(sleepEditError('2027-01-02', 60, january), futureSleepReadOnly);
console.log('Sleep edit window passed: current week, past/future, timezone boundaries and year rollover.');
