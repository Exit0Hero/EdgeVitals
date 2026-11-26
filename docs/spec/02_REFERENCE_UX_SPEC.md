# 02 — Reference UX Specification

## Source

Primary reference: **EdgeVitals App – POC Check-in Flow & Wireframes.pdf**, 12 pages. The descriptions below record visible content and interactions from the supplied screens. Unspecified behaviour is marked as an implementation decision.

## Global visual language

- Mobile-first portrait layout.
- White background with very light cool-grey surfaces.
- Strong royal/medium blue primary actions and selected states.
- Dark near-black headings; muted grey supporting text.
- Rounded cards, inputs and large bottom-anchored primary buttons.
- Bottom navigation on the dashboard: Today, central assessment action, Trends.
- Typography is bold and high-contrast for headings; supporting text is grey.
- Active scan uses a dark full-screen treatment, contrasting with the rest of the app.

Do not treat the embedded images as pixel-perfect source assets. Recreate the layout with reusable design tokens and verify against the PDF.

## Page 1 — Welcome

**Visible content**
- EdgeVitals logo/wordmark.
- Heading: “Know your body's daily rhythm.”
- Supporting copy: “Two short face scans a day. We learn what's normal for you and show how you're trending.”
- Three value statements:
  - Heart rate, HRV, breathing, SpO₂ and blood pressure
  - Your personal baseline after 14 days
  - Wellness insights — not a medical device
- Primary action: “Get started”
- Secondary action: “I already have an account”

**Behaviour**
- Get started begins consent/onboarding.
- Existing-account action opens sign-in.
- Do not imply the five metrics are all available until the measurement engine supports them.

## Page 2 — Consent

**Visible content**
- Back navigation.
- Heading: “Your data, your control”
- Copy says readings are stored securely in `[HOSTING REGION]`, and can be exported or deleted anytime.
- Required checkbox: agree to processing readings to provide wellness insights.
- Required checkbox: understand EdgeVitals is a wellness app, not a medical device.
- Optional checkbox: help improve EdgeVitals with anonymised data.
- Privacy policy link.
- “Agree and continue” button.

**Behaviour**
- Required checkboxes gate continuation.
- Optional analytics/research consent is separate, default false, and revocable.
- Replace `[HOSTING REGION]` only after deployment region is selected and verified.
- Store consent version, timestamp, purpose and choice.

## Page 3 — About you (Step 1 of 2)

**Visible content**
- Step indicator and progress bar.
- Year of birth.
- Sex at birth: Female / Male in the reference.
- Height (cm) and Weight (kg).
- Copy: values can be changed anytime in profile.
- Continue button.

**Behaviour**
- Validate reasonable input bounds without making diagnostic judgements.
- Preserve entered values on back navigation.
- Product decision: whether to support additional sex/gender options or “prefer not to say”; do not silently change the reference field semantics.

## Page 4 — Your daily rhythm (Step 2 of 2)

**Visible content**
- Morning scan card, default 07:15; “Soon after waking, before coffee”.
- Evening scan card, default 21:00; “Before winding down for bed”.
- Question: “Do you take anything that affects your heart rate?”
- No / Yes / Skip.
- Optional explanation, beta-blockers example.
- “Start my baseline” action.

**Behaviour**
- Time values should be editable using native time pickers.
- Yes should not force collection of a medication name unless a separately reviewed requirement is added.
- Start baseline marks onboarding complete and opens Today dashboard.

## Page 5 — Initial dashboard / baseline

**Visible content**
- Date and greeting.
- Baseline progress (example: 4/14, 10 more days).
- “Run morning assessment” action.
- Locked day-14 features: Recovery, Stress and Energy scores; Personal trends.
- Last assessment summary with HR, HRV, breathing, SpO₂ and blood pressure.
- Bottom navigation: Today, central assessment, Trends.

**Behaviour**
- The shown 4/14 and readings are examples, not constants.
- Display real user progress and valid last assessment.
- Locked features explain what becomes available and when.
- Empty state required when no assessment exists.

## Page 6 — Morning check-in

