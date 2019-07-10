const GLOBS: { [key: string]: string[] } = { };
module.exports = {
  _setGlobs: (GLOB: string, files: string[]) => {
    GLOBS[GLOB] = files;
  },
  glob: (GLOB: string, cb: (err: Error | undefined, data: any) => void) => cb(undefined, GLOBS[GLOB]),
};
