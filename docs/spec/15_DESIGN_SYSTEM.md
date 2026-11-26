# 15 — Design System

## 1. Direction

Faithfully reproduce the reference: clean white wellness interface, blue primary action, dark typography, light neutral cards and generous spacing. Avoid introducing unrelated visual styles.

## 2. Initial design tokens

Values are starting points to tune against the PDF screenshots.

```css
:root {
  --color-primary: #2460D8;
  --color-primary-soft: #E8F0FF;
  --color-text: #17191F;
  --color-muted: #68707D;
  --color-border: #E5E7EB;
  --color-surface: #F3F4F6;
  --color-background: #FFFFFF;
  --color-success: #247A50;
  --color-warning: #A65A16;

  --radius-card: 20px;
  --radius-control: 14px;
  --radius-pill: 999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
}
```

## 3. Typography

- Large page title: bold, compact line-height.
- Section title: semibold/bold.
- Body: regular, readable, muted only for secondary copy.
- Metric value: large and high contrast.
- Units: smaller but still legible.
- Avoid excessive font weights and decorative type.

## 4. Components

- `PrimaryButton`
- `TextButton`
- `ConsentOption`
- `TextField`
- `SegmentedControl`
- `RatingScale`
- `ProgressSteps`
- `BaselineProgressCard`
- `MetricCard`
- `MetricRow`
- `StatusPill`
- `InsightCard`
- `TrendChart`
- `BottomNavigation`
- `CameraPreviewFrame`
- `ScanQualityStatus`

## 5. States

Every interactive component should define:
- default;
- pressed;
- selected;
- disabled;
- loading;
- error;
- focus/accessibility state.

## 6. Dashboard composition

The POC's mature dashboard order:
1. Date/greeting/streak.
2. Recovery hero.
3. Recovery/Stress/Energy cards.
4. Assessment action and completion state.
5. Progress chart.
6. Latest vitals.
7. Personal insight.
8. Monthly report progress.
9. Bottom navigation.

## 7. Scan composition

- Dark background.
- Clear cancel control.
- Camera preview with face guide.
- Honest quality state.
- Measurement progress card.
- Per-metric statuses.
- No fabricated countdown or readings.

## 8. Screenshot QA

For each of the 12 reference pages:
- capture app screenshot on a standard viewport;
- compare hierarchy, spacing, text wrapping, colour and control sizes;
- verify selected/disabled/loading states;
- record deviations and approve intentional changes.
