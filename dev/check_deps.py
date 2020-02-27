#!/usr/bin/env python

"""
Make sure dependencies are advertised in LICENSE-3rdparty.csv
"""

import csv
from difflib import unified_diff
import json
import sys

with open("package.json") as pkg:
    package_json = json.loads(pkg.read())
    deps = sorted(
        package_json["devDependencies"].keys() + package_json["dependencies"].keys()
    )

with open("LICENSE-3rdparty.csv") as thirdparty:
    dr = csv.DictReader(thirdparty)
    declared_deps = sorted(row["Component"] for row in dr)

diff = "".join(
    unified_diff(
        [d + "\n" for d in deps],
        [d + "\n" for d in declared_deps],
        fromfile="package.json",
        tofile="LICENSE-3rdparty.csv",
    )
)

if not diff.strip():
    print("LICENSE-3rdparty.csv is consistent with dependencies in package.json")
else:
    print("LICENSE-3rdparty.csv is not consistent with dependencies in package.json")
    print(diff)
    sys.exit(1)
