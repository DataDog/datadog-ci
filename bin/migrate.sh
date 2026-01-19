#!/bin/bash

set -euo pipefail

if [ -z "$1" ]; then
  echo "Usage: $0 <scope>"
  exit 1
fi

if [[ $(uname -s) == "Darwin" ]]; then
  if ! command -v gsed >/dev/null 2>&1; then
    brew install gnu-sed
  fi
  export PATH="/opt/homebrew/opt/gnu-sed/libexec/gnubin:$PATH"

  if ! command -v sponge >/dev/null 2>&1; then
    brew install moreutils
  fi
fi

SCOPE="$1"
PLUGIN_PKG="@datadog/datadog-ci-plugin-$SCOPE"
PLUGIN_DIR="packages/plugin-$SCOPE"
SRC_DIR="packages/datadog-ci/src/commands/$SCOPE"
DST_DIR="$PLUGIN_DIR/src"
BASE_DIR="packages/base/src/commands/$SCOPE"

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check that init-package.sh was run first
if [ ! -d "$PLUGIN_DIR" ]; then
  echo -e "${RED}Plugin directory ${BOLD}$PLUGIN_DIR${NC} does not exist!${NC}"
  echo
  echo -e "${BLUE}Please run ${BOLD}yarn plugin:create $SCOPE${NC} to initialize the package."
  exit 1
fi

# Check that this script wasn't already run (tsconfig.json is created by migrate.sh)
if [ -f "$PLUGIN_DIR/tsconfig.json" ]; then
  echo -e "${RED}Plugin directory ${BOLD}$PLUGIN_DIR${NC}${RED} already has a tsconfig.json file!${NC}"
  echo
  echo -e "${BLUE}This indicates the package was already migrated.${NC}"
  exit 1
fi

echo 1. Move the folder
if [ ! -d "$SRC_DIR" ]; then
  echo "Source directory $SRC_DIR does not exist!"
  exit 1
fi
if [ -d "$DST_DIR" ]; then
  echo "Destination directory $DST_DIR already exists!"
  echo "You can run \`rm -rf packages/plugin-$SCOPE/src && rm -rf $BASE_DIR\` to clean up a previous run of this script."
  exit 1
fi
env mv "$SRC_DIR" "$DST_DIR"
env mv "$DST_DIR/README.md" "$PLUGIN_DIR"
mkdir -p "$BASE_DIR"
mv "$DST_DIR/cli.ts" "$BASE_DIR/cli.ts"

echo "Moved $SRC_DIR to $DST_DIR"

echo 2. Create tsconfig.json
cat > "$PLUGIN_DIR/tsconfig.json" <<EOF
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src"]
}
EOF

echo "Created $PLUGIN_DIR/tsconfig.json"

echo 3. Add "$PLUGIN_PKG" to dependencies and peerDependencies.
yarn workspace @datadog/datadog-ci add -E "$PLUGIN_PKG"
yarn workspace @datadog/datadog-ci-base add -E -P -O "$PLUGIN_PKG"
jq 'del(.optionalDependencies)' packages/base/package.json | sponge packages/base/package.json
yarn
echo Done

print-files() {
  git ls-files ':!:*symlink*' ":!:$SRC_DIR/*" "${1:-.}"
}

echo 4. Update string references
git add -A
print-files | xargs sed -i -e "s|packages/datadog-ci/src/commands/$SCOPE/README.md|$PLUGIN_DIR/README.md|g"
print-files | xargs sed -i -e "s|packages/datadog-ci/src/commands/$SCOPE/|$PLUGIN_DIR/|g"
print-files "$PLUGIN_DIR" | xargs sed -i -e "s|src/commands/$SCOPE/|src/|g"
echo Updating known shared imports...
print-files "$DST_DIR" | xargs sed -i -e "s|import {cliVersion} from '../../version'|import {cliVersion} from '@datadog/datadog-ci/src/version'|g"
echo Done

echo 5. Update CODEOWNERS
CODEOWNERS=$(grep "$SRC_DIR" .github/CODEOWNERS | sed 's|\s\+| |g' | cut -d' ' -f 2-)
sed -i -e "s|$SRC_DIR|$PLUGIN_DIR   $CODEOWNERS\n$BASE_DIR|" .github/CODEOWNERS
echo Done

echo "6. Run \`yarn lint:packages --fix\`"
yarn lint:packages --fix

if yarn workspace @datadog/datadog-ci-base build && yarn workspace "$PLUGIN_PKG" build && yarn workspace "$PLUGIN_PKG" lint --fix; then
  echo -e "${GREEN}Done${NC}"
else
  echo -e "${RED}Linting failed. Please fix the issues manually.${NC}"
fi
git add -A

echo
echo -e "${BOLD}Manual steps remaining:${NC}"
echo -e "- ${BLUE}Commit${NC} the changes, then make the following manual changes."
echo -e "- Move any shared helpers to ${BLUE}@datadog/datadog-ci-base${NC} if needed."
echo -e "- Split FooCommand/PluginCommand classes as described in ${BLUE}https://datadoghq.atlassian.net/wiki/spaces/dtdci/pages/5472846600/How+to+Split+a+command+scope+into+a+plugin+package#Refactor${NC}"
echo -e "- Run ${BLUE}yarn build${NC} and ${BLUE}yarn lint${NC} as needed to ensure everything works."
echo -e "- ${BOLD}Important:${NC} Update any outdated links in the Documentation repo. See ${BLUE}https://datadoghq.atlassian.net/wiki/spaces/dtdci/pages/5472846600/How+to+Split+a+command+scope+into+a+plugin+package#Update-links-pointing-to-the-package${NC}"