// Checks that Nightscout's profile write path keeps a Trio profile doc with the `trioSettings`
// attachment intact, and that the field can be queried. Dummy values only.
//
// Usage (against a cgm-remote-monitor checkout with its node_modules installed):
//   node docs/trio-settings-upload-ns-check.js /path/to/cgm-remote-monitor
'use strict';
const path = require('path');
const assert = require('assert');
const ns = path.resolve(process.argv[2] || '.');
const req = (p) => require(path.join(ns, p));

const purifyForStorage = req('lib/server/storage-purifier');
const ctx = { purifier: req('lib/server/purifier')() };
const query = req('lib/server/query');

// Build a doc shaped like Trio's upload: existing profile fields + trioSettings.
const rows = [];
for (let i = 0; i < 420; i++) {
  rows.push(`Algorithm,Autosens,"Setting ${i}, with comma",${i % 7 === 0 ? 'Ingeschakeld' : '0,' + i},${i % 3 ? 'U' : ''}`);
}
rows.push('Therapy,Targets,Target < 70 note,"say ""hi"" <b>x</b>",mg/dL'); // markup-like text on purpose
const prefs = {};
for (let i = 0; i < 90; i++) prefs[`pref_key_${i}`] = i % 2 ? 0.8 : true;
const settings = {};
for (let i = 0; i < 70; i++) settings[`settingKey${i}`] = i % 2 ? 'x' : 180;
const doc = {
  defaultProfile: 'default', startDate: '2026-10-17T10:00:00.000Z', mills: 1792231200000,
  units: 'mmol', enteredBy: 'Trio', store: { default: { dia: 10, basal: [{ time: '00:00', value: 0.5, timeAsSeconds: 0 }], sens: [], carbratio: [], target_low: [], target_high: [], units: 'mmol', timezone: 'Europe/Amsterdam', delay: 0, carbs_hr: 20 } },
  trioSettings: {
    schemaVersion: 1, exportedAt: '2026-10-17T10:00:00.000Z', appVersion: '0.0.0.0', build: '1',
    csv: 'Setting Category,Subcategory,Setting Name,Value,Unit\n' + rows.join('\n') + '\n',
    preferences: prefs, settings, pumpSettings: { insulin_action_curve: 10, maxBolus: 5, maxBasal: 2 },
  },
};

const before = JSON.parse(JSON.stringify(doc));
const bytes = Buffer.byteLength(JSON.stringify(doc, null, 2));
purifyForStorage(ctx, doc); // what profile.create()/save() run before insertMany/replaceOne
const diffs = [];
(function walk(a, b, p) {
  if (a && typeof a === 'object') Object.keys(a).forEach((k) => walk(a[k], b[k], p + '.' + k));
  else if (a !== b) diffs.push(p);
})(before, doc, '');
console.log(`doc size (pretty JSON): ${bytes} bytes (request body limit 1 MB)`);
console.log(`fields changed by purifier: ${diffs.length ? diffs.join(', ') : 'none'}`);
if (diffs.length) {
  console.log('  csv before:', JSON.stringify(before.trioSettings.csv.slice(-90)));
  console.log('  csv after :', JSON.stringify(doc.trioSettings.csv.slice(-90)));
}
assert.strictEqual(doc.trioSettings.preferences.pref_key_1, 0.8);

// Consumer query: newest profile that carries the attachment.
const opts = { count: 1, find: { trioSettings: { $exists: 'true' } } };
console.log('mongo filter for newest doc with settings:', JSON.stringify(query(opts, { walker: {}, dateField: 'startDate' })));
console.log('mongo filter for startDate cursor (watcher):', JSON.stringify(query({ count: 500, find: { startDate: { $gt: '2026-10-01T00:00:00Z' } } }, { walker: {}, dateField: 'startDate' })));
