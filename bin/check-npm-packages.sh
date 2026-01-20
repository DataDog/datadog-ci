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
GITHUB_REPOSITORY=DataDog/datadog-ci

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

# Fetch PR information
PR_RESPONSE=""
PR_LABELS=""
if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_SHA:-}" ]; then
	PR_RESPONSE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
		"https://api.github.com/repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls")
	PR_LABELS=$(echo "$PR_RESPONSE" | jq '[.[0].labels[].name]' 2>/dev/null || true)

	echo -e "${BLUE}PR labels:${NC} $PR_LABELS"
	echo
fi

# Check the labels on the PR if any
# Required labels are checked by `.github/workflows/pr-required-labels.yml`
if [ -n "$PR_LABELS" ]; then
	# Fail if `Do Not Merge` is set
	if echo "$PR_LABELS" | grep -q "Do Not Merge"; then
		echo -e "${RED}This PR is marked as \"Do Not Merge\" ❌${NC}"
		exit 1
	fi

	# Fail if the PR has `oidc-setup-required ⚠️` WITHOUT `oidc-setup-done ✅`
	if echo "$PR_LABELS" | grep -q "oidc-setup-required ⚠️"; then
		if ! echo "$PR_LABELS" | grep -q "oidc-setup-done ✅"; then
			echo -e "${RED}This PR requires OIDC setup on some packages. Please ask an admin to follow the instructions at https://datadoghq.atlassian.net/wiki/x/QYDRaQE${NC}"
			exit 1
		else
			echo 'Continuing... No need to remove the `oidc-setup-required ⚠️` label.'
		fi
	else
		echo 'Continuing... for the `oidc-setup-required ⚠️` label to possibly be added.'
	fi
	echo
fi

# Everything is good.
if [ ${#missing_packages[@]} -eq 0 ]; then
	echo -e "${GREEN}All local packages exist on NPM ✅${NC}"
	exit 0
fi

# Otherwise, report missing packages
echo -e "${RED}The following packages are not published to NPM yet:${NC}"
for pkg in "${missing_packages[@]}"; do
	echo "  - $pkg"
done

# In CI environment, post a comment on the PR
if [ -n "${GITHUB_TOKEN:-}" ] && [ -n "${GITHUB_SHA:-}" ]; then
	PR_NUMBER=$(echo "$PR_RESPONSE" | jq -r '.[0].number // empty')
	PR_AUTHOR=$(echo "$PR_RESPONSE" | jq -r '.[0].user.login // empty')

	DIFF_OUTPUT=$(diff -u --label "Published packages (Actual)" --label "Local packages (Expected)" \
		<(echo "$remote_packages") <(echo "$local_packages")) || true

	COMMENT_BODY="### Some packages were not first-time published to NPM yet ❌

\`\`\`diff
$DIFF_OUTPUT
\`\`\`

Hi @$PR_AUTHOR, please **ask an admin** to follow the instructions at https://datadoghq.atlassian.net/wiki/x/QYDRaQE"

	if [ -n "$PR_NUMBER" ]; then
		# Post comment on the PR
		curl -s -X POST \
			-H "Authorization: token $GITHUB_TOKEN" \
			"https://api.github.com/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/comments" \
			-d "$(jq -n --arg body "$COMMENT_BODY" '{body: $body}')" > /dev/null

		echo -e "${BLUE}Posted comment on PR #$PR_NUMBER (author: @$PR_AUTHOR)${NC}"

		# Add the 'oidc-setup-required ⚠️' label to the PR
		curl -s -X POST \
			-H "Authorization: token $GITHUB_TOKEN" \
			"https://api.github.com/repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER/labels" \
			-d '{"labels":["oidc-setup-required ⚠️"]}' > /dev/null

		echo -e "${BLUE}Added 'oidc-setup-required ⚠️' label to PR #$PR_NUMBER${NC}"
	else
		# Fallback when PR is not found
		echo -e "${RED}No PR found for commit $GITHUB_SHA${NC}"
		echo -e "${BLUE}This would be the comment body:${NC}"
		echo "$COMMENT_BODY"
	fi
fi

# Do not continue if we are in check mode
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

if [ "$DRY_RUN" = true ]; then
	echo -e "${BOLD}[DRY-RUN]${NC} None of the packages will actually be published."
	echo
fi

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

echo
echo -e "${RED}${BOLD}⚠️  You are not done!${NC} Please setup OIDC on each package at the links below."
echo

for pkg in "${missing_packages[@]}"; do
	echo -e "  - Opening ${BLUE}https://www.npmjs.com/package/$pkg/access${NC}"
	open "https://www.npmjs.com/package/$pkg/access"
done
echo