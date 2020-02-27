import chalk from 'chalk';

import { ConfigOverride, PollResult, Step, Test, TestComposite } from './interfaces';
import { hasResultPassed, hasTestSucceeded } from './utils';

const renderStep = (step: Step) => {
  const icon = step.error
    ? chalk.bold.red('✖')
    : step.skipped
    ? chalk.bold.yellow('⇢')
    : chalk.bold.green('✓');
  const value = step.value ? `\n      ${chalk.dim(step.value)}` : '';
  const error = step.error ? `\n      ${chalk.red.dim(step.error)}` : '';
  const colorDuration: (arg: any) => string =
    step.duration > 10000
      ? chalk.bold.red
      : step.duration > 5000
      ? chalk.bold.yellow
      : chalk.bold;
  const duration = `${colorDuration(step.duration)}ms`;

  return `    ${icon} | ${duration} - ${step.description}${value}${error}`;
};

export const renderSteps = (test: TestComposite, baseUrl: string) => {
  test.results.forEach((r: PollResult) => {
    const resultUrl = `${baseUrl}/synthetics/details/${test.public_id}/result/${r.resultID}`;
    const success = hasResultPassed(r);
    const color = success ? chalk.green : chalk.red;
    const icon = success ? chalk.bold.green('✓') : chalk.bold.red('✖');
    const device = test.type === 'browser' ? ` - device: ${chalk.bold(r.result.device.id)}` : '';
    const resultIdentification = color(`  ${icon} location: ${chalk.bold(r.dc_id.toString())}${device}`);
    let steps = '';

    if (r.result.error) {
      steps = `\n    ${chalk.red.bold(`✖ | ${r.result.error}`)}`;
    } else if (test.type === 'api') {
      const req = test.config.request;
      const requestText = `${chalk.bold(req.method)} - ${req.url}`;
      const errors = success
        ? ''
        : color(`\n      [${chalk.bold(r.result.errorCode!)}] - ${chalk.dim(r.result.errorMessage!)}`);

      steps = `\n    ${icon} ${color(requestText)}${errors}`;
    } else if (test.type === 'browser' && !hasResultPassed(r)) {
      // We render the step only if the test hasn't passed to avoid cluttering the output.
      steps = `\n${r.result.stepDetails.map(renderStep).join('\n')}`;
    }
    console.log(`${resultIdentification}\n    ⎋  ${chalk.dim.cyan(resultUrl)}${steps}`);
  });
};

export const renderResult = (test: TestComposite, baseUrl: string) => {
  const success = hasTestSucceeded(test);
  const icon = success ? chalk.bold.green('✓') : chalk.bold.red('✖');
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
  const nameColor = success ? chalk.bold.green : chalk.bold.red;

  console.log(`${icon} ${idDisplay} | ${nameColor(test.name)}`);

  if (!success) {
    renderSteps(test, baseUrl);
  }
};

export const renderTrigger = (test: Test | undefined, testId: string, config: ConfigOverride) => {
  const idDisplay = `[${chalk.bold.dim(testId)}]`;
  let message;

  if (!test) {
    message = chalk.red.bold(`Could not find test "${testId}"`);
  } else if (config.skip) {
    message = `>> Skipped test "${chalk.yellow.dim(test.name)}"`;
  } else {
    message = `Trigger test "${chalk.green.bold(test.name)}"`;
  }

  console.log(
    `${idDisplay} ${message}`
  );
};

export const renderHeader = (tests: TestComposite[], timings: { startTime: number }) => {
  const currentTime = Date.now();
  console.log(`\n\n${chalk.bold.cyan('=== REPORT ===')}
Took ${chalk.bold((currentTime - timings.startTime).toString())}ms\n\n`);
};

export const renderWait = (test: Test) => {
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
  console.log(
    `${idDisplay} Waiting results for "${chalk.green.bold(
      test.name
    )}"`
  );
};
