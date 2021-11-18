#!/usr/bin/env bash
set -e

REPO_BASE_URL="https://github.com/DataDog/datadog-ci"
INSTALL_PATH="/usr/local/bin/datadog-ci"

function download {
    detect_os
    curl -L --fail "$REPO_BASE_URL/releases/latest/download/datadog-ci-$os_suffix" --output $INSTALL_PATH
    chmod +x $INSTALL_PATH
}

function detect_os {
    case "$OSTYPE" in
        linux*)   os_suffix="linux" ;;
        darwin*)  os_suffix="macos" ;;
        *)        echo "unsupported OS: $OSTYPE"; exit 1 ;;
    esac
}

if ![ -x $INSTALL_PATH ]; then download ; fi
