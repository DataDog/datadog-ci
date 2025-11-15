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

echo 1. Move the folder
if [ ! -d "$SRC_DIR" ]; then
  echo "Source directory $SRC_DIR does not exist!"
  exit 1
fi
if [ -d "$DST_DIR" ]; then
  echo "Destination directory $DST_DIR already exists!"
  echo "You can run \`rm -rf packages/plugin-$SCOPE && rm -rf $BASE_DIR\` to clean up a previous run of this script."
  exit 1
fi
mkdir -p "$PLUGIN_DIR"
env mv "$SRC_DIR" "$DST_DIR"
env mv "$DST_DIR/README.md" "$PLUGIN_DIR"
env cp LICENSE "$PLUGIN_DIR"
mkdir -p "$BASE_DIR"
mv "$DST_DIR/cli.ts" "$BASE_DIR/cli.ts"

echo "Moved $SRC_DIR to $DST_DIR"

echo 2. Create package.json
cat > "$PLUGIN_DIR/package.json" <<EOF
{
  "name": "$PLUGIN_PKG",
  "version": "$(jq -r .version packages/base/package.json)",
  "license": "Apache-2.0",
  "description": "Datadog CI plugin for \`$SCOPE\` commands",
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
  },
  "dependencies": {
    "axios": "^1.12.1",
    "chalk": "3.0.0",
    "clipanion": "^3.2.1",
    "fast-xml-parser": "^4.4.1",
    "form-data": "^4.0.4",
    "jest-diff": "^30.0.4",
    "js-yaml": "4.1.1",
    "ora": "5.4.1",
    "semver": "^7.5.3",
    "simple-git": "3.16.0",
    "typanion": "^3.14.0",
    "upath": "^2.0.1",
    "uuid": "^9.0.0"
  }
}
EOF

echo "Created $PLUGIN_DIR/package.json"

echo 3. Create tsconfig.json
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

echo 4. Add "$PLUGIN_PKG" to dependencies and peerDependencies.
yarn workspace @datadog/datadog-ci add -E "$PLUGIN_PKG"
yarn workspace @datadog/datadog-ci-base add -E -P -O "$PLUGIN_PKG"
jq 'del(.optionalDependencies)' packages/base/package.json | sponge packages/base/package.json
yarn
echo Done

print-files() {
  git ls-files ':!:*symlink*' ":!:$SRC_DIR/*" "${1:-.}"
}

echo 5. Update string references
git add -A
print-files | xargs sed -i -e "s|packages/datadog-ci/src/commands/$SCOPE/README.md|$PLUGIN_DIR/README.md|g"
print-files | xargs sed -i -e "s|packages/datadog-ci/src/commands/$SCOPE/|$PLUGIN_DIR/|g"
print-files "$PLUGIN_DIR" | xargs sed -i -e "s|src/commands/$SCOPE/|src/|g"
echo Updating known shared imports...
print-files "$DST_DIR" | xargs sed -i -e "s|import {cliVersion} from '../../version'|import {cliVersion} from '@datadog/datadog-ci/src/version'|g"
echo Done

echo 6. Update CODEOWNERS
CODEOWNERS=$(grep "$SRC_DIR" .github/CODEOWNERS | sed 's|\s\+| |g' | cut -d' ' -f 2-)
sed -i -e "s|$SRC_DIR|$PLUGIN_DIR   $CODEOWNERS\n$BASE_DIR|" .github/CODEOWNERS
echo Done

echo "7. Run \`yarn lint:packages --fix\`"
yarn lint:packages --fix

if yarn workspace @datadog/datadog-ci-base build && yarn workspace "$PLUGIN_PKG" build && yarn workspace "$PLUGIN_PKG" lint --fix; then
  echo Done
else
  echo "Linting failed. Please fix the issues manually."
fi
git add -A

echo
echo "Manual steps remaining:"
echo "- Commit the changes, then make the following manual changes:"
echo "- Move any shared helpers to @datadog/datadog-ci-base if needed."
echo "- Split FooCommand/PluginCommand classes as described in https://datadoghq.atlassian.net/wiki/spaces/dtdci/pages/5472846600/How+to+Split+a+command+scope+into+a+plugin+package#Refactor"
echo "- Run yarn build and yarn lint as needed to ensure everything works."
echo "- **Important:** Update any outdated links in the Documentation repo. See https://datadoghq.atlassian.net/wiki/spaces/dtdci/pages/5472846600/How+to+Split+a+command+scope+into+a+plugin+package#Update-links-pointing-to-the-package"