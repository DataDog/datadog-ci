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

echo 1. Move the folder
if [ ! -d "$SRC_DIR" ]; then
  echo "Source directory $SRC_DIR does not exist!"
  exit 1
fi
mkdir -p "$PLUGIN_DIR"
env mv "$SRC_DIR" "$DST_DIR"
env mv "$DST_DIR/README.md" "$PLUGIN_DIR"
env cp LICENSE "$PLUGIN_DIR"

echo "Moved $SRC_DIR to $DST_DIR"

echo 2. Create package.json
cat > "$PLUGIN_DIR/package.json" <<EOF
{
  "name": "$PLUGIN_PKG",
  "version": "$(jq -r .version packages/base/package.json)",
  "license": "Apache-2.0",
  "description": "Datadog CI plugin for `$SCOPE` commands",
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
    "@aws-sdk/client-cloudwatch-logs": "^3.709.0",
    "@aws-sdk/client-iam": "^3.709.0",
    "@aws-sdk/client-lambda": "^3.709.0",
    "@aws-sdk/client-sfn": "^3.709.0",
    "@aws-sdk/credential-provider-ini": "^3.709.0",
    "@aws-sdk/credential-providers": "^3.709.0",
    "@azure/arm-appservice": "^16.0.0",
    "@azure/arm-resources": "^6.1.0",
    "@azure/identity": "^4.10.1",
    "@google-cloud/logging": "^11.2.0",
    "@google-cloud/run": "^3.0.0",
    "@smithy/property-provider": "^2.0.12",
    "@smithy/util-retry": "^2.0.4",
    "ajv": "^8.12.0",
    "ajv-formats": "^2.1.1",
    "axios": "^1.11.0",
    "chalk": "3.0.0",
    "clipanion": "^3.2.1",
    "deep-object-diff": "^1.1.9",
    "fast-deep-equal": "^3.1.3",
    "fast-xml-parser": "^4.4.1",
    "form-data": "^4.0.4",
    "fuzzy": "^0.1.3",
    "google-auth-library": "^10.2.1",
    "inquirer": "^8.2.5",
    "inquirer-checkbox-plus-prompt": "^1.4.2",
    "jest-diff": "^30.0.4",
    "js-yaml": "3.13.1",
    "ora": "5.4.1",
    "packageurl-js": "^2.0.1",
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

echo 6. Add plugin folder to tsconfig.json and packages/datadog-ci/tsconfig.json
sed -i -e 's|in the future.|in the future.\n    {\n      "path": "./'"${PLUGIN_DIR}"'"\n    },|g' tsconfig.json
sed -i -e 's|Add Plugins Here:|Add Plugins Here:\n    {\n      "path": "../'"plugin-$SCOPE"'"\n    },|g' packages/datadog-ci/tsconfig.json
echo Done

echo 7. Update CI configuration

CI_FILE=".github/workflows/ci.yml"
BASE_LINE='"@datadog/datadog-ci-base": "file:./artifacts/@datadog-datadog-ci-base-${{ matrix.version }}.tgz",'
PLUGIN_LINE="              \"$PLUGIN_PKG\": \"file:./artifacts/@datadog-datadog-ci-plugin-$SCOPE-\${{ matrix.version }}.tgz\","

if grep -q "$BASE_LINE" "$CI_FILE"; then
  # Insert the plugin package line after the datadog-ci-base line in ci.yml
  sed -i -e "s|$BASE_LINE|$BASE_LINE\\n$PLUGIN_LINE|" "$CI_FILE"
  echo "Updated .github/workflows/ci.yml to include $PLUGIN_PKG"
else
  echo "Could not find base line in .github/workflows/ci.yml -- please add the following line manually:
$PLUGIN_LINE" 
fi

echo 8. Update CODEOWNERS
CODEOWNERS=$(grep "$SRC_DIR" .github/CODEOWNERS | sed 's|\s\+| |g' | cut -d' ' -f 2-)
sed -i -e "s|$SRC_DIR|$PLUGIN_DIR   $CODEOWNERS\npackages/base/src/commands/$SCOPE|" .github/CODEOWNERS
echo Done

echo 9. Check if we can automatically knip
yarn install
if yarn workspace @datadog/datadog-ci-base build && yarn workspace "$PLUGIN_PKG" build && yarn workspace "$PLUGIN_PKG" lint --fix; then
  echo "Linting passed, running knip..."
  yarn knip || true
  yarn
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
echo "- Run yarn build, yarn lint, and yarn knip as needed to ensure everything works."
echo "- Update packages/datadog-ci/shims/injected-plugin-submodules.js"