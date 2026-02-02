# Detect Bun - fall back to home directory installation if not in PATH
BUN := $(shell command -v bun || echo $(HOME)/.bun/bin/bun)

.PHONY: install setup clean test logs doctor check create list delete exec

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
# Usage: make create NAME="session1 session2" TOOLS="gh,jq"
create: setup
	./bin/sbx create $(NAME) $(if $(TOOLS),--tools "$(TOOLS)")

# List all sandboxes
list:
	./bin/sbx list

# Execute a command or open a shell in a sandbox
# Usage: make exec NAME="session1" [CMD="command"]
exec:
	./bin/sbx exec $(NAME) $(CMD)

# Delete one or more sandboxes
# Usage: make delete NAME="session1 session2"
delete:
	./bin/sbx delete $(NAME)

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

# Run the staged verification suite
test: setup
	@echo "🧪 Running staged verification suite..."
	@$(BUN) scripts/stage1-auth.ts
	@$(BUN) scripts/stage2-creation.ts
	@$(BUN) scripts/stage3-propagation.ts
	@$(BUN) scripts/stage4-sudoers.ts
	@$(BUN) scripts/stage5-provision.ts
	@$(BUN) scripts/stage6-cleanup.ts

# Lint and format check
check:
	@$(BUN) run check

# View real-time system traces
logs:
	@touch .sbx/logs/trace.log
	@tail -f .sbx/logs/trace.log
