SCRIPT := ./scripts/uptime-kuma-docker.sh

# Instance defaults — override on the command line: make sync SOURCE=primary TARGET=secondary
SOURCE  ?= primary
TARGET  ?= secondary

.PHONY: help list monitors monitors-tldr build shell \
        sync sync-deep sync-force diff diff-tldr backup restore \
        test

help:
	@printf "\033[1;36m Uptime Kuma Sync & Backup\033[0m\n"
	@printf "\033[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
	@printf "\n\033[1;33m INSTANCES\033[0m\n"
	@printf "  \033[1;32mmake list\033[0m                         List configured instances\n"
	@printf "  \033[1;32mmake monitors\033[0m                     List monitors in SOURCE (grouped)\n"
	@printf "  \033[1;32mmake monitors-tldr\033[0m                Summary of monitors in SOURCE\n"
	@printf "\n\033[1;33m SYNC\033[0m\n"
	@printf "  \033[1;32mmake sync\033[0m                         Incremental shallow sync SOURCE → TARGET\n"
	@printf "  \033[1;32mmake sync-deep\033[0m                    Incremental deep sync SOURCE → TARGET\n"
	@printf "  \033[1;32mmake sync-force\033[0m                   Full sync SOURCE → TARGET (ignore state)\n"
	@printf "\n\033[1;33m DIFF\033[0m\n"
	@printf "  \033[1;32mmake diff\033[0m                         Full diff SOURCE vs TARGET\n"
	@printf "  \033[1;32mmake diff-tldr\033[0m                    Summary diff SOURCE vs TARGET\n"
	@printf "\n\033[1;33m BACKUP / RESTORE\033[0m\n"
	@printf "  \033[1;32mmake backup\033[0m                       Backup SOURCE instance\n"
	@printf "  \033[1;32mmake restore FILE=<path>\033[0m          Restore backup to TARGET\n"
	@printf "\n\033[1;33m CONTAINER\033[0m\n"
	@printf "  \033[1;32mmake build\033[0m                        Build image locally\n"
	@printf "  \033[1;32mmake shell\033[0m                        Interactive shell in container\n"
	@printf "\n\033[1;33m DEVELOPMENT\033[0m\n"
	@printf "  \033[1;32mmake test\033[0m                         Run test suite\n"
	@printf "\n\033[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\033[0m\n"
	@printf "\033[1;33m VARIABLES\033[0m  \033[90m(override on command line)\033[0m\n"
	@printf "  \033[1;35mSOURCE\033[0m=\033[0m$(SOURCE)   \033[1;35mTARGET\033[0m=$(TARGET)\n"
	@printf "  \033[1;35mFILE\033[0m=<backup-path>  \033[90m(required for restore)\033[0m\n"
	@printf "\n\033[90m  Example: make sync SOURCE=secondary TARGET=primary\033[0m\n\n"

# Container management
build:
	@$(SCRIPT) build

shell:
	@$(SCRIPT) shell

# Instance operations
list:
	@$(SCRIPT) list

monitors:
	@$(SCRIPT) monitors $(SOURCE)

monitors-tldr:
	@$(SCRIPT) monitors $(SOURCE) --tldr

sync:
	@$(SCRIPT) sync $(SOURCE) $(TARGET)

sync-deep:
	@$(SCRIPT) sync $(SOURCE) $(TARGET) --deep

sync-force:
	@$(SCRIPT) sync $(SOURCE) $(TARGET) --force

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
