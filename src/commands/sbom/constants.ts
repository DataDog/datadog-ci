import {
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
} from "../../helpers/tags";

export const API_ENDPOINT = "api/v2/static-analysis-sca/dependencies";

export const PACKAGE_MANAGER_PROPERTY_KEY = "osv-scanner:package-manager";
export const IS_DEPENDENCY_DIRECT_PROPERTY_KEY = "osv-scanner:is-direct";
export const FILE_PACKAGE_PROPERTY_KEY = "osv-scanner:package";

export const REQUIRED_GIT_TAGS = [
  GIT_BRANCH,
  GIT_COMMIT_AUTHOR_EMAIL,
  GIT_COMMIT_AUTHOR_NAME,
  GIT_COMMIT_COMMITTER_EMAIL,
  GIT_COMMIT_COMMITTER_NAME,
  GIT_REPOSITORY_URL,
  GIT_SHA,
];
