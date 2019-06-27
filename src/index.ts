/* eslint-disable no-console */

import chalk from 'chalk';
import { promises as fs } from 'fs';
import * as glob from 'glob';
import * as path from 'path';
import { promisify } from 'util';

import helpers from './helpers/dd-api';
import { Result, ResultContainer, Step, Suite, Test } from './helpers/interfaces';

const handleQuit = (stop: () => void) => {
    // Handle unexpected exits
    process.on('exit', stop);
    // catches ctrl+c event
    process.on('SIGINT', stop);
    // catches "kill pid" (for example: nodemon restart)
    process.on('SIGUSR1', stop);
    process.on('SIGUSR2', stop);
    // catches uncaught exceptions
    process.on('uncaughtException', stop);
};

const API_KEY = process.env.DD_API_KEY;
const APP_KEY = process.env.DD_APP_KEY;

if (!API_KEY || APP_KEY) {
    console.log(`Missing ${chalk.red.bold('DD_API_KEY')} and/or ${chalk.red.bold('DD_APP_KEY')} in your environment.`);
}

const stopIntervals = (interval: NodeJS.Timeout, timeout: NodeJS.Timeout): void => {
    clearInterval(interval);
    clearTimeout(timeout);
};

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

const renderResult = (test: Test, result: Result) => {
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

const main = async () => {
    const BASE_URL = 'https://dd.datad0g.com/api/v1';

    const { getTestResults, triggerTests, getTest } = helpers({
        apiKey: API_KEY!,
        appKey: APP_KEY!,
        baseUrl: BASE_URL,
    });
    const suites: Suite[][] = await promisify(glob)(
        path.join(__dirname, './tests/**/*.synthetics.json')
    )
        .then((files: string[]) => files.map((test) => fs.readFile(test, 'utf8')))
        .then((promises: Array<Promise<string>>) => Promise.all(promises))
        .then((contents: string[]) => contents.map((content) => JSON.parse(content)));
    const getLatestResult = async (id: string): Promise<ResultContainer | null> =>
        (await getTestResults(id)).results
            .sort((result: ResultContainer) => result.check_time)
            .shift();

    const runTest = async ({ id }: { id: string }): Promise<[Test, Result]> => {
        const test: Test = await getTest(id);
        const latestResult = await getLatestResult(id);
        const idDisplay = `[${chalk.bold.dim(test.public_id)}]`;
        console.log(
            `${idDisplay} Trigger test "${chalk.green.bold(test.name)}"`
        );
        await triggerTests([id]);
        return new Promise<ResultContainer>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject('Timeout');
            }, 60 * 60 * 1000); // Timeout after 1 hour.

            console.log(
                `${idDisplay} Waiting results for "${chalk.green.bold(
                    test.name
                )}"`
            );
            const interval = setInterval(async () => {
                const result = await getLatestResult(id);
                if (!result) {
                    return;
                }

                if (
                    !latestResult ||
                    result.result_id !== latestResult.result_id
                ) {
                    stopIntervals(interval, timeout);
                    resolve(result);
                }
            }, 5000); // Make a request every 5 seconds.

            // Safety exit.
            handleQuit(() => stopIntervals(interval, timeout));
        }).then(({ result }) => {
            console.log(`${idDisplay} ${chalk.green.bold(test.name)} : `);
            result.stepDetails.forEach(renderStep);
            return [test, result];
        });
    };
    const testPromises: Array<Promise<[Test, Result]>> = [];
    console.log(suites);
    suites.forEach((suite) => {
        suite.forEach(({ tests }) => {
            testPromises.push(...tests.map(runTest));
        });
    });

    Promise.all(testPromises)
        .then((results) => {
            let hasSucceed = true;
            results.forEach(([test, result]) => {
                renderResult(test, result);
                hasSucceed = hasSucceed && result.passed;
            });
            if (hasSucceed) {
                process.exit(0);
            } else {
                process.exit(1);
            }
        })
        .catch((error) => {
            console.log('ERROR', error);
            process.exit(1);
        });
};

main();
