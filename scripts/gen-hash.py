#!/usr/bin/env python3
"""Compute the sha224 import pin of Sobamail module files.

  gen-hash.py FILE...    print the ?sha224= value (url-safe base64, no padding)
                         and the base32hex form for each file

Both encodings are accepted in import statements; keep the one the import already
uses. Prints only; update the imports yourself after every module change.
"""

import base64
import hashlib
import sys


def digests(path):
    d = hashlib.sha224(open(path, "rb").read()).digest()
    return (base64.urlsafe_b64encode(d).rstrip(b"=").decode(),
            base64.b32hexencode(d).rstrip(b"=").decode())


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    for f in argv:
        b64, b32 = digests(f)
        print(f"{f}\n  ?sha224={b64}\n  b32hex  {b32}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
