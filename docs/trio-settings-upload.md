# Trio settings in the Nightscout profile document

This fork's build carries `patches/0002-trio-settings-upload.patch`. It adds one optional field,
`trioSettings`, to the profile document Trio already uploads (`POST /api/v1/profile.json`,
unchanged endpoint, auth and existing fields). It exists so `dynisf-tuner` and the watcher can read the
full Trio configuration (everything in Settings -> Export) from Nightscout.

This document is the contract. Bump `schemaVersion` on any breaking change.

## Reading it

```
GET /api/v1/profiles?count=1&find[trioSettings][$exists]=true&find[startDate][$gte]=2020-01-01T00:00:00Z
```

- Always pass `find[startDate]`. Without it Nightscout silently limits the query to the last 4 days.
- Not every profile document has `trioSettings` (see "When it is attached"). The newest document
  that has it is the current configuration. Documents newer than that one have the same settings.
- `startDate` of the document is the upload time; `trioSettings.exportedAt` is when the payload was built.

## Shape (schemaVersion 1)

| Field | Type | Notes |
| --- | --- | --- |
| `schemaVersion` | integer | `1` |
| `exportedAt` | string, ISO 8601 UTC | when the payload was built on the phone |
| `appVersion` | string | `APP_DEV_VERSION` of the build, or `"unknown"` |
| `build` | string | `CFBundleVersion` (TestFlight build number), or `"unknown"` |
| `csv` | string | The Settings -> Export CSV, without BOM and without the `Metadata` category. Header `Setting Category,Subcategory,Setting Name,Value,Unit`, RFC 4180 quoting, `\n` line ends. **Localised** (device language: names, `Ingeschakeld`/`Uitgeschakeld`, number format). Same parser as `parseTrioSettingsCsv` applies. |
| `preferences` | object | Trio's `Preferences` (the oref preferences), encoded with its own `CodingKeys`. **Locale independent.** Decimal values are JSON numbers, booleans are booleans. Keys are a mix of snake_case (`max_iob`, `autosens_max`) and camelCase (`adjustmentFactor`, `sigmoid`, `enableUAM`) exactly as Trio names them. |
| `settings` | object | Trio's `TrioSettings` (app settings: `units`, `dosingMode`, `high`, `low`, ...), property names as keys. Locale independent. |
| `pumpSettings` | object | `{ "insulin_action_curve": <DIA hours>, "maxBolus": <U>, "maxBasal": <U/h> }` |

Machine consumers should use `preferences`, `settings` and `pumpSettings`; `csv` is there for fields that
only exist as export rows (device, presets, notifications) and as a human-readable record.
Unit caveat: the `csv` Unit column follows the user's glucose unit (`settings.units`). Glucose-valued numbers in
`preferences`/`settings` are believed to be stored in mg/dL regardless of `settings.units`;
verify against the first real document before relying on it.

Fields that matter for dynisf-tuner and where to find them:
autosens min/max `preferences.autosens_min` / `autosens_max`; dynamic ISF
`preferences.adjustmentFactor`, `adjustmentFactorSigmoid`, `sigmoid`, `useNewFormula`, `tddAdjBasal`,
`useWeightedAverage`, `weightPercentage`; SMB/UAM `preferences.enableUAM`, `enableSMB_*`, `maxSMBBasalMinutes`,
`maxUAMSMBBasalMinutes`, `SMBInterval`, `smb_delivery_ratio`; max IOB `preferences.max_iob`;
DIA `pumpSettings.insulin_action_curve`; units `settings.units`; dosing mode `settings.dosingMode`.

## Example (dummy values, not real therapy settings)

```json
{
  "defaultProfile": "default",
  "startDate": "2026-10-17T10:00:00Z",
  "units": "mmol",
  "store": { "default": { "dia": 10, "basal": [], "sens": [], "carbratio": [] } },
  "trioSettings": {
    "schemaVersion": 1,
    "exportedAt": "2026-10-17T10:00:00Z",
    "appVersion": "0.0.0.0",
    "build": "1",
    "csv": "Setting Category,Subcategory,Setting Name,Value,Unit\nTherapy,Units and Limits,Maximum Insulin on Board (IOB),0,U\nAlgorithm,Autosens,Autosens Max,1.2,\n",
    "preferences": {
      "max_iob": 0,
      "autosens_max": 1.2,
      "autosens_min": 0.7,
      "smb_delivery_ratio": 0.5,
      "enableUAM": false,
      "adjustmentFactor": 0.8,
      "adjustmentFactorSigmoid": 0.5,
      "sigmoid": false
    },
    "settings": { "units": "mmol/L", "dosingMode": "open", "high": 180, "low": 70 },
    "pumpSettings": { "insulin_action_curve": 10, "maxBolus": 1, "maxBasal": 1 }
  }
}
```

(`preferences` and `settings` are abbreviated here; the real objects hold every key.)

## When it is attached

A profile upload happens on every profile/override edit as before. `trioSettings` is added to an upload only when
the payload (everything above except `exportedAt`) differs from the last attached one, or the last attachment is
older than 23 hours. This keeps most profile documents small: each attachment is roughly 30-60 KB of JSON
(Nightscout compresses responses, so far less on the wire), and the 1 MB request limit is not close.
An attachment is recorded only after Nightscout accepted the upload; a failed upload is retried with the attachment.

Triggers that cause a profile upload, and therefore possibly an attachment:

| Change | Existing trigger | Added by the patch |
| --- | --- | --- |
| Basal, ISF, CR, targets | yes | |
| DIA (Algorithm advanced) | yes | |
| Override / override preset edits | yes | |
| Nightscout config saved, push token change (remote control) | yes | |
| New build / new expiry date at app start | yes (only when the expiry date changed) | |
| Any `Preferences` change (autosens, SMB, UAM, dynamic ISF, max IOB, ...) | **no** | yes, debounced 10 s |
| Any `TrioSettings` change (units, dosing mode, features, notifications, ...) | **no** | yes, debounced 10 s |
| Pump settings (DIA, max bolus, max basal) | partly (DIA only) | yes, debounced 10 s |
| Meal presets, temp target presets, device/pump/CGM changes | **no** | covered only by the daily refresh |
| App start / every hour while running | no | yes: uploads if the last attachment is older than 23 h |

Known gaps: changes that only touch meal presets, temp target presets, or the connected pump/CGM reach Nightscout
with the next attachment, at most about a day later. An app that is not running (never opened for a day) cannot upload.

## Safety properties

- Read-only: the patch reads settings and the Core Data presets the export already reads; it writes nothing except two
  `UserDefaults` keys (`trioSettingsUploadHash`, `trioSettingsUploadDate`) recording the last attachment.
- The profile upload never waits on it for more than 10 s and never throws because of it. Any error, timeout or
  payload over 200 KB is logged (`debug(.nightscout, ...)`) and the profile is uploaded without `trioSettings`.
- It does not change what the profile upload contains otherwise, and it does not touch the loop, pump or algorithm code.

## How it is built

`SettingsExportStateModel.exportSettings` was split into `buildExportRows` (the unchanged row-building body),
`csvText(for:)` and `writeExportFile`; the Settings -> Export screen behaves as before, and `NightscoutManager`
reuses the first two. See `patches/0002-trio-settings-upload.patch`.

Checks: `docs/trio-settings-upload-ns-check.js` runs Nightscout's own write-side sanitiser and query builder over a
dummy document of this shape. `.github/workflows/patch_guard.yml` fails when a patch stops applying to `dev`.
