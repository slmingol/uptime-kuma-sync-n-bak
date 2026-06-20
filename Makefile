SCRIPT := ./scripts/uptime-kuma-docker.sh

# Instance defaults — override on the command line: make sync SOURCE=primary TARGET=secondary
SOURCE  ?= primary
TARGET  ?= secondary

.PHONY: help list build shell \
        sync sync-deep diff backup restore \
        test

help:
	@$(SCRIPT) help

# Container management
build:
	@$(SCRIPT) build

shell:
	@$(SCRIPT) shell

# Instance operations
list:
	@$(SCRIPT) list

sync:
	@$(SCRIPT) sync $(SOURCE) $(TARGET)

sync-deep:
	@$(SCRIPT) sync $(SOURCE) $(TARGET) --deep

diff:
	@$(SCRIPT) diff $(SOURCE) $(TARGET)

diff-tldr:
	@$(SCRIPT) diff $(SOURCE) $(TARGET) --tldr

backup:
	@$(SCRIPT) backup $(SOURCE)

restore:
	@if [ -z "$(FILE)" ]; then echo "Usage: make restore FILE=<backup-file> [TARGET=<instance>]"; exit 1; fi
	@$(SCRIPT) restore $(FILE) $(TARGET)

# Development
test:
	@npm test
