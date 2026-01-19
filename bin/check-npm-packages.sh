#!/bin/bash

set -euo pipefail

# This script checks if all local packages are published to NPM.
# It can also first-time publish missing packages when run with --fix.
#
# Usage:
#   ./bin/check-npm-packages.sh                  # Check mode (default) - exits 1 if packages are missing
#   ./bin/check-npm-packages.sh --fix            # Fix mode - publishes missing packages
#   ./bin/check-npm-packages.sh --fix --dry-run  # Fix mode with dry-run - simulates publishing

MODE="check"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
	case $1 in
	--fix)
		MODE="fix"
		shift
		;;
	--dry-run)
		DRY_RUN=true
		shift
		;;
	-*)
		echo "Unknown option: $1"
		echo "Usage: $0 [--fix] [--dry-run]"
		exit 1
		;;
	*)
		echo "Unknown argument: $1"
		echo "Usage: $0 [--fix] [--dry-run]"
		exit 1
		;;
	esac
done

if [ "$DRY_RUN" = true ] && [ "$MODE" != "fix" ]; then
	echo "Error: --dry-run can only be used with --fix"
	exit 1
fi

# Colors
BOLD='\033[1m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}Checking for unpublished packages...${NC}"
echo

# Get local and remote packages
local_packages=$(yarn workspaces list --json --no-private | jq -r '.name' | sort)
remote_packages=$(npm search 'maintainer:datadog keywords:datadog-ci' --json | jq -r '.[].name' | sort)

# Find packages that exist locally but not on NPM
missing_packages=()
while IFS= read -r pkg; do
	if [ -n "$pkg" ] && ! echo "$remote_packages" | grep -q "^${pkg}$"; then
		missing_packages+=("$pkg")
	fi
done <<< "$local_packages"

if [ ${#missing_packages[@]} -eq 0 ]; then
	echo -e "${GREEN}All local packages exist on NPM ✅${NC}"
	exit 0
fi

# Report missing packages
echo -e "${RED}The following packages are not published to NPM yet:${NC}"
for pkg in "${missing_packages[@]}"; do
	echo "  - $pkg"
done

echo "debug: GITHUB_REPOSITORY=$GITHUB_REPOSITORY"
echo "debug: GITHUB_SHA=$GITHUB_SHA"

# In CI environment, post a comment on the PR
if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_REPOSITORY:-}" ] && [ -n "${GITHUB_SHA:-}" ]; then
	# Find the PR associated with this commit
	PR_NUMBER=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
		"https://api.github.com/repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" \
		| jq -r '.[0].number // empty')

	echo "debug: PR_NUMBER=$PR_NUMBER"

	if [ -n "$PR_NUMBER" ]; then
		DIFF_OUTPUT=$(diff -u --label "Published packages (Actual)" --label "Local packages (Expected)" \
			<(echo "$remote_packages") <(echo "$local_packages")) || true

		COMMENT_BODY="### Some local packages were not published to NPM yet ❌

\`\`\`diff
$DIFF_OUTPUT
\`\`\`

**Please follow the instructions** at https://datadoghq.atlassian.net/wiki/x/QYDRaQE"

		# Post comment on the PR
		curl -s -X POST \
			-H "Authorization: token $GITHUB_TOKEN" \
			-H "Accept: application/vnd.github.v3+json" \
			"https://api.github.com/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
			-d "$(jq -n --arg body "$COMMENT_BODY" '{body: $body}')" > /dev/null

		echo -e "${BLUE}Posted comment on PR #$PR_NUMBER${NC}"
	else
		echo "debug: No PR found for commit $GITHUB_SHA"
	fi
fi

if [ "$MODE" = "check" ]; then
	echo
	echo -e "${BOLD}Run with --fix to publish these packages${NC}"
	echo -e "See instructions at ${BLUE}https://datadoghq.atlassian.net/wiki/x/QYDRaQE${NC}"
	exit 1
fi

# Fix mode - publish missing packages
echo
echo -e "${BOLD}Publishing missing packages to NPM...${NC}"
echo
echo -e "${BOLD}Please read the instructions${NC} at ${BLUE}https://datadoghq.atlassian.net/wiki/x/QYDRaQE${NC} before proceeding."
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

for pkg in "${missing_packages[@]}"; do
	echo -e "${BLUE}Publishing ${BOLD}$pkg${NC}${BLUE}...${NC}"

	# Get the package directory
	pkg_dir=$(yarn workspaces list --json | jq -r "select(.name == \"$pkg\") | .location")
	pkg_json="$pkg_dir/package.json"

	# Save original version
	original_version=$(jq -r .version "$pkg_json")

	# Set version to 0.0.1 for first-time publish
	jq '.version = "0.0.1"' "$pkg_json" | sponge "$pkg_json"

	if [ "$DRY_RUN" = true ]; then
		echo "  [DRY-RUN] Would publish $pkg@0.0.1"
		yarn workspace "$pkg" npm publish --dry-run 2>&1 | sed 's/^/  /'
	else
		yarn workspace "$pkg" npm publish 2>&1 | sed 's/^/  /'
		echo -e "  ${GREEN}Successfully published $pkg@0.0.1${NC}"
	fi

	# Restore original version
	jq --arg version "$original_version" '.version = $version' "$pkg_json" | sponge "$pkg_json"
	echo
done

echo -e "${BOLD}Cleaning up...${NC}"
yarn config unset npmAuthToken

echo
if [ "$DRY_RUN" = true ]; then
	echo -e "${GREEN}[DRY-RUN] Would have published ${#missing_packages[@]} package(s)${NC}"
else
	echo -e "${GREEN}Successfully published ${#missing_packages[@]} package(s)${NC}"
fi
