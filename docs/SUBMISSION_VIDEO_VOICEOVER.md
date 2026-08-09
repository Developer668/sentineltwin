# SentinelTwin submission video voice-over

This script matches `output/playwright/sentineltwin-submission-silent.mp4` exactly: **2:30**, 1600×900. It is written to match the conversational structure and pacing of Aditya's reference pitch: introduce the product plainly, spend the opening on the motivation, and use short visual callouts as the demo advances. The target pace is roughly 140 words per minute with frequent natural pauses.

The recorded command-center flow is intentionally connected to the labeled local demo API. The script says that directly and does not present the synthetic assessment or ephemeral memories as live AWS/CockroachDB writes.

## Timed script

### 0:00–0:15 — introduce the product

“Hi, my name is Aditya, and this is SentinelTwin, a human-supervised disaster-response digital twin. It connects real satellite evidence, multi-hazard simulations, and shared agent memory, so every response can learn from the one before it.”

### 0:15–0:30 — why I built it

“I built it because emergency teams create valuable knowledge every time they act: what failed, what stayed open, and what actually helped. But most dashboards and AI agents lose that context when the session ends.”

### 0:30–0:50 — the connected response loop

“And disasters do not happen in isolation. A wildfire can affect roads, power, water, communications, and farmland at the same time. So SentinelTwin keeps the evidence, assumptions, decisions, and outcomes connected in one loop: observe, reason within clear limits, and remember.”

### 0:50–1:05 — architecture

“Here you can see the architecture. AWS handles secure access, APIs, Lambda workflows, Bedrock reasoning, and versioned S3 evidence. CockroachDB keeps the operational state and vector memory together, so every recalled lesson stays tied to its source.”

### 1:05–1:10 — command center

“The command center brings risk, agents, guardrails, and memory into one view.”

### 1:10–1:20 — real satellite path

“For real imagery, it only accepts allowlisted Sentinel-2 Level-2A data, then verifies the private copy’s signature, version, ETag, and hash before Bedrock.”

### 1:20–1:30 — honest local fallback

“For this recording, I switch to the built-in tile. The dashboard clearly labels it synthetic, says no satellite pixels were analyzed, and reports no durable database write.”

### 1:30–1:35 — simulation lab

“From here, the lab supports wildfire, earthquakes, compound events, and agriculture.”

### 1:35–1:45 — agricultural resilience

“Agriculture is evidence-gated. It will not claim a real crop assessment until persisted Sentinel-2 evidence exists. Weather and irrigation inputs stay labeled assumptions, not invented facts.”

### 1:45–1:55 — first decision

“Now the first wildfire run retrieves shared memory, creates a bounded plan, and learns a new memory. Because this is the local demo, that write is correctly labeled ephemeral.”

### 1:55–2:10 — second run proves recall

“Then I run it again. The memory count rises from two to three, and the result cites the exact memory created by the first run. So the second decision is actually using the first decision’s outcome, not showing a decorative RAG sidebar.”

### 2:10–2:25 — agents, AWS, and CockroachDB

“Here you can see the five-agent workflow: assessor, retriever, simulator, planner, and commander. In deployed mode, CockroachDB provides durable vector recall, while AWS provides secure execution, evidence storage, model inference, tracing, and alarms.”

### 2:25–2:30 — close

“That is SentinelTwin: safer, auditable decisions that improve with every response. Thank you.”

## Recording notes

- Start speaking as the opening title settles; the first landing-page shot intentionally lasts 30 seconds so the product and motivation are both clear before the demo begins.
- Emphasize “human-supervised,” “persisted,” “synthetic,” and “ephemeral.” Those distinctions are part of the product’s safety story.
- At 1:55, point out that the second result shows three memories and recalls the learned memory ID created by the first run.
- Do not replace “in deployed mode” with a live-production claim unless that exact cloud flow has been recorded and verified.
