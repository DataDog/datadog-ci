const MOCKS: { [key: string]: any } = { };
const _mockRequest = (path: string, mock: any): void => {
  MOCKS[path] = mock;
};

module.exports = {
  _mockRequest,
  defaults: () => ({ uri }: { uri: string }) => MOCKS[uri],
};
