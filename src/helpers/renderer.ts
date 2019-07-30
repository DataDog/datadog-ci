import chalk from 'chalk';

import { Result, Step, Test } from './interfaces';

const renderStep = (step: Step) => {
  const icon = step.error
    ? chalk.bold.red('✖')
    : step.skipped
    ? chalk.bold.yellow('⇢')
    : chalk.bold.green('✓');
  const value = step.value ? `\n\t\t${chalk.dim(step.value)}` : '';
  const error = step.error ? `\n\t\t${chalk.red.dim(step.error)}` : '';
  const colorDuration: (arg: any) => string =
    step.duration > 10000
      ? chalk.bold.red
      : step.duration > 5000
      ? chalk.bold.yellow
      : chalk.bold;
  const duration = `${colorDuration(step.duration)}ms`;
  console.log(
    `\t${icon} | ${duration} - ${step.description}${value}${error}`
  );
};

export const renderSteps = (test: Test, result: Result, resultId: string, url: string) => {
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
  const resultUrl = `${url}/synthetics/details/${test.public_id}/result/${resultId}`;
  console.log(`${idDisplay} ${chalk.green.bold(test.name)} (${chalk.bold.cyan(resultUrl)}) `);
  result.stepDetails.forEach(renderStep);
};

export const renderResult = (test: Test, result: Result) => {
  const icon = result.passed ? chalk.bold.green('✓') : chalk.bold.red('✖');
  const nameColor = result.passed ? chalk.bold.green : chalk.bold.red;
  const errors = result.stepDetails.reduce((accu, step) => {
    const error = step.error
      ? `\n\t${chalk.dim(step.value)}\n\t${chalk.red.dim(step.error)}`
      : '';

    return `${accu}${error}`;
  }, '');
  const duration = result.stepDetails.reduce(
    (accu, step) => accu + step.duration,
    0
  );
  console.log(`${icon} | ${duration}ms - ${nameColor(test.name)}${errors}`);
};

export const renderTrigger = (test: Test) => {
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
  console.log(
    `${idDisplay} Trigger test "${chalk.green.bold(test.name)}"`
  );
};

export const renderWait = (test: Test) => {
  const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
  console.log(
    `${idDisplay} Waiting results for "${chalk.green.bold(
      test.name
    )}"`
  );
};
