const FILES: { [key: string]: string } = { };
module.exports = {
  _setFile: (path: string, file: string) => FILES[path] = file,
  promises: { readFile: (file: string) => Promise.resolve(FILES[file]) },
};
