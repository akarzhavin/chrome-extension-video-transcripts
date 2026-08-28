# Lingogram — release and development entry points.
#
# Exists because the release path has one correct route and several plausible
# wrong ones. `npm run build` is the wrong one: it compiles without GA4
# credentials, the guard at the top of track() folds to a constant, and the
# minifier drops the whole transport — a working extension that reports
# nothing. That shipped twice (youtube 1.0.15 and 1.0.16). `make release` is
# the route that cannot do that.
#
# Run `make` with no target for the list.

SHELL := /bin/bash

APPS := youtube rezka
RELEASES := releases

# Read from each app's package.json rather than hardcoded: a stale version here
# would name an archive that does not exist and quietly verify the wrong file.
version = $(shell node -p "require('./apps/$(1)/package.json').version")

.DEFAULT_GOAL := help
.PHONY: help release build-dev verify verify-all test type-check check clean-dev-zips

help: ## Show this help
	@echo ''
	@echo '  Lingogram'
	@echo ''
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo ''
	@echo '  Release, end to end:'
	@echo '    1. bump the version in apps/<app>/package.json ABOVE the live one in CWS'
	@echo '    2. make release'
	@echo '    3. upload releases/<app>-v<version>.zip in the CWS Dashboard'
	@echo ''
	@echo '  Full checklist: docs/ops/release.md'
	@echo ''

release: ## Build all extensions for production, with analytics, then verify the archives
	@if [ ! -f .env ]; then \
		echo ''; \
		echo '  No .env — the GA4 credentials live there.'; \
		echo '  cp .env.example .env, then fill in the prod pair.'; \
		echo '  Without it the build would silently ship mute analytics.'; \
		echo ''; \
		exit 1; \
	fi
	./scripts/build-with-analytics.sh prod
	@$(MAKE) --no-print-directory verify-all

build-dev: ## Build all extensions against the dev backend and dev GA4 property (no archives)
	./scripts/build-with-analytics.sh dev

verify-all: ## Run the pre-upload gate over every archive of the current versions
	@echo ''
	@echo '  Verifying the archives that would be uploaded:'
	@echo ''
	@failed=0; \
	for app in $(APPS); do \
		v=$$(node -p "require('./apps/$$app/package.json').version"); \
		zip="$(RELEASES)/$$app-v$$v.zip"; \
		if [ ! -f "$$zip" ]; then \
			echo "  MISSING  $$zip"; \
			failed=1; \
			continue; \
		fi; \
		if node packages/shared/verify-zip.mjs "$$zip" > /dev/null 2>&1; then \
			echo "  ok       $$zip"; \
		else \
			echo "  REFUSED  $$zip"; \
			node packages/shared/verify-zip.mjs "$$zip" 2>&1 | grep '•' || true; \
			failed=1; \
		fi; \
	done; \
	echo ''; \
	if [ "$$failed" = "1" ]; then \
		echo '  Not shippable. Do not upload.'; \
		echo ''; \
		exit 1; \
	fi; \
	echo '  All archives are shippable.'; \
	echo ''

verify: ## Verify one archive: make verify ZIP=releases/youtube-v1.0.17.zip
	@if [ -z "$(ZIP)" ]; then \
		echo 'usage: make verify ZIP=releases/youtube-v1.0.17.zip'; \
		exit 2; \
	fi
	@node packages/shared/verify-zip.mjs "$(ZIP)"

test: ## Run the test suite
	npm test

type-check: ## Type-check every workspace
	npm run type-check

check: type-check test ## Type-check and test

# Dev runs no longer write archives, but one built before that change may still
# be sitting in releases/ under a release name — which is how 1.0.15 reached the
# store carrying the dev backend switch and preprod.lingogram.ai.
clean-dev-zips: ## Delete archives in releases/ that the pre-upload gate rejects
	@for zip in $(RELEASES)/*.zip; do \
		[ -f "$$zip" ] || continue; \
		if ! node packages/shared/verify-zip.mjs "$$zip" > /dev/null 2>&1; then \
			echo "  removing  $$zip"; \
			rm -f "$$zip"; \
		fi; \
	done
	@echo '  Done — every archive left in $(RELEASES)/ passes the gate.'
