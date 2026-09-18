#!/bin/bash

set -euo pipefail

script="$(cd "$(dirname "$0")/.." && pwd)/wait-for-npm-packages.sh"
test_root=$(mktemp -d)
trap 'rm -rf "$test_root"' EXIT
export TEST_ROOT="$test_root"
export PATH="$test_root/bin:$PATH"
mkdir -p "$test_root/bin" "$test_root/base" "$test_root/plugin"
cd "$test_root"

echo '{"name":"@datadog/datadog-ci-base","version":"1.2.3"}' > base/package.json
echo '{"name":"@datadog/datadog-ci-plugin-example","version":"2.3.4"}' > plugin/package.json
cat > workspaces.jsonl <<'EOF'
{"name":"@datadog/datadog-ci-base","location":"base"}
{"name":"@datadog/datadog-ci-plugin-example","location":"plugin"}
{"name":"@datadog/datadog-ci","location":"cli-must-not-be-read"}
EOF

cat > bin/yarn <<'EOF'
#!/bin/bash
set -euo pipefail
[[ "$*" == 'workspaces list --json --no-private' ]] || exit 1
[[ "$SCENARIO" != workspace-error ]] || exit 1
cat "$TEST_ROOT/workspaces.jsonl"
EOF

cat > bin/sleep <<'EOF'
#!/bin/bash
echo "$*" >> "$TEST_ROOT/sleeps"
EOF

cat > bin/curl <<'EOF'
#!/bin/bash
set -euo pipefail
echo "$*" >> "$TEST_ROOT/requests"
case "${!#}" in
  https://registry.npmjs.org/@datadog%2fdatadog-ci-base)
    echo '{"versions":{"1.2.3":{"version":"1.2.3"}}}'
    exit 0
    ;;
  https://registry.npmjs.org/@datadog%2fdatadog-ci-plugin-example) ;;
  *) echo "Unexpected registry URL: ${!#}" >&2; exit 1 ;;
esac

case "$SCENARIO" in
  missing) echo '{"versions":{"2.3.3":{"version":"2.3.3"}}}'; exit 0 ;;
  invalid) echo 'invalid JSON'; exit 0 ;;
  empty) exit 0 ;;
  delayed-full)
    if [ ! -f "$TEST_ROOT/sleeps" ]; then
      echo '{"versions":{}}'
      exit 0
    fi
    ;;
  delayed-install)
    if [[ "$*" == *application/vnd.npm.install-v1+json* ]] && [ ! -f "$TEST_ROOT/sleeps" ]; then
      echo '{"versions":{}}'
      exit 0
    fi
    ;;
  network-error)
    if [ ! -f "$TEST_ROOT/sleeps" ]; then
      exit 22
    fi
    ;;
esac
echo '{"versions":{"2.3.4":{"version":"2.3.4"}}}'
EOF
chmod +x bin/*

for scenario in ready delayed-full delayed-install network-error missing invalid empty workspace-error; do
  export SCENARIO="$scenario"
  rm -f sleeps requests
  status=0
  bash "$script" > output 2>&1 || status=$?
  case "$scenario" in
    ready)
      [[ "$status" == 0 && ! -f sleeps ]] || { cat output; exit 1; }
      [[ $(wc -l < requests) -eq 4 ]] || exit 1
      ;;
    delayed-full|delayed-install|network-error)
      [[ "$status" == 0 && $(wc -l < sleeps) -eq 1 ]] || { cat output; exit 1; }
      ;;
    missing|invalid|empty)
      [[ "$status" == 1 && $(wc -l < sleeps) -eq 39 ]] || { cat output; exit 1; }
      grep -q 'datadog-ci will not be published' output
      grep -q '@datadog/datadog-ci-plugin-example@2.3.4' output
      ;;
    workspace-error)
      [[ "$status" != 0 && ! -f requests ]] || { cat output; exit 1; }
      ;;
  esac
  echo "PASS: $scenario"
done
