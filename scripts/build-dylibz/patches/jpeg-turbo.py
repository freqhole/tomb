#!/usr/bin/env python3
"""patches a homebrew formula's extracted .rb file in place.

invoked as: python3 jpeg-turbo.py <path-to-jpeg-turbo.rb>

jpeg-turbo's own `install` method runs its full ctest suite
unconditionally (not gated behind `brew test`, no CLI flag to skip it)
at full CPU parallelism - "tjunittest-shared-yuv (Subprocess aborted)"
failed under that load (confirmed real 2026-10-08, 663/664 other tests
passed) - the same class of bug homebrew-core's own mbedtls formulae
document and fix the same way ("Running tests in parallel causes
failures", see Formula/m/mbedtls.rb's own comment upstream). this
patches just this one formula to run its tests serially instead of
skipping them outright.

exits non-zero (without modifying the file) if the expected line isn't
found - e.g. if a future jpeg-turbo formula update changes this ctest
invocation - so a stale patch fails loudly instead of silently
no-op'ing or corrupting the file. matches a loosely-formatted regex
rather than one exact full-line string: confirmed real 2026-10-08 that
different homebrew-core tap commits wrap this line differently
(whitespace/line-break placement varies even though the actual tokens
are identical), so only the semantically-important fragment
(`"--parallel", ENV.make_jobs`) needs to match, not the whole line.
"""

import re
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

pattern = re.compile(r'"--parallel",\s*ENV\.make_jobs')
new = '"--parallel", "1"'

if not pattern.search(content):
    print(f"jpeg-turbo.py: expected ctest pattern not found in {path} - formula may have changed upstream", file=sys.stderr)
    print("jpeg-turbo.py: actual lines mentioning ctest/parallel in that file:", file=sys.stderr)
    for line in content.splitlines():
        if "ctest" in line or "parallel" in line:
            print(f"  {line!r}", file=sys.stderr)
    sys.exit(1)

content = pattern.sub(new, content, count=1)
with open(path, "w") as f:
    f.write(content)
