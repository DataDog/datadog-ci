#!/bin/sh

# Fix "detected dubious ownership in repository at '/w'" error
git config --global --add safe.directory /w

exec datadog-ci "$@"
