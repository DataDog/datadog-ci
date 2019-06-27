export interface User {
    email: string;
    handle: string;
    id: number;
    name: string;
}

export interface Test {
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
    };
}

export interface Result {
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

export interface ResultContainer {
    status: number;
    check_time: number;
    check_version: number;
    probe_dc: string;
    result_id: string;
    result: Result;
}

export interface Resource {
    duration: number;
    url: string;
    type: string;
    size: number;
}

export interface Step {
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

export interface Suite {
    description: string;
    tests: [{
        id: string;
        params: {
            startUrl: string;
        }
    }];
}
