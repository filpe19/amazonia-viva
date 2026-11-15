# Mission 05 — audit and design direction

Baseline: real Chrome / Python Playwright, 1440×900 and 390×844; existing servers :5710/:8710.
Recovery: /Users/felipealsouza/Backups/amazonia-viva-before-mission05-20261114-225010
113 source files, SHA-256 manifest; credentials, dependencies and runtime data excluded.
Baseline: 77 backend tests passed; TypeScript passed.

## Screenshot-based findings
- Desktop map initially blank despite real data. Browser diagnostic resize/repaint restored tiles, boundaries and detections.
- Floating filter/result panels covered most of the map; mobile map preceded all territory/time controls.
- History began with storage/import details, hiding the scientific calendar far below the fold.
- Intro contradicted existing experimental series; tiny dot marked converted months; hover excluded touch.
- Mobile main overflow: history 435px, territory 462px, report 496px against 390px viewport.
- Five equally weighted destinations, repeated cards and dense small captions obscured the three main tasks.

## Design tokens and review
Forest #123e32, deep forest #092c24, river #286b87, ink #19332c, mist #f4f7f6, rule #d9e3de.
Amber #bc741b: fire activity; red #b33b32: errors or a labelled fire series.
Existing locally served Archivo Variable; width 100/110, titles 28–34px, body 14–15px,
captions >=12px. Spacing 4/8/12/16/24/32px; radii 6px controls, 10px workspaces.
Three-module institutional sidebar; shared territory bar; map and evidence rail without large overlays.
Mobile: controls, map, evidence. History: calendar first, then observed records and methods in separate tabs.
The map is the characteristic visual. Remove decorative gradients, repetitive shadows and needless cards.
Visible focus; touch/keyboard calendar; 24px calendar cells; 40–44px controls; labelled scroll regions;
reduced motion; source distinctions beyond color; loading, empty and error states.
English demonstration. Preserve territory names, original exports and scientific enums.

## Verified science
Portel /history/harmonized: seasonal LOYO median APE 15.8995%, P90 31.5248%; 25 active test months,
2021–2025, >=30 detections in both sensors. Constant model: median 14.6949%, P90 61.6509%.
Calendar starts July 2002. Fitted calendar ratios use >=10 detections and >=3 valid years;
otherwise general ratio. LOYO and fitted-calendar sample rules differ.
P10–P90 conversion-ratio spread is empirical, not a calibrated confidence/prediction interval.
Do not interpret it as measurement accuracy. Do not alter backend or scientific computations.
