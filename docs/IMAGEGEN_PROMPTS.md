# Image generation prompts

Both project images were created with Codex's built-in Image Gen path. No API key or CLI fallback was used.

## Dashboard design concept

```text
Use case: ui-mockup
Asset type: production design concept for a responsive React disaster operations dashboard, full primary desktop screen at 16:10
Primary request: Design the complete primary screen for “SentinelTwin”, an agentic multi-hazard digital twin whose persistent memory lives in CockroachDB and whose agents run on AWS. It must feel like a serious, premium emergency operations product, not a generic SaaS dashboard.
Audience: emergency planners, fire chiefs, infrastructure teams, and hackathon judges.
Required screen anatomy: a narrow charcoal vertical navigation rail with a restrained SentinelTwin shield/radar mark; compact top bar with the exact title “Western Region / Live Twin”, “Memory healthy”, and one high-visibility exact button “Run simulation”; central dominant map/canvas of California and nearby terrain with subdued topographic/satellite texture, fire-orange and seismic-violet hotspots, evacuation routes, incident labels, and a small code-native layer control for Composite / Fire / Seismic; a risk watchlist with “Santa Rosa”, “San Bernardino”, and “Ridgecrest”; a right-side persistent-memory rail with “Shared memory”, “Agent activity”, similarity retrieval, agent steps, and CockroachDB continuity; a lower simulation timeline showing an outcome improving after learned memory; and a visible “Simulate us-west-2 outage” control.
Core workflow signal: select a high-risk location, retrieve similar past memory, run a fire + earthquake scenario, display a resource plan, persist the outcome, then show memory remains available through a regional outage.
Visual direction: dark graphite command center with warm off-white text, ember orange for fire, electric lavender/violet for seismic, and acid-lime only for healthy/resilient states. Editorial condensed display type paired with crisp neutral UI type. Fine cartographic grid, topographic lines, hairline borders, squared corners with slight radius, tactile controls, and luminous route paths connecting the terrain map to the memory timeline.
Implementation constraints: all UI text and controls code-native; practical React/CSS implementation; reusable panel, row, status, layer-control, and timeline families; no rasterized interface text; no default bento grid; no giant rounded containers; no decorative hero eyebrow, fake marketing metrics, glassmorphism, neon cyberpunk overload, or generic stock photography. Keep every required region visible and readable in one full desktop screen.
Constraints: complete high-fidelity product screen, straight-on viewport screenshot, no device frame, no browser chrome, no watermark, no invented marketing claims or unrelated dashboards.
```

Output: `frontend/design/sentineltwin-dashboard-concept.png`

## California terrain base layer

```text
Use case: productivity-visual
Asset type: text-free geospatial terrain background for the central map canvas of the SentinelTwin disaster operations dashboard
Primary request: Create a highly detailed dark satellite/topographic, oblique-free map texture of California and the immediate surrounding western United States, with the entire state clearly recognizable and north-up. Show the Sierra Nevada, Central Valley, coastal ranges, Mojave desert, Pacific coastline, and subtle neighboring Nevada/Arizona terrain. It must be a quiet professional base layer beneath code-native fire, earthquake, route, and city overlays.
Style/medium: realistic satellite earth observation fused with restrained topographic relief, premium emergency-operations GIS aesthetic.
Composition: straight overhead map, California centered and filling most of a 3:2 landscape frame, Pacific at left, Nevada at right, Mexico edge at bottom, with clear margins for overlays.
Color palette: graphite, blackened forest green, slate, muted stone, and very dark ocean blue; no bright hazard colors because overlays are code-native.
Constraints: absolutely no text, labels, legends, markers, icons, routes, UI panels, watermark, fire, smoke, earthquake rings, or baked-in data graphics. Avoid political maps, generic abstraction, neon blue, glowing cities, weather maps, tilted perspective, and interface screenshots.
```

Output: `frontend/public/california-terrain.png`
