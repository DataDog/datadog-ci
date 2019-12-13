import { Suite } from '../interfaces';

let SUITES: Suite[] = [];

module.exports = {
  _setSuites: (suites: Suite[]) => { SUITES = suites; },
  getSuites: () => Promise.resolve(SUITES),
};
