Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
let node_crypto = require("node:crypto");
let node_fs = require("node:fs");
let node_path = require("node:path");
let node_timers_promises = require("node:timers/promises");
let node_https = require("node:https");
//#region packages/ci-visibility/src/request/datadog-route.ts
/**
* Format a Datadog API route with optional parameters.
*
* @example
* ```ts
* const route = datadogRoute('/api/v2/resources/:resourceId', {
*   resourceId: '123',
* })
* ```
*/
const datadogRoute = (route, ...[params]) => {
	if (!params) return route;
	return route.replace(/:([A-Za-z0-9_]+)/g, (_, key) => encodeURIComponent(String(params[key])));
};
//#endregion
//#region packages/ci-visibility/src/validation.ts
const cleanTags = (tags, limited = true) => {
	const result = {};
	for (const [key, value] of Object.entries(tags)) {
		if (!key || value === void 0) continue;
		if (typeof value !== "string") throw new Error("Tag values must be strings");
		if (limited && (Object.keys(result).length >= 100 || key.length >= 300)) continue;
		const text = value.trim();
		if (text) result[key] = limited ? text.slice(0, 300 - key.length) : text;
	}
	return result;
};
const cleanMeasures = (measures) => {
	const result = {};
	for (const [key, value] of Object.entries(measures)) {
		if (value === void 0) continue;
		if (!key || typeof value !== "number" || !Number.isFinite(value)) throw new Error("Measures require a name and a finite number");
		if (Object.keys(result).length < 100) result[key] = value;
	}
	return result;
};
const warn = (callback, message) => {
	try {
		(callback ?? console.warn)(`CI Visibility: ${message}`);
	} catch {}
};
//#endregion
//#region packages/ci-visibility/src/payloads.ts
const levels = {
	pipeline: 0,
	job: 1,
	step: 3
};
const planRequests = (records) => {
	const requests = [];
	const patches = /* @__PURE__ */ new Map();
	let skipped = 0;
	for (const record of records) {
		if (record.type === "span") {
			requests.push({
				method: "POST",
				url: datadogRoute("/api/intake/ci/custom_spans"),
				data: { data: {
					type: "ci_app_custom_span",
					attributes: {
						ci_provider: "github",
						...record.span
					}
				} },
				recordIds: [record.id]
			});
			continue;
		}
		for (const level of record.type === "tags" ? record.levels : [record.level]) {
			const ciEnv = record.context.ciEnv;
			const indices = level !== "step" ? [void 0] : record.type === "tags" && record.steps === "all" ? record.context.stepIndices : ciEnv.DD_GITHUB_STEP_INDEX === void 0 ? [] : [Number(ciEnv.DD_GITHUB_STEP_INDEX)];
			if (!indices.length) skipped++;
			for (const index of indices) {
				const target = {
					GITHUB_SERVER_URL: ciEnv.GITHUB_SERVER_URL,
					GITHUB_REPOSITORY: ciEnv.GITHUB_REPOSITORY,
					GITHUB_RUN_ID: ciEnv.GITHUB_RUN_ID,
					GITHUB_RUN_ATTEMPT: ciEnv.GITHUB_RUN_ATTEMPT,
					GITHUB_JOB: ciEnv.GITHUB_JOB
				};
				if (level !== "pipeline") target.DD_GITHUB_JOB_NAME = ciEnv.DD_GITHUB_JOB_NAME;
				if (index !== void 0) target.DD_GITHUB_STEP_INDEX = String(index);
				const key = JSON.stringify([
					record.type,
					level,
					target
				]);
				const patch = patches.get(key) || {
					type: record.type,
					level,
					ciEnv: target,
					values: {},
					recordIds: /* @__PURE__ */ new Set()
				};
				Object.assign(patch.values, record.type === "tags" ? record.tags : record.measures);
				patch.recordIds.add(record.id);
				patches.set(key, patch);
			}
		}
	}
	for (const patch of patches.values()) {
		const tags = patch.type === "tags";
		requests.push({
			method: "POST",
			url: tags ? datadogRoute("/api/v2/ci/pipeline/tags") : datadogRoute("/api/v2/ci/pipeline/metrics"),
			data: { data: {
				type: tags ? "ci_custom_tag" : "ci_custom_metric",
				attributes: {
					ci_env: patch.ciEnv,
					ci_level: levels[patch.level],
					provider: "github",
					...tags ? { tags: cleanTags(patch.values) } : { metrics: cleanMeasures(patch.values) }
				}
			} },
			recordIds: [...patch.recordIds]
		});
	}
	return {
		requests,
		skipped
	};
};
//#endregion
//#region packages/ci-visibility/src/request.ts
var TransportError = class extends Error {};
/** The dependency-free HTTP boundary. Call sites must use audited Datadog routes. */
const httpRequest = async (config) => {
	const host = config.site === "datad0g.com" && config.url !== "/api/intake/ci/custom_spans" ? "app" : "api";
	const body = JSON.stringify(config.data);
	if (Buffer.byteLength(body) > 4 * 1024 * 1024) throw new Error("Request exceeds 4 MiB");
	return new Promise((resolve, reject) => {
		const outgoing = (0, node_https.request)(`https://${host}.${config.site}${config.url}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Content-Length": Buffer.byteLength(body),
				"DD-API-KEY": config.apiKey,
				"User-Agent": "@datadog/ci-visibility"
			},
			signal: config.signal
		}, (response) => {
			response.resume();
			response.once("end", () => resolve(response.statusCode || 0));
			response.once("error", () => reject(new TransportError("Response interrupted")));
		});
		const deadline = setTimeout(() => outgoing.destroy(new TransportError("Request timed out")), config.timeoutMs);
		outgoing.once("error", () => reject(new TransportError("Request failed or timed out")));
		outgoing.once("close", () => clearTimeout(deadline));
		outgoing.end(body);
	});
};
//#endregion
//#region packages/ci-visibility/src/upload.ts
const upload = async (requests, options = {}) => {
	const result = {
		sent: 0,
		failed: 0,
		skipped: 0,
		completedIds: []
	};
	if (!requests.length) return result;
	const apiKey = options.apiKey || process.env.DATADOG_API_KEY || process.env.DD_API_KEY;
	const site = options.site || process.env.DATADOG_SITE || process.env.DD_SITE || "datadoghq.com";
	const timeoutMs = options.timeoutMs ?? 1e4;
	const requestTimeoutMs = options.requestTimeoutMs ?? 4e3;
	if (!apiKey || !/^(?:[a-z0-9-]+\.)*(?:datadoghq\.(?:com|eu)|ddog-gov\.com|datad0g\.com)$/.test(site) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
		warn(options.onWarning, "Upload skipped: missing API key, unsupported site, or invalid timeout");
		result.skipped = requests.length;
		return result;
	}
	const controller = new AbortController();
	const deadline = setTimeout(() => controller.abort(), timeoutMs);
	const failedIds = /* @__PURE__ */ new Set();
	const sentIds = /* @__PURE__ */ new Set();
	let next = 0;
	try {
		await Promise.all(Array.from({ length: Math.min(4, requests.length) }, async () => {
			while (!controller.signal.aborted && next < requests.length) {
				const item = requests[next++];
				let success = false;
				try {
					for (let attempt = 0;; attempt++) {
						const status = await httpRequest({
							url: item.url,
							site,
							apiKey,
							signal: controller.signal,
							timeoutMs: requestTimeoutMs,
							data: item.data
						});
						if (status >= 200 && status < 300) {
							success = true;
							break;
						}
						if (status !== 429 && status < 500 || attempt === 2) break;
						await (0, node_timers_promises.setTimeout)(250 * 2 ** attempt, void 0, { signal: controller.signal });
					}
				} catch (error) {
					if (error instanceof TransportError) controller.abort();
				}
				if (success) {
					result.sent++;
					item.recordIds.forEach((id) => sentIds.add(id));
				} else {
					result.failed++;
					item.recordIds.forEach((id) => failedIds.add(id));
				}
			}
		}));
	} finally {
		clearTimeout(deadline);
	}
	for (const item of requests.slice(next)) item.recordIds.forEach((id) => failedIds.add(id));
	result.skipped = requests.length - result.sent - result.failed;
	result.completedIds = [...sentIds].filter((id) => !failedIds.has(id));
	if (result.failed || result.skipped) warn(options.onWarning, `Upload incomplete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped`);
	return result;
};
//#endregion
//#region packages/ci-visibility/src/collector.ts
const isObject = (value) => typeof value === "object" && !!value && !Array.isArray(value);
const stringMap = (value) => isObject(value) && Object.values(value).every((item) => typeof item === "string");
const measureMap = (value) => isObject(value) && Object.values(value).every((item) => typeof item === "number" && Number.isFinite(item));
const validLevel = (value) => [
	"pipeline",
	"job",
	"step"
].includes(String(value));
const isEvent = (value) => {
	if (!isObject(value) || value.version !== 1 || typeof value.id !== "string" || typeof value.recordedAt !== "string" || !isObject(value.context) || !stringMap(value.context.ciEnv) || !stringMap(value.context.tags) || !Array.isArray(value.context.stepIndices) || !value.context.stepIndices.every((index) => Number.isSafeInteger(index) && index >= 0)) return false;
	const ciEnv = value.context.ciEnv;
	if (!ciEnv.GITHUB_SERVER_URL || !ciEnv.GITHUB_REPOSITORY || !ciEnv.GITHUB_RUN_ID || !ciEnv.GITHUB_JOB || !ciEnv.GITHUB_RUN_ATTEMPT || !ciEnv.DD_GITHUB_JOB_NAME || ciEnv.DD_GITHUB_STEP_INDEX !== void 0 && !/^\d+$/.test(ciEnv.DD_GITHUB_STEP_INDEX)) return false;
	switch (value.type) {
		case "span": {
			const span = value.span;
			return isObject(span) && [
				"span_id",
				"name",
				"command",
				"start_time",
				"end_time",
				"error_message"
			].every((key) => typeof span[key] === "string") && typeof span.exit_code === "number" && Number.isFinite(span.exit_code) && stringMap(span.tags) && measureMap(span.measures);
		}
		case "tags": return stringMap(value.tags) && Array.isArray(value.levels) && value.levels.length > 0 && value.levels.every(validLevel) && ["current", "all"].includes(String(value.steps));
		case "measure": return measureMap(value.measures) && validLevel(value.level);
		default: return false;
	}
};
/** Upload completed files only. Producers must finish before the directory is collected. */
const uploadDirectory = async (directory, options = {}) => {
	try {
		const files = /* @__PURE__ */ new Map();
		const records = [];
		let invalid = 0;
		for (const entry of (0, node_fs.readdirSync)(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
			try {
				const file = (0, node_path.join)(directory, entry.name);
				const record = JSON.parse((0, node_fs.readFileSync)(file, "utf8"));
				if (!isEvent(record)) throw new Error("Invalid record");
				records.push(record);
				files.set(record.id, file);
			} catch {
				invalid++;
			}
		}
		if (invalid) warn(options.onWarning, `Skipped ${invalid} incompatible or malformed record(s)`);
		const { requests, skipped } = planRequests(records);
		if (options.dryRun) return {
			sent: 0,
			failed: 0,
			skipped: requests.length + skipped + invalid
		};
		const result = await upload(requests, options);
		for (const id of result.completedIds) try {
			(0, node_fs.unlinkSync)(files.get(id));
		} catch {
			warn(options.onWarning, "Could not remove an uploaded record; collecting again may repeat it");
		}
		return {
			sent: result.sent,
			failed: result.failed,
			skipped: result.skipped + skipped + invalid
		};
	} catch {
		warn(options.onWarning, "Could not collect the recording directory");
		return {
			sent: 0,
			failed: 0,
			skipped: 0
		};
	}
};
//#endregion
//#region packages/ci-visibility/src/action.ts
const writeCommand = (file, name, value) => {
	if (!file) throw new Error("Missing runner command file");
	const delimiter = (0, node_crypto.randomUUID)();
	(0, node_fs.appendFileSync)(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
};
const setupAction = () => {
	try {
		if (!process.env.RUNNER_TEMP) throw new Error("Missing RUNNER_TEMP");
		const directory = (0, node_fs.mkdtempSync)((0, node_path.join)(process.env.RUNNER_TEMP, "dd-ci-visibility-"));
		(0, node_fs.chmodSync)(directory, 448);
		writeCommand(process.env.GITHUB_STATE, "ci-visibility-directory", directory);
		writeCommand(process.env.GITHUB_ENV, "DD_CI_BUFFER_DIR", directory);
	} catch {
		warn(void 0, "Recorder setup unavailable");
	}
};
const postAction = async () => {
	const directory = process.env["STATE_ci-visibility-directory"];
	if (!directory) return;
	const dryRun = process.env["INPUT_DRY-RUN"] || "false";
	if (!["true", "false"].includes(dryRun)) {
		warn(void 0, "Upload skipped: dry-run must be true or false");
		return;
	}
	const result = await uploadDirectory(directory, {
		apiKey: process.env["INPUT_API-KEY"] || process.env.DATADOG_API_KEY || process.env.DD_API_KEY,
		site: process.env.INPUT_SITE || process.env.DATADOG_SITE || process.env.DD_SITE,
		timeoutMs: Number(process.env["INPUT_UPLOAD-TIMEOUT-MS"] || "10000"),
		dryRun: dryRun === "true"
	});
	console.log(`CI Visibility: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped; dry-run=${dryRun}`);
};
//#endregion
exports.postAction = postAction;
exports.setupAction = setupAction;
