#!/bin/bash

set -euo pipefail

DRY_RUN=false
SCOPE=""

while [[ $# -gt 0 ]]; do
	case $1 in
	--dry-run)
		DRY_RUN=true
		shift
		;;
	-*)
		echo "Unknown option: $1"
		echo "Usage: $0 [--dry-run] <scope>"
		exit 1
		;;
	*)
		SCOPE="$1"
		shift
		;;
	esac
done

if [ -z "$SCOPE" ]; then
	echo "Usage: $0 [--dry-run] <scope>"
	exit 1
fi
PLUGIN_PKG="@datadog/datadog-ci-plugin-$SCOPE"
PLUGIN_DIR="packages/plugin-$SCOPE"

if [ -d "$PLUGIN_DIR" ]; then
	echo "Plugin directory $PLUGIN_DIR already exists!"
	echo "This script should only be run once per scope, before migrate.sh"
	exit 1
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "This script will initialize and publish an empty package for ${BLUE}${BOLD}$PLUGIN_PKG${NC}"
echo
echo -e "${BOLD}Please follow the instructions${NC} at ${BLUE}https://datadoghq.atlassian.net/wiki/x/QYDRaQE${NC} before running this script."
echo

read -rsp "Enter your NPM auth token: " INIT_NPM_AUTH_TOKEN
echo
if [ -z "$INIT_NPM_AUTH_TOKEN" ]; then
	echo "Error: NPM auth token cannot be empty"
	exit 1
fi

# Export this for subsequent yarn commands in the script
export INIT_NPM_AUTH_TOKEN

# Do not hardcode the token in .yarnrc.yml, it will be read from the environment variable
yarn config set npmAuthToken '${INIT_NPM_AUTH_TOKEN}'
echo

echo "1. Creating plugin directory structure"
mkdir -p "$PLUGIN_DIR"
env cp LICENSE "$PLUGIN_DIR"
echo "Empty package" > "$PLUGIN_DIR/README.md"
cat > "$PLUGIN_DIR/package.json" <<EOF
{
  "name": "$PLUGIN_PKG",
  "version": "0.0.1",
  "description": "Datadog CI plugin for \`$SCOPE\` commands",
  "license": "Apache-2.0",
  "keywords": [
    "datadog",
    "datadog-ci",
    "plugin"
  ],
  "homepage": "https://github.com/DataDog/datadog-ci/tree/master/$PLUGIN_DIR",
  "repository": {
    "type": "git",
    "url": "https://github.com/DataDog/datadog-ci.git",
    "directory": "$PLUGIN_DIR"
  },
  "exports": {
    "./package.json": "./package.json",
    "./commands/*": {
      "development": "./src/commands/*.ts",
      "default": "./dist/commands/*.js"
    }
  },
  "files": [
    "dist/**/*",
    "README",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  },
  "scripts": {
    "build": "yarn package:clean; yarn package:build",
    "lint": "yarn package:lint",
    "prepack": "yarn package:clean-dist"
  },
  "peerDependencies": {
    "@datadog/datadog-ci-base": "workspace:*"
  }
}
EOF

echo "2. Publishing empty package to npm"
echo
yarn
if [ "$DRY_RUN" = true ]; then
	yarn workspace "$PLUGIN_PKG" npm publish --dry-run
else
	yarn workspace "$PLUGIN_PKG" npm publish
fi

echo
echo "3. Cleaning up"
yarn config unset npmAuthToken

echo
if [ "$DRY_RUN" = true ]; then
	echo -e "${GREEN}[DRY-RUN] Would have published ${BOLD}$PLUGIN_PKG@0.0.1${NC}${NC}"
else
	echo -e "${GREEN}Successfully published ${BOLD}$PLUGIN_PKG@0.0.1${NC}${NC}"
fi

echo
echo -e "If needed, you can now run: ${BLUE}bin/migrate.sh $SCOPE${NC}"
