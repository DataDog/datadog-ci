#!/bin/bash

set -euo pipefail

SCOPE=""

while [[ $# -gt 0 ]]; do
	case $1 in
	-*)
		echo "Unknown option: $1"
		echo "Usage: $0 <scope>"
		exit 1
		;;
	*)
		SCOPE="$1"
		shift
		;;
	esac
done

if [ -z "$SCOPE" ]; then
	echo "Usage: $0 <scope>"
	exit 1
fi
PLUGIN_PKG="@datadog/datadog-ci-plugin-$SCOPE"
PLUGIN_DIR="packages/plugin-$SCOPE"

if [ -d "$PLUGIN_DIR" ]; then
	echo "Plugin directory $PLUGIN_DIR already exists!"
	echo "This script should only be run once per scope."
	exit 1
fi

BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "This script will initialize an empty package for ${BLUE}${BOLD}$PLUGIN_PKG${NC}"
echo

echo -e "${BOLD}1. Creating plugin directory structure${NC}"
mkdir -p "$PLUGIN_DIR"
env cp LICENSE "$PLUGIN_DIR"
echo "Empty package" > "$PLUGIN_DIR/README.md"
cat > "$PLUGIN_DIR/package.json" <<EOF
{
  "name": "$PLUGIN_PKG",
  "version": "$(jq -r .version packages/base/package.json)",
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

echo -e "${BOLD}2. Running yarn install${NC}"
yarn install 2>&1 | sed 's/^/  /'

echo
echo -e "${GREEN}Package created successfully${NC}"
