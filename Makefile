SHELL := /usr/bin/env bash
PYTHON ?= python3.12
.DEFAULT_GOAL := help

.PHONY: help check install api web test lint security validate integration provision-db db-bootstrap db-verify db-test-local db-test-cloud db-multi-region secret deploy deploy-web smoke smoke-satellite smoke-sentinel load-test

help:
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

check: ## Check local and optional cloud prerequisites.
	@./scripts/check-prereqs.sh

install: ## Install isolated backend and locked frontend dependencies.
	$(PYTHON) -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r backend/requirements-dev.txt
	pnpm --dir frontend install --frozen-lockfile

api: ## Run the zero-dependency local API at http://127.0.0.1:8787.
	PYTHONPATH=backend .venv/bin/python -m sentineltwin.local_server

web: ## Run the Vite dashboard at http://localhost:5173.
	pnpm --dir frontend dev

test: ## Run backend and frontend test suites.
	PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests
	pnpm --dir frontend test

lint: ## Run syntax/static checks available without cloud credentials.
	bash -n scripts/*.sh
	.venv/bin/ruff check backend database/migrate.py scripts/load_test.py scripts/validate-database-url.py
	PYTHONPATH=backend .venv/bin/python -m compileall -q backend
	pnpm --dir frontend exec tsc --noEmit

security: ## Audit dependencies and scan production Python sources.
	.venv/bin/pip-audit --local --progress-spinner off
	.venv/bin/bandit -q -r backend/sentineltwin database/migrate.py scripts/load_test.py scripts/validate-database-url.py
	pnpm --dir frontend audit --audit-level high

validate: lint ## Validate SAM/CloudFormation (SAM CLI required).
	sam validate --lint --template-file infra/template.yaml

integration: db-test-local ## Run the isolated real-CockroachDB schema/API integration test.

provision-db: ## Provision the guarded CockroachDB Cloud demo cluster using ccloud.
	./scripts/provision-cockroach.sh

db-bootstrap: ## Apply database/schema.sql to DATABASE_URL.
	./scripts/bootstrap-db.sh

db-verify: ## Show schema and vector index metadata for evidence.
	./scripts/verify-db.sh

db-test-local: ## Start an ephemeral loopback CockroachDB 25.4+ and exercise the durable API path.
	./scripts/local-cockroach-integration.sh

db-test-cloud: ## Run the opt-in API persistence/recall test against DATABASE_URL (writes two simulations).
	SENTINEL_DEMO_MODE=false SENTINEL_RUN_LIVE_COCKROACH_INTEGRATION=true \
		PYTHONPATH=backend .venv/bin/python -m pytest -q backend/tests/test_live_cockroach_integration.py

db-multi-region: ## Dry-run or explicitly apply guarded CockroachDB database region/locality settings.
	./scripts/configure-multi-region.sh

secret: ## Create/update the AWS database secret from DATABASE_URL.
	./scripts/create-secret.sh

deploy: ## Build and deploy the AWS SAM stack.
	./scripts/deploy-aws.sh

deploy-web: ## Upload frontend/dist to the private S3/CloudFront origin.
	./scripts/deploy-frontend.sh

smoke: ## Smoke-test API_BASE_URL (default http://127.0.0.1:8787/api).
	./scripts/smoke-test.sh

smoke-satellite: ## Upload SATELLITE_FILE through S3 and verify EventBridge/Lambda/Cockroach ingestion.
	./scripts/smoke-satellite.sh

smoke-sentinel: ## Import real Sentinel-2 AWS Open Data and verify GuardDuty/Bedrock/Cockroach ingestion.
	./scripts/smoke-sentinel-import.sh

load-test: ## Run the safe read-only local/API load test (override LOAD_* variables as needed).
	.venv/bin/python scripts/load_test.py --base-url "$${API_BASE_URL:-http://127.0.0.1:8787/api}" --duration "$${LOAD_DURATION:-15}" --concurrency "$${LOAD_CONCURRENCY:-8}"
