export interface User {
    email: string;
    handle: string;
    id: number;
    name: string;
}

export interface Trigger {
    triggered_check_ids: string[];
}

export interface Test {
    config: {
        assertions: any[];
        request: {
            headers: any;
            method: string;
            timeout: number;
            url: string;
        };
        variables: string[];
    };
    created_at: string;
    created_by: User;
    locations: string[];
    message: string;
    modified_at: string;
    modified_by: User;
    monitor_id: number;
    name: string;
    options: {
        device_ids: string[];
        min_failure_duration: number;
        min_location_failed: number;
        tick_every: number;
    };
    overall_state: number;
    overall_state_modified: string;
    public_id: string;
    status: string;
    stepCount: number;
    tags: string[];
    type: string;
}

export interface Result {
    browserType: string;
    browserVersion: string;
    device: {
        height: number;
        id: string;
        isMobile: boolean;
        name: string;
        width: number;
    };
    duration: number;
    eventType: string;
    mainDC: string;
    passed: boolean;
    receivedEmailCount: number;
    startUrl: string;
    stepDetails: Step[];
    thumbnailsBucketKey: boolean;
    timeToInteractive: number;
}

export interface ResultContainer {
    check_time: number;
    check_version: number;
    probe_dc: string;
    result: Result;
    result_id: string;
    status: number;
}

export interface GetResultsResponse {
    last_timestamp_fetched: number;
    results: ResultContainer[];
}

export interface Resource {
    duration: number;
    size: number;
    type: string;
    url: string;
}

export interface Step {
    apmTraceIds: string[];
    browserErrors: string[];
    description: string;
    duration: number;
    error?: string;
    resource: Resource;
    screenshotBucketKey: boolean;
    skipped: boolean;
    snapshotBucketKey: boolean;
    stepId: number;
    type: string;
    url: string;
    value: string;
}

export interface Suite {
    description: string;
    tests: [{
        id: string;
        params: {
            startUrl: string;
        };
    }];
}
