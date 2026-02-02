.PHONY: clean test setup logs doctor check create list delete

# Standard user prefix
USER_PREFIX := sbx_$(shell whoami)_

# Create one or more sandboxes
# Usage: make create NAME="session1 session2"
create: setup
	./bin/sbx create $(NAME)

# List all sandboxes
list:
	./bin/sbx list

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
	@bun scripts/doctor.ts

# Run the staged verification suite
test: setup
	@echo "🧪 Running staged verification suite..."
	@bun scripts/stage1-auth.ts
	@bun scripts/stage2-creation.ts
	@bun scripts/stage3-propagation.ts
	@bun scripts/stage4-sudoers.ts
	@bun scripts/stage5-provision.ts
	@bun scripts/stage6-cleanup.ts

# Setup environment
setup:
	@mkdir -p .sbx/logs
	@bun install

# Lint and format check
check:
	@bun run check

# View real-time system traces
logs:
	@touch .sbx/logs/trace.log
	@tail -f .sbx/logs/trace.log
