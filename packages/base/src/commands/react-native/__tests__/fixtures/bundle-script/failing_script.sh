#!/bin/sh

echo "Starting failing script"
>&2 echo "Custom error message from script"

exit 1