**Visible content**
- Three-step progress: Check-in / Scan / Results.
- “How are you this morning?”
- Sleep quality 1–5, endpoints Poorly / Very well.
- Energy 1–5, endpoints Very low / Very high.
- Alcohol previous evening: No / Yes.
- “Next: scan”.

**Behaviour**
- Require valid ratings; alcohol response is a binary choice in the reference.
- Selected values have clear visual state and accessible labels.

## Page 7 — Scan preparation

**Visible content**
- Same three-step progress; Scan selected.
- “Get ready to scan”.
- Large face/camera placeholder.
- Three instructions:
  - Sit down and relax — Rest for a moment before you start.
  - Face the camera in even light — No strong light behind you.
  - Stay still, breathe normally — Don't talk during the scan.
- “Start scan”.

**Behaviour**
- Explain camera permission before requesting it.
- Check device compatibility and camera availability.
- If camera is unavailable or denied, explain next steps without blocking access to saved history.

## Page 8 — Active scan

**Visible content**
- Dark screen.
- Cancel and “Keep still”.
- Camera preview.
- Face detected / lighting good status.
- “Measuring all 5 vital signs” with time remaining placeholder.
- Metric states for HR, breathing, HRV, SpO₂ and blood pressure.
- “Skip to results (prototype only)”.

**Behaviour**
- Production UI must not claim face detection or good lighting unless the relevant computer-vision checks run successfully.
- Show actual elapsed/progress information, not a fabricated countdown.
- Per-metric availability must be independent.
- The prototype skip control must be removed or restricted to a clearly labelled developer/demo mode.
- Cancel stops capture and discards incomplete signal buffers according to privacy policy.

## Page 9 — Morning results

**Visible content**
- Three-step progress; Results selected.
- Example headline: “You've recovered well”.
- Time and check-in context.
- Recovery card (example 78 Good) and Stress card (example 24 Calm).
- Vitals list: HR, HRV, breathing rate, SpO₂, blood pressure.
- Status tags such as Typical and Higher.
- Wellness-only disclaimer.
- Done button.

**Behaviour**
- Example values are fixtures only.
- Status tags must be derived from validated personal reference ranges, not hard-coded clinical thresholds.
- If baseline is not ready, use neutral “not enough personal history yet”.
- “Higher” must not imply diagnosis; use non-alarmist explanatory language.

## Page 10 — Mature dashboard

**Visible content**
- Date, greeting, streak.
- Recovery headline and narrative.
- Recovery, Stress and Energy score cards.
- Run evening assessment / morning done state.
- Progress chart and changes in resting heart rate and HRV.
- This morning's vitals.
- “What's working for you” insight card.
- 30-day report progress.
- Bottom navigation.

**Behaviour**
- Streak calculation must define timezone, missed days and completion criteria.
- Trend comparisons must use comparable valid readings.
- Insights should use association language (“in your records, these days were associated with…”) rather than causal claims.

## Page 11 — Evening check-in

**Visible content**
- Three-step progress.
- “How was your day?”
- Stress rating 1–5, endpoints Calm / Very stressed.
- Energy now 1–5, endpoints Very low / Very high.
- “Next: scan”.

**Behaviour**
- Save answers with the evening assessment.
- Same navigation and recovery behaviour as morning check-in.

## Page 12 — Trends

**Visible content**
- Tabs: Recovery, Stress, Energy, HRV, Heart rate (partially visible horizontal selector).
- Period selector: 7 days / 30 days / 90 days.
- Selected metric title and average.
- Line chart and personal usual range.
- Insight card (example: HRV usually lower after sleep rated 1 or 2).
- Resting heart rate and blood pressure summaries.
- Bottom navigation.

**Behaviour**
- Period selector changes the displayed dataset.
- Show sample count and missing-data treatment.
- Avoid drawing a personal range when insufficient data exists.
- Provide accessible textual summaries for charts.

## Responsive and accessibility notes

- Primary actions remain reachable without obscuring content.
- Respect safe areas and keyboard insets.
- Minimum touch target and contrast should meet the selected accessibility standard.
- Do not encode status only by colour.
- Support dynamic text, screen readers, reduced motion and device font scaling.
