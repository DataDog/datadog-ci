export const replaceForwardSlashes = (unsafeFileName: string) => unsafeFileName.replace(/\//g, '\\')

// We need a unique file name so we use span tags like the pipeline URL,
// which can contain dots and other unsafe characters for filenames.
// We filter them out here.
export const getSafeFileName = (unsafeFileName: string) => unsafeFileName.replace(/[^a-z0-9]/gi, '_')
