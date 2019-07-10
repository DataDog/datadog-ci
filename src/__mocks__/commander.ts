const exportedObject: any = {
  _mockParam: (name: string, value: any): void => {
    exportedObject[name] = value;
  },
  option: () => exportedObject,
  parse: () => undefined,
};

module.exports = exportedObject;
