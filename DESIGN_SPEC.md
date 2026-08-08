# SentinelTwin command-center design spec

Accepted concept: `frontend/design/sentineltwin-dashboard-concept.png` (native viewport 1536 × 1024).

## Product surface

SentinelTwin is a working emergency-operations dashboard, not a marketing page. The primary screen must let a planner select a location, inspect wildfire and earthquake risk, retrieve a similar past event from CockroachDB memory, run a compound scenario, persist the learned outcome, and prove memory continuity during a simulated AWS regional outage.

## Locked visual system

- Background: near-black blue graphite (`#071015`–`#0b151a`), never warm gray.
- Panels: quiet contiguous rails with one-pixel cool-gray borders; 0–4 px radii. No bento grid or glass cards.
- Fire: ember orange (`#ff650f`). Seismic: electric violet (`#9b69ff`). Healthy/learned: acid lime (`#93df56`).
- Typography: compact editorial/condensed headings plus neutral sans-serif UI text. Buttons, tabs, labels, table rows, and status chrome have deliberate sizes.
- Map: dominant center canvas with dark satellite/topographic texture, fine coordinate grid, California geography, luminous hazard rings, and route paths that continue visually into the lower timeline.
- Motion: restrained hotspot pulse, route dash flow, scanning line, and activity-state transitions; disabled under `prefers-reduced-motion`.

## Desktop anatomy

1. 136 px navigation rail with SentinelTwin mark and six concise destinations.
2. 220 px risk watchlist with Santa Rosa, San Bernardino, and Ridgecrest.
3. Flexible dominant hazard map.
4. 350 px shared-memory and agent-activity rail.
5. Approximately 260 px bottom simulation timeline, before/after outcome, and resource plan.

Responsive layouts may turn rails into horizontally scrollable or stacked regions, but must preserve the map, selected location, layer control, run action, retrieved memory, outcome delta, and outage test.

## Allowed first-viewport copy

`SentinelTwin`; `Western Region / Live Twin`; `Memory healthy`; `Run simulation`; `Composite`; `Fire`; `Seismic`; `Santa Rosa`; `San Bernardino`; `Ridgecrest`; `Shared memory`; `Agent activity`; `Persistent memory continuity`; `Simulate us-west-2 outage`; operational row labels that are required for the workflow.

## Component families

- App shell and navigation rail
- Risk watchlist rows with selected, high, elevated, and normal variants
- Code-native terrain/map canvas, hotspot, route, and incident marker layers
- Layer switches for composite, fire, and seismic
- Memory result row and agent activity timeline
- Multi-region continuity table
- Simulation setup dialog and running/completed states
- Outcome comparison with memory-off and memory-on columns
- Resource-plan list and event console

All controls, labels, event text, and data are code-native. The generated concept is reference material only and must not be shipped as a screenshot pretending to be the application.
