# ADR 0007 — SpO₂ and blood pressure from a licensed SDK

Date: 2026-11-27 · Status: Accepted (interface); vendor choice pending with the product owner

## Context

The reference wireframes show SpO₂ and blood pressure from the camera scan. ADR 0004 keeps both
"Not available" because ordinary RGB face video processed by our own pipeline is not a
validated method for either, and a homemade formula would be a fabricated measurement.

The product owner wants these metrics. The honest route is a licensed commercial SDK whose
vendor trained and (to varying degrees) tested BP and SpO₂ models. Vendor research
(2026-11-27, public pages only):

| Vendor          | BP                      | SpO₂ | React Native | Processing              | Price                                        | BP/SpO₂ regulatory       |
| --------------- | ----------------------- | ---- | ------------ | ----------------------- | -------------------------------------------- | ------------------------ |
| Binah.ai        | yes                     | yes  | official     | on-device, offline      | sales quote                                  | none cited               |
| FaceHeart       | yes (claims ±10 mmHg)   | yes  | listed       | on-device (Edge SDK)    | sales quote                                  | not cleared (HR, RR are) |
| Shen.AI         | systolic/diastolic      | no   | official     | on-device               | free Starter 250 scans/mo; BP tier €1,000/mo | BP in CE IIa Medical SDK |
| NuraLogix Anura | systolic/diastolic      | no   | no           | cloud (blood-flow data) | sales quote                                  | wellness only            |
| Presage         | uncalibrated trace only | no   | no           | on-device               | free trial                                   | not cleared              |

No option offers both metrics at $0.

## Decision

1. SpO₂ and blood pressure may come **only** from a licensed SDK, through the
   `VitalsSdkProvider` interface (`packages/measurement/src/sdkProvider.ts`). EdgeVitals code
   never computes them.
2. The default provider is `NO_SDK_PROVIDER`. Without an SDK, without a licence key, on an
   unsupported device or after an SDK error, both metrics stay "Not available" or "No reliable
   reading". Vendor output outside plausibility limits (SpO₂ 70–100 %, systolic 70–220,
   diastolic 40–140, pulse pressure ≥ 10 mmHg) is stored as `invalid` with no value.
3. Readings are stored with `method = 'licensed_sdk'`, `algorithm_name = 'sdk-<vendor>'`,
   `algorithm_version = <SDK version>` and `validation = 'unvalidated'`: vendor accuracy claims
   are not our validation. Blood pressure is systolic in `value`, diastolic in `value_secondary`.
4. The schema and the database (migration 002) reject valid SpO₂/BP from any other method,
   reject heart rate, HRV or breathing from a licensed SDK, and require diastolic < systolic.
5. SDK metrics do not affect whether a scan is "completed"; that still depends on heart rate,
   HRV and breathing. They do not feed baselines or scores.
6. The app labels these values "Estimate" / "Wellness estimate" and says they are not a
   substitute for a pulse oximeter or blood-pressure cuff.

## Adding a vendor

Implement `VitalsSdkProvider` in `apps/mobile/src/vitals-sdk/<vendor>.ts` (wrapping the vendor's
React Native module; this needs an EAS development build, not Expo Go), register it in
`ADAPTERS`, and build with `EXPO_PUBLIC_VITALS_SDK=<vendor>` plus the vendor licence key from
EAS secrets. `status()` must return `unlicensed` when the key is missing. Coordinate camera
ownership with `CameraScanner`: most vendor SDKs open the camera themselves, so the vendor
measurement runs after the EdgeVitals scan releases the camera.

## Before any claim beyond "wellness estimate"

Regulatory review of the vendor's clearance scope in each market, and an EdgeVitals
validation against a reference cuff (BP, e.g. ISO 81060-2 protocol) and pulse oximeter (SpO₂)
across skin tones and devices, as in doc 12 §4.
