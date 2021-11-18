#!/usr/bin/env bash
set -e

REPO_BASE_URL="https://github.com/DataDog/datadog-ci"

function download {
    detect_os
    curl -L --fail "$REPO_BASE_URL/releases/download/latest/datadog-ci-$os_suffix" --output $1
    chmod +x $1
}

function detect_os {
    case "$OSTYPE" in
        linux*)   os_suffix="linux" ;;
        darwin*)  os_suffix="macos" ;;
        *)        echo "unsupported OS: $OSTYPE"; exit 1 ;;
    esac
}

bin="/tmp/datadog-ci"
if ! [ -x $bin ]; then download $bin; fi
$bin "$@"
