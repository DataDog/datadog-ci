// Source of exports_with_pdb_arm64.dll: an ARM64 DLL with a large frame and a __try/__except
// function, so its .xdata has an exception handler. Built with LLVM:
//
//   clang-cl --target=aarch64-pc-windows-msvc /c /Z7 /O1 /GS- /Foexports_with_pdb_arm64.obj -- exports_with_pdb_arm64.c
//   lld-link /machine:arm64 /dll /noentry /nodefaultlib /debug:full /pdbaltpath:exports_with_pdb_arm64.pdb \
//     /out:exports_with_pdb_arm64.dll /pdb:exports_with_pdb_arm64.pdb exports_with_pdb_arm64.obj
//
// `llvm-readobj --unwind exports_with_pdb_arm64.dll` lists the .xdata records used by the tests.

typedef struct {
  int unused;
} EXCEPTION_RECORD;

// Stand-in for the CRT handler, so the DLL links without default libraries.
int __C_specific_handler(EXCEPTION_RECORD *record, void *frame, void *context, void *dispatcher) { return 1; }

__declspec(noinline) int leaf(int x) { return x * 3 + 1; }

__declspec(noinline) int framed(int x) {
  volatile char buf[600];
  buf[x & 511] = (char)x;
  return leaf(buf[x & 255]) + leaf(x);
}

__declspec(dllexport) int guarded(int x) {
  int r = 0;
  __try {
    r = framed(x);
  } __except (1) {
    r = -1;
  }
  return r;
}
