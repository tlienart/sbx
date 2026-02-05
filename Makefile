# Detect Bun - fall back to home directory installation if not in PATH
BUN := $(shell command -v bun || echo $(HOME)/.bun/bin/bun)

.PHONY: install setup clean test logs doctor check create list delete exec test_e2e typecheck

# Install pkgx and Bun if missing and setup the project
install:
	@if ! command -v pkgx >/dev/null 2>&1; then \
		echo "📦 pkgx not found. Installing pkgx..."; \
		curl -Ssf https://pkgx.sh | sh; \
	fi
	@if ! command -v bun >/dev/null 2>&1 && [ ! -f $(HOME)/.bun/bin/bun ]; then \
		echo "📦 Bun not found. Installing Bun..."; \
		curl -fsSL https://bun.sh/install | bash; \
	fi
	@$(MAKE) setup

# Setup environment and install dependencies
setup:
	@mkdir -p .sbx/logs
	@$(BUN) install

# Standard user prefix
USER_PREFIX := sbx_$(shell whoami)_

# Create one or more sandboxes
# Usage: make create name="session1 session2" tools="gh,jq" provider="google"
create: setup
	./bin/sbx create $(name) $(if $(tools),--tools "$(tools)") $(if $(provider),--provider "$(provider)")

# List all sandboxes
list:
	./bin/sbx list

# Execute a command or open a shell in a sandbox
# Usage: make exec name="session1" [cmd="command"]
exec:
	./bin/sbx exec $(name) $(cmd)

# Delete one or more sandboxes
# Usage: make delete name="session1 session2"
delete:
	./bin/sbx delete $(name)

# Aggressively clean up all sbx related artifacts
clean:
	@echo "🧹 Cleaning up sbx sessions and processes..."
	-@sudo pkill -9 sysadminctl su sbx || true
	-@dscl . -list /Users | grep $(USER_PREFIX) | while read user; do \
		echo "Deleting user: $$user"; \
		sudo sysadminctl -deleteUser $$user || true; \
		sudo rm -rf /Users/$$user || true; \
		sudo rm -f /etc/sudoers.d/$$user || true; \
	done
	-@sudo rm -f /etc/sudoers.d/sbx_$(shell whoami)_* || true
	@rm -rf .sbx/logs/*
	@echo "✨ System cleaned."

# Check system health and permissions
doctor:
	@$(BUN) scripts/doctor.ts

# Type check the codebase
typecheck: setup
	@$(BUN) run typecheck

# Run core sandbox isolation tests
test_sandbox: setup typecheck
	@$(BUN) run test:sandbox

# Run fast bridge bot logic tests
test_bot: setup
	@$(BUN) run test:bot

# Run REST API integration tests
test_e2e: setup
	@$(BUN) run test:api

# Run everything sequentially
test_full: test_sandbox test_bot test_e2e

# Standard staged verification (backwards compatibility)
test: test_sandbox

# Lint and format check
check: typecheck
	@$(BUN) run check

# View real-time system traces
logs:
	@touch .sbx/logs/trace.log
	@tail -f .sbx/logs/trace.log
