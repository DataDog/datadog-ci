/* eslint-disable no-console */

const glob = require('glob');
const path = require('path');
const fs = require('fs').promises;
const { promisify } = require('util');
const chalk = require('chalk');

const { handleQuit } = require('../helpers/utils');
const aws = require('../helpers/aws.js');
const helpers = require('../helpers/dd-api');

interface User {
    email: string;
    handle: string;
    id: number;
    name: string;
}

interface Test {
    status: string;
    public_id: string;
    tags: string[];
    stepCount: number;
    locations: string[];
    message: string;
    modified_by: User;
    created_by: User;
    name: string;
    monitor_id: number;
    type: string;
    created_at: string;
    modified_at: string;
    overall_state_modified: string;
    overall_state: number;
    config: {
        variables: string[];
        request: {
            url: string;
            headers: any;
            method: string;
            timeout: number;
        },
        assertions: any[];
    };
    options: {
        min_failure_duration: number;
        device_ids: string[];
        tick_every: number;
        min_location_failed: number;
    }
}

interface Result {
    browserVersion: string;
    browserType: string;
    eventType: string;
    stepDetails: Step[];
    timeToInteractive: number;
    mainDC: string;
    thumbnailsBucketKey: boolean;
    receivedEmailCount: number;
    device: {
        width: number;
        height: number;
        name: string;
        isMobile: boolean;
        id: string;
    };
    passed: boolean;
    duration: number;
    startUrl: string;
}

interface ResultContainer {
    status: number;
    check_time: number;
    check_version: number;
    probe_dc: string;
    result_id: string;
    result: Result;
}

interface Resource {
    duration: number;
    url: string;
    type: string;
    size: number;
}

interface Step {
    browserErrors: string[];
    skipped: boolean;
    description: string;
    url: string;
    snapshotBucketKey: boolean;
    value: string;
    apmTraceIds: string[];
    duration: number;
    stepId: number;
    screenshotBucketKey: boolean;
    type: string;
    resource: Resource;
    error?: string;
}

interface Suite {
    description: string;
    tests: [{
        id: string;
        params: {
            startUrl: string;
        }
    }]
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
    const colorDuration =
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
    const API_KEY = await (process.env.DD_API_KEY ||
        aws.getSecretKey('ci.web-ui.dd_api_key'));
    const APP_KEY = await (process.env.DD_APP_KEY ||
        aws.getSecretKey('ci.web-ui.dd_app_key'));
    const BASE_URL = 'https://dd.datad0g.com/api/v1';

    const { getTestResults, triggerTests, getTest } = helpers({
        appKey: APP_KEY,
        apiKey: API_KEY,
        baseUrl: BASE_URL
    });
    const suites: Suite[][] = await promisify(glob)(
        path.join(__dirname, './tests/**/*.synthetics.json')
    )
        .then((files: string[]) => files.map(test => fs.readFile(test, 'utf8')))
        .then((promises: Promise<string>[]) => Promise.all(promises))
        .then((contents: string[]) => contents.map(content => JSON.parse(content)));
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
    const testPromises: Promise<[Test, Result]>[] = [];
    console.log(suites);
    suites.forEach(suite => {
        suite.forEach(({ tests }) => {
            testPromises.push(...tests.map(runTest));
        });
    });

    Promise.all(testPromises)
        .then(results => {
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
        .catch(error => {
            console.log('ERROR', error);
            process.exit(1);
        });
};

main();
