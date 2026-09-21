#!/bin/bash

set -euo pipefail

# Check the exact versions we just published, including plugins installed on demand.
# Keep this package selection in sync with `publish:deps`.
workspaces=$(yarn workspaces list --json --no-private)
locations=$(echo "$workspaces" | jq -r 'select(.name != "@datadog/datadog-ci") | .location')
packages=()
while IFS= read -r location; do
  [ -z "$location" ] && continue
  packages+=("$(jq -er '.name + "@" + .version' "$location/package.json")")
done <<< "$locations"

if [ ${#packages[@]} -eq 0 ]; then
  echo "No packages found to check on NPM." >&2
  exit 1
fi

max_attempts=40
retry_interval=15

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
  echo "Checking NPM availability (attempt $attempt/$max_attempts)..."
  pending=()
  for package in "${packages[@]}"; do
    name=${package%@*}
    version=${package##*@}
    url="https://registry.npmjs.org/${name/\//%2f}"
    available=true

    # Installation uses abbreviated metadata, which can lag behind full metadata.
    # Query both through the public cache, without authentication, local caching,
    # or cache-busting parameters that could hide the delay seen by users.
    for accept in application/json application/vnd.npm.install-v1+json; do
      if ! curl --fail --silent --show-error --compressed --max-time 10 --header "Accept: $accept" "$url" \
        | jq -se --arg version "$version" 'length == 1 and .[0].versions[$version].version == $version' > /dev/null; then
        echo "Waiting for $package ($accept)."
        available=false
        break
      fi
    done

    if [ "$available" = true ]; then
      echo "$package is available on NPM."
    else
      pending+=("$package")
    fi
  done

  if [ ${#pending[@]} -eq 0 ]; then
    echo "All base and plugin package versions are available on NPM."
    exit 0
  fi

  packages=("${pending[@]}")
  if [ "$attempt" -lt "$max_attempts" ]; then
    sleep "$retry_interval"
  fi
done

echo "NPM packages are still unavailable; datadog-ci will not be published:" >&2
printf '  %s\n' "${packages[@]}" >&2
exit 1
