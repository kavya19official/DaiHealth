"""Portable entry point, reusing scikit-learn's bundled OpenMP on macOS if needed."""
import importlib.util,os,sys,sysconfig
from pathlib import Path
root=Path(__file__).resolve().parent
os.chdir(root)
if sys.platform=='darwin' and not os.environ.get('DAI_ML_RUNTIME_READY'):
    omp=Path(sysconfig.get_paths()['purelib'])/'sklearn/.dylibs'
    if (omp/'libomp.dylib').exists():
        env=dict(os.environ,DAI_ML_RUNTIME_READY='1',DYLD_LIBRARY_PATH=str(omp)+(':'+os.environ['DYLD_LIBRARY_PATH'] if os.environ.get('DYLD_LIBRARY_PATH') else ''))
        os.execve(sys.executable,[sys.executable,str(__file__),*sys.argv[1:]],env)
os.execv(sys.executable,[sys.executable,*sys.argv[1:]])
