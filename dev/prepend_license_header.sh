#!/bin/bash

# The header to prepend to each file
HEADER=$(cat <<-END
// Unless explicitly stated otherwise all files in this repository are licensed
// under the Apache License Version 2.0.
// This product includes software developed at Datadog (https://www.datadoghq.com/).
// Copyright 2019-Present Datadog, Inc.
END
)

# The folders whose files must be prepended with the header
FOLDERS=(
    "dist"
)

# The file extensions for which the header must be set
EXTENSIONS=(
    ".js"
)

IS_OK=0

for folder in "${FOLDERS[@]}"; do
    for extension in "${EXTENSIONS[@]}"; do
        for file in $(find $folder -name "*$extension"); do
            if ! grep -q "$HEADER" $file; then
                if [ "$1" == "--fix" ]; then
                    # In fix mode, files will be automatically prepended
                    echo "Prepending header to $file"
                    (echo "$HEADER"; echo; cat $file) >> $file.$$
                    mv $file.$$ $file
                else
                    echo "$file has no license header! You can fix it by running: ./dev/prepend_license_header.sh --fix"
                    IS_OK=1
                fi
            fi
        done
    done
done

exit $IS_OK
