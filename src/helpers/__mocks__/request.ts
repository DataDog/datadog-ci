const MOCKS: { [key: string]: any } = { };
const _mockRequest = (path: string, mock: any): void => {
  MOCKS[path] = mock;
};

module.exports = {
  _mockRequest,
  requestConstructor: () => ({
    endpoint,
  }: { endpoint: string }) => MOCKS[endpoint],
};
