import json
from pathlib import Path
import sys
from results import summarize

root, data, judgments = map(Path, sys.argv[1:4])
print(json.dumps(summarize(root, data, judgments), indent=2, allow_nan=False))
