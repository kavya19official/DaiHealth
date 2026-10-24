"""Allow running this suite both from its Make target and from the repo root."""
import sys
from pathlib import Path
root=str(Path(__file__).resolve().parents[1])
if root not in sys.path:sys.path.insert(0,root)
