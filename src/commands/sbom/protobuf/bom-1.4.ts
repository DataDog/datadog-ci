/* eslint-disable */
import * as _m0 from 'protobufjs/minimal'
import {Timestamp} from './google/protobuf/timestamp'

export const protobufPackage = 'cyclonedx.v1_4'

export enum Classification {
  CLASSIFICATION_NULL = 0,
  /** CLASSIFICATION_APPLICATION - A software application. Refer to https://en.wikipedia.org/wiki/Application_software for information about applications. */
  CLASSIFICATION_APPLICATION = 1,
  /** CLASSIFICATION_FRAMEWORK - A software framework. Refer to https://en.wikipedia.org/wiki/Software_framework for information on how frameworks vary slightly from libraries. */
  CLASSIFICATION_FRAMEWORK = 2,
  /** CLASSIFICATION_LIBRARY - A software library. Refer to https://en.wikipedia.org/wiki/Library_(computing) for information about libraries. All third-party and open source reusable components will likely be a library. If the library also has key features of a framework, then it should be classified as a framework. If not, or is unknown, then specifying library is recommended. */
  CLASSIFICATION_LIBRARY = 3,
  /** CLASSIFICATION_OPERATING_SYSTEM - A software operating system without regard to deployment model (i.e. installed on physical hardware, virtual machine, image, etc) Refer to https://en.wikipedia.org/wiki/Operating_system */
  CLASSIFICATION_OPERATING_SYSTEM = 4,
  /** CLASSIFICATION_DEVICE - A hardware device such as a processor, or chip-set. A hardware device containing firmware should include a component for the physical hardware itself, and another component of type 'firmware' or 'operating-system' (whichever is relevant), describing information about the software running on the device. */
  CLASSIFICATION_DEVICE = 5,
  /** CLASSIFICATION_FILE - A computer file. Refer to https://en.wikipedia.org/wiki/Computer_file for information about files. */
  CLASSIFICATION_FILE = 6,
  /** CLASSIFICATION_CONTAINER - A packaging and/or runtime format, not specific to any particular technology, which isolates software inside the container from software outside of a container through virtualization technology. Refer to https://en.wikipedia.org/wiki/OS-level_virtualization */
  CLASSIFICATION_CONTAINER = 7,
  /** CLASSIFICATION_FIRMWARE - A special type of software that provides low-level control over a devices hardware. Refer to https://en.wikipedia.org/wiki/Firmware */
  CLASSIFICATION_FIRMWARE = 8,
  UNRECOGNIZED = -1,
}

export function classificationFromJSON(object: any): Classification {
  switch (object) {
    case 0:
    case 'CLASSIFICATION_NULL':
      return Classification.CLASSIFICATION_NULL
    case 1:
    case 'CLASSIFICATION_APPLICATION':
      return Classification.CLASSIFICATION_APPLICATION
    case 2:
    case 'CLASSIFICATION_FRAMEWORK':
      return Classification.CLASSIFICATION_FRAMEWORK
    case 3:
    case 'CLASSIFICATION_LIBRARY':
      return Classification.CLASSIFICATION_LIBRARY
    case 4:
    case 'CLASSIFICATION_OPERATING_SYSTEM':
      return Classification.CLASSIFICATION_OPERATING_SYSTEM
    case 5:
    case 'CLASSIFICATION_DEVICE':
      return Classification.CLASSIFICATION_DEVICE
    case 6:
    case 'CLASSIFICATION_FILE':
      return Classification.CLASSIFICATION_FILE
    case 7:
    case 'CLASSIFICATION_CONTAINER':
      return Classification.CLASSIFICATION_CONTAINER
    case 8:
    case 'CLASSIFICATION_FIRMWARE':
      return Classification.CLASSIFICATION_FIRMWARE
    case -1:
    case 'UNRECOGNIZED':
    default:
      return Classification.UNRECOGNIZED
  }
}

export function classificationToJSON(object: Classification): string {
  switch (object) {
    case Classification.CLASSIFICATION_NULL:
      return 'CLASSIFICATION_NULL'
    case Classification.CLASSIFICATION_APPLICATION:
      return 'CLASSIFICATION_APPLICATION'
    case Classification.CLASSIFICATION_FRAMEWORK:
      return 'CLASSIFICATION_FRAMEWORK'
    case Classification.CLASSIFICATION_LIBRARY:
      return 'CLASSIFICATION_LIBRARY'
    case Classification.CLASSIFICATION_OPERATING_SYSTEM:
      return 'CLASSIFICATION_OPERATING_SYSTEM'
    case Classification.CLASSIFICATION_DEVICE:
      return 'CLASSIFICATION_DEVICE'
    case Classification.CLASSIFICATION_FILE:
      return 'CLASSIFICATION_FILE'
    case Classification.CLASSIFICATION_CONTAINER:
      return 'CLASSIFICATION_CONTAINER'
    case Classification.CLASSIFICATION_FIRMWARE:
      return 'CLASSIFICATION_FIRMWARE'
    case Classification.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

/** Specifies the flow direction of the data. Valid values are: inbound, outbound, bi-directional, and unknown. Direction is relative to the service. Inbound flow states that data enters the service. Outbound flow states that data leaves the service. Bi-directional states that data flows both ways, and unknown states that the direction is not known. */
export enum DataFlow {
  DATA_FLOW_NULL = 0,
  DATA_FLOW_INBOUND = 1,
  DATA_FLOW_OUTBOUND = 2,
  DATA_FLOW_BI_DIRECTIONAL = 3,
  DATA_FLOW_UNKNOWN = 4,
  UNRECOGNIZED = -1,
}

export function dataFlowFromJSON(object: any): DataFlow {
  switch (object) {
    case 0:
    case 'DATA_FLOW_NULL':
      return DataFlow.DATA_FLOW_NULL
    case 1:
    case 'DATA_FLOW_INBOUND':
      return DataFlow.DATA_FLOW_INBOUND
    case 2:
    case 'DATA_FLOW_OUTBOUND':
      return DataFlow.DATA_FLOW_OUTBOUND
    case 3:
    case 'DATA_FLOW_BI_DIRECTIONAL':
      return DataFlow.DATA_FLOW_BI_DIRECTIONAL
    case 4:
    case 'DATA_FLOW_UNKNOWN':
      return DataFlow.DATA_FLOW_UNKNOWN
    case -1:
    case 'UNRECOGNIZED':
    default:
      return DataFlow.UNRECOGNIZED
  }
}

export function dataFlowToJSON(object: DataFlow): string {
  switch (object) {
    case DataFlow.DATA_FLOW_NULL:
      return 'DATA_FLOW_NULL'
    case DataFlow.DATA_FLOW_INBOUND:
      return 'DATA_FLOW_INBOUND'
    case DataFlow.DATA_FLOW_OUTBOUND:
      return 'DATA_FLOW_OUTBOUND'
    case DataFlow.DATA_FLOW_BI_DIRECTIONAL:
      return 'DATA_FLOW_BI_DIRECTIONAL'
    case DataFlow.DATA_FLOW_UNKNOWN:
      return 'DATA_FLOW_UNKNOWN'
    case DataFlow.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum ExternalReferenceType {
  /** EXTERNAL_REFERENCE_TYPE_OTHER - Use this if no other types accurately describe the purpose of the external reference */
  EXTERNAL_REFERENCE_TYPE_OTHER = 0,
  /** EXTERNAL_REFERENCE_TYPE_VCS - Version Control System */
  EXTERNAL_REFERENCE_TYPE_VCS = 1,
  /** EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER - Issue or defect tracking system, or an Application Lifecycle Management (ALM) system */
  EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER = 2,
  /** EXTERNAL_REFERENCE_TYPE_WEBSITE - Website */
  EXTERNAL_REFERENCE_TYPE_WEBSITE = 3,
  /** EXTERNAL_REFERENCE_TYPE_ADVISORIES - Security advisories */
  EXTERNAL_REFERENCE_TYPE_ADVISORIES = 4,
  /** EXTERNAL_REFERENCE_TYPE_BOM - Bill-of-material document (CycloneDX, SPDX, SWID, etc) */
  EXTERNAL_REFERENCE_TYPE_BOM = 5,
  /** EXTERNAL_REFERENCE_TYPE_MAILING_LIST - Mailing list or discussion group */
  EXTERNAL_REFERENCE_TYPE_MAILING_LIST = 6,
  /** EXTERNAL_REFERENCE_TYPE_SOCIAL - Social media account */
  EXTERNAL_REFERENCE_TYPE_SOCIAL = 7,
  /** EXTERNAL_REFERENCE_TYPE_CHAT - Real-time chat platform */
  EXTERNAL_REFERENCE_TYPE_CHAT = 8,
  /** EXTERNAL_REFERENCE_TYPE_DOCUMENTATION - Documentation, guides, or how-to instructions */
  EXTERNAL_REFERENCE_TYPE_DOCUMENTATION = 9,
  /** EXTERNAL_REFERENCE_TYPE_SUPPORT - Community or commercial support */
  EXTERNAL_REFERENCE_TYPE_SUPPORT = 10,
  /** EXTERNAL_REFERENCE_TYPE_DISTRIBUTION - Direct or repository download location */
  EXTERNAL_REFERENCE_TYPE_DISTRIBUTION = 11,
  /** EXTERNAL_REFERENCE_TYPE_LICENSE - The URL to the license file. If a license URL has been defined in the license node, it should also be defined as an external reference for completeness */
  EXTERNAL_REFERENCE_TYPE_LICENSE = 12,
  /** EXTERNAL_REFERENCE_TYPE_BUILD_META - Build-system specific meta file (i.e. pom.xml, package.json, .nuspec, etc) */
  EXTERNAL_REFERENCE_TYPE_BUILD_META = 13,
  /** EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM - URL to an automated build system */
  EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM = 14,
  UNRECOGNIZED = -1,
}

export function externalReferenceTypeFromJSON(object: any): ExternalReferenceType {
  switch (object) {
    case 0:
    case 'EXTERNAL_REFERENCE_TYPE_OTHER':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_OTHER
    case 1:
    case 'EXTERNAL_REFERENCE_TYPE_VCS':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_VCS
    case 2:
    case 'EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER
    case 3:
    case 'EXTERNAL_REFERENCE_TYPE_WEBSITE':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_WEBSITE
    case 4:
    case 'EXTERNAL_REFERENCE_TYPE_ADVISORIES':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_ADVISORIES
    case 5:
    case 'EXTERNAL_REFERENCE_TYPE_BOM':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BOM
    case 6:
    case 'EXTERNAL_REFERENCE_TYPE_MAILING_LIST':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_MAILING_LIST
    case 7:
    case 'EXTERNAL_REFERENCE_TYPE_SOCIAL':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_SOCIAL
    case 8:
    case 'EXTERNAL_REFERENCE_TYPE_CHAT':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_CHAT
    case 9:
    case 'EXTERNAL_REFERENCE_TYPE_DOCUMENTATION':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_DOCUMENTATION
    case 10:
    case 'EXTERNAL_REFERENCE_TYPE_SUPPORT':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_SUPPORT
    case 11:
    case 'EXTERNAL_REFERENCE_TYPE_DISTRIBUTION':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_DISTRIBUTION
    case 12:
    case 'EXTERNAL_REFERENCE_TYPE_LICENSE':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_LICENSE
    case 13:
    case 'EXTERNAL_REFERENCE_TYPE_BUILD_META':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BUILD_META
    case 14:
    case 'EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM':
      return ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM
    case -1:
    case 'UNRECOGNIZED':
    default:
      return ExternalReferenceType.UNRECOGNIZED
  }
}

export function externalReferenceTypeToJSON(object: ExternalReferenceType): string {
  switch (object) {
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_OTHER:
      return 'EXTERNAL_REFERENCE_TYPE_OTHER'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_VCS:
      return 'EXTERNAL_REFERENCE_TYPE_VCS'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER:
      return 'EXTERNAL_REFERENCE_TYPE_ISSUE_TRACKER'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_WEBSITE:
      return 'EXTERNAL_REFERENCE_TYPE_WEBSITE'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_ADVISORIES:
      return 'EXTERNAL_REFERENCE_TYPE_ADVISORIES'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BOM:
      return 'EXTERNAL_REFERENCE_TYPE_BOM'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_MAILING_LIST:
      return 'EXTERNAL_REFERENCE_TYPE_MAILING_LIST'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_SOCIAL:
      return 'EXTERNAL_REFERENCE_TYPE_SOCIAL'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_CHAT:
      return 'EXTERNAL_REFERENCE_TYPE_CHAT'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_DOCUMENTATION:
      return 'EXTERNAL_REFERENCE_TYPE_DOCUMENTATION'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_SUPPORT:
      return 'EXTERNAL_REFERENCE_TYPE_SUPPORT'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_DISTRIBUTION:
      return 'EXTERNAL_REFERENCE_TYPE_DISTRIBUTION'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_LICENSE:
      return 'EXTERNAL_REFERENCE_TYPE_LICENSE'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BUILD_META:
      return 'EXTERNAL_REFERENCE_TYPE_BUILD_META'
    case ExternalReferenceType.EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM:
      return 'EXTERNAL_REFERENCE_TYPE_BUILD_SYSTEM'
    case ExternalReferenceType.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum HashAlg {
  HASH_ALG_NULL = 0,
  HASH_ALG_MD_5 = 1,
  HASH_ALG_SHA_1 = 2,
  HASH_ALG_SHA_256 = 3,
  HASH_ALG_SHA_384 = 4,
  HASH_ALG_SHA_512 = 5,
  HASH_ALG_SHA_3_256 = 6,
  HASH_ALG_SHA_3_384 = 7,
  HASH_ALG_SHA_3_512 = 8,
  HASH_ALG_BLAKE_2_B_256 = 9,
  HASH_ALG_BLAKE_2_B_384 = 10,
  HASH_ALG_BLAKE_2_B_512 = 11,
  HASH_ALG_BLAKE_3 = 12,
  UNRECOGNIZED = -1,
}

export function hashAlgFromJSON(object: any): HashAlg {
  switch (object) {
    case 0:
    case 'HASH_ALG_NULL':
      return HashAlg.HASH_ALG_NULL
    case 1:
    case 'HASH_ALG_MD_5':
      return HashAlg.HASH_ALG_MD_5
    case 2:
    case 'HASH_ALG_SHA_1':
      return HashAlg.HASH_ALG_SHA_1
    case 3:
    case 'HASH_ALG_SHA_256':
      return HashAlg.HASH_ALG_SHA_256
    case 4:
    case 'HASH_ALG_SHA_384':
      return HashAlg.HASH_ALG_SHA_384
    case 5:
    case 'HASH_ALG_SHA_512':
      return HashAlg.HASH_ALG_SHA_512
    case 6:
    case 'HASH_ALG_SHA_3_256':
      return HashAlg.HASH_ALG_SHA_3_256
    case 7:
    case 'HASH_ALG_SHA_3_384':
      return HashAlg.HASH_ALG_SHA_3_384
    case 8:
    case 'HASH_ALG_SHA_3_512':
      return HashAlg.HASH_ALG_SHA_3_512
    case 9:
    case 'HASH_ALG_BLAKE_2_B_256':
      return HashAlg.HASH_ALG_BLAKE_2_B_256
    case 10:
    case 'HASH_ALG_BLAKE_2_B_384':
      return HashAlg.HASH_ALG_BLAKE_2_B_384
    case 11:
    case 'HASH_ALG_BLAKE_2_B_512':
      return HashAlg.HASH_ALG_BLAKE_2_B_512
    case 12:
    case 'HASH_ALG_BLAKE_3':
      return HashAlg.HASH_ALG_BLAKE_3
    case -1:
    case 'UNRECOGNIZED':
    default:
      return HashAlg.UNRECOGNIZED
  }
}

export function hashAlgToJSON(object: HashAlg): string {
  switch (object) {
    case HashAlg.HASH_ALG_NULL:
      return 'HASH_ALG_NULL'
    case HashAlg.HASH_ALG_MD_5:
      return 'HASH_ALG_MD_5'
    case HashAlg.HASH_ALG_SHA_1:
      return 'HASH_ALG_SHA_1'
    case HashAlg.HASH_ALG_SHA_256:
      return 'HASH_ALG_SHA_256'
    case HashAlg.HASH_ALG_SHA_384:
      return 'HASH_ALG_SHA_384'
    case HashAlg.HASH_ALG_SHA_512:
      return 'HASH_ALG_SHA_512'
    case HashAlg.HASH_ALG_SHA_3_256:
      return 'HASH_ALG_SHA_3_256'
    case HashAlg.HASH_ALG_SHA_3_384:
      return 'HASH_ALG_SHA_3_384'
    case HashAlg.HASH_ALG_SHA_3_512:
      return 'HASH_ALG_SHA_3_512'
    case HashAlg.HASH_ALG_BLAKE_2_B_256:
      return 'HASH_ALG_BLAKE_2_B_256'
    case HashAlg.HASH_ALG_BLAKE_2_B_384:
      return 'HASH_ALG_BLAKE_2_B_384'
    case HashAlg.HASH_ALG_BLAKE_2_B_512:
      return 'HASH_ALG_BLAKE_2_B_512'
    case HashAlg.HASH_ALG_BLAKE_3:
      return 'HASH_ALG_BLAKE_3'
    case HashAlg.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum IssueClassification {
  ISSUE_CLASSIFICATION_NULL = 0,
  /** ISSUE_CLASSIFICATION_DEFECT - A fault, flaw, or bug in software */
  ISSUE_CLASSIFICATION_DEFECT = 1,
  /** ISSUE_CLASSIFICATION_ENHANCEMENT - A new feature or behavior in software */
  ISSUE_CLASSIFICATION_ENHANCEMENT = 2,
  /** ISSUE_CLASSIFICATION_SECURITY - A special type of defect which impacts security */
  ISSUE_CLASSIFICATION_SECURITY = 3,
  UNRECOGNIZED = -1,
}

export function issueClassificationFromJSON(object: any): IssueClassification {
  switch (object) {
    case 0:
    case 'ISSUE_CLASSIFICATION_NULL':
      return IssueClassification.ISSUE_CLASSIFICATION_NULL
    case 1:
    case 'ISSUE_CLASSIFICATION_DEFECT':
      return IssueClassification.ISSUE_CLASSIFICATION_DEFECT
    case 2:
    case 'ISSUE_CLASSIFICATION_ENHANCEMENT':
      return IssueClassification.ISSUE_CLASSIFICATION_ENHANCEMENT
    case 3:
    case 'ISSUE_CLASSIFICATION_SECURITY':
      return IssueClassification.ISSUE_CLASSIFICATION_SECURITY
    case -1:
    case 'UNRECOGNIZED':
    default:
      return IssueClassification.UNRECOGNIZED
  }
}

export function issueClassificationToJSON(object: IssueClassification): string {
  switch (object) {
    case IssueClassification.ISSUE_CLASSIFICATION_NULL:
      return 'ISSUE_CLASSIFICATION_NULL'
    case IssueClassification.ISSUE_CLASSIFICATION_DEFECT:
      return 'ISSUE_CLASSIFICATION_DEFECT'
    case IssueClassification.ISSUE_CLASSIFICATION_ENHANCEMENT:
      return 'ISSUE_CLASSIFICATION_ENHANCEMENT'
    case IssueClassification.ISSUE_CLASSIFICATION_SECURITY:
      return 'ISSUE_CLASSIFICATION_SECURITY'
    case IssueClassification.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum PatchClassification {
  PATCH_CLASSIFICATION_NULL = 0,
  /** PATCH_CLASSIFICATION_UNOFFICIAL - A patch which is not developed by the creators or maintainers of the software being patched. Refer to https://en.wikipedia.org/wiki/Unofficial_patch */
  PATCH_CLASSIFICATION_UNOFFICIAL = 1,
  /** PATCH_CLASSIFICATION_MONKEY - A patch which dynamically modifies runtime behavior. Refer to https://en.wikipedia.org/wiki/Monkey_patch */
  PATCH_CLASSIFICATION_MONKEY = 2,
  /** PATCH_CLASSIFICATION_BACKPORT - A patch which takes code from a newer version of software and applies it to older versions of the same software. Refer to https://en.wikipedia.org/wiki/Backporting */
  PATCH_CLASSIFICATION_BACKPORT = 3,
  /** PATCH_CLASSIFICATION_CHERRY_PICK - A patch created by selectively applying commits from other versions or branches of the same software. */
  PATCH_CLASSIFICATION_CHERRY_PICK = 4,
  UNRECOGNIZED = -1,
}

export function patchClassificationFromJSON(object: any): PatchClassification {
  switch (object) {
    case 0:
    case 'PATCH_CLASSIFICATION_NULL':
      return PatchClassification.PATCH_CLASSIFICATION_NULL
    case 1:
    case 'PATCH_CLASSIFICATION_UNOFFICIAL':
      return PatchClassification.PATCH_CLASSIFICATION_UNOFFICIAL
    case 2:
    case 'PATCH_CLASSIFICATION_MONKEY':
      return PatchClassification.PATCH_CLASSIFICATION_MONKEY
    case 3:
    case 'PATCH_CLASSIFICATION_BACKPORT':
      return PatchClassification.PATCH_CLASSIFICATION_BACKPORT
    case 4:
    case 'PATCH_CLASSIFICATION_CHERRY_PICK':
      return PatchClassification.PATCH_CLASSIFICATION_CHERRY_PICK
    case -1:
    case 'UNRECOGNIZED':
    default:
      return PatchClassification.UNRECOGNIZED
  }
}

export function patchClassificationToJSON(object: PatchClassification): string {
  switch (object) {
    case PatchClassification.PATCH_CLASSIFICATION_NULL:
      return 'PATCH_CLASSIFICATION_NULL'
    case PatchClassification.PATCH_CLASSIFICATION_UNOFFICIAL:
      return 'PATCH_CLASSIFICATION_UNOFFICIAL'
    case PatchClassification.PATCH_CLASSIFICATION_MONKEY:
      return 'PATCH_CLASSIFICATION_MONKEY'
    case PatchClassification.PATCH_CLASSIFICATION_BACKPORT:
      return 'PATCH_CLASSIFICATION_BACKPORT'
    case PatchClassification.PATCH_CLASSIFICATION_CHERRY_PICK:
      return 'PATCH_CLASSIFICATION_CHERRY_PICK'
    case PatchClassification.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum Scope {
  /** SCOPE_UNSPECIFIED - Default */
  SCOPE_UNSPECIFIED = 0,
  /** SCOPE_REQUIRED - The component is required for runtime */
  SCOPE_REQUIRED = 1,
  /** SCOPE_OPTIONAL - The component is optional at runtime. Optional components are components that are not capable of being called due to them not be installed or otherwise accessible by any means. Components that are installed but due to configuration or other restrictions are prohibited from being called must be scoped as 'required'. */
  SCOPE_OPTIONAL = 2,
  /** SCOPE_EXCLUDED - Components that are excluded provide the ability to document component usage for test and other non-runtime purposes. Excluded components are not reachable within a call graph at runtime. */
  SCOPE_EXCLUDED = 3,
  UNRECOGNIZED = -1,
}

export function scopeFromJSON(object: any): Scope {
  switch (object) {
    case 0:
    case 'SCOPE_UNSPECIFIED':
      return Scope.SCOPE_UNSPECIFIED
    case 1:
    case 'SCOPE_REQUIRED':
      return Scope.SCOPE_REQUIRED
    case 2:
    case 'SCOPE_OPTIONAL':
      return Scope.SCOPE_OPTIONAL
    case 3:
    case 'SCOPE_EXCLUDED':
      return Scope.SCOPE_EXCLUDED
    case -1:
    case 'UNRECOGNIZED':
    default:
      return Scope.UNRECOGNIZED
  }
}

export function scopeToJSON(object: Scope): string {
  switch (object) {
    case Scope.SCOPE_UNSPECIFIED:
      return 'SCOPE_UNSPECIFIED'
    case Scope.SCOPE_REQUIRED:
      return 'SCOPE_REQUIRED'
    case Scope.SCOPE_OPTIONAL:
      return 'SCOPE_OPTIONAL'
    case Scope.SCOPE_EXCLUDED:
      return 'SCOPE_EXCLUDED'
    case Scope.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum Aggregate {
  /** AGGREGATE_NOT_SPECIFIED - Default, no statement about the aggregate completeness is being made */
  AGGREGATE_NOT_SPECIFIED = 0,
  /** AGGREGATE_COMPLETE - The aggregate composition is complete */
  AGGREGATE_COMPLETE = 1,
  /** AGGREGATE_INCOMPLETE - The aggregate composition is incomplete */
  AGGREGATE_INCOMPLETE = 2,
  /** AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY - The aggregate composition is incomplete for first party components, complete for third party components */
  AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY = 3,
  /** AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY - The aggregate composition is incomplete for third party components, complete for first party components */
  AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY = 4,
  /** AGGREGATE_UNKNOWN - The aggregate composition completeness is unknown */
  AGGREGATE_UNKNOWN = 5,
  UNRECOGNIZED = -1,
}

export function aggregateFromJSON(object: any): Aggregate {
  switch (object) {
    case 0:
    case 'AGGREGATE_NOT_SPECIFIED':
      return Aggregate.AGGREGATE_NOT_SPECIFIED
    case 1:
    case 'AGGREGATE_COMPLETE':
      return Aggregate.AGGREGATE_COMPLETE
    case 2:
    case 'AGGREGATE_INCOMPLETE':
      return Aggregate.AGGREGATE_INCOMPLETE
    case 3:
    case 'AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY':
      return Aggregate.AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY
    case 4:
    case 'AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY':
      return Aggregate.AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY
    case 5:
    case 'AGGREGATE_UNKNOWN':
      return Aggregate.AGGREGATE_UNKNOWN
    case -1:
    case 'UNRECOGNIZED':
    default:
      return Aggregate.UNRECOGNIZED
  }
}

export function aggregateToJSON(object: Aggregate): string {
  switch (object) {
    case Aggregate.AGGREGATE_NOT_SPECIFIED:
      return 'AGGREGATE_NOT_SPECIFIED'
    case Aggregate.AGGREGATE_COMPLETE:
      return 'AGGREGATE_COMPLETE'
    case Aggregate.AGGREGATE_INCOMPLETE:
      return 'AGGREGATE_INCOMPLETE'
    case Aggregate.AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY:
      return 'AGGREGATE_INCOMPLETE_FIRST_PARTY_ONLY'
    case Aggregate.AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY:
      return 'AGGREGATE_INCOMPLETE_THIRD_PARTY_ONLY'
    case Aggregate.AGGREGATE_UNKNOWN:
      return 'AGGREGATE_UNKNOWN'
    case Aggregate.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum Severity {
  SEVERITY_UNKNOWN = 0,
  SEVERITY_CRITICAL = 1,
  SEVERITY_HIGH = 2,
  SEVERITY_MEDIUM = 3,
  SEVERITY_LOW = 4,
  SEVERITY_INFO = 5,
  SEVERITY_NONE = 6,
  UNRECOGNIZED = -1,
}

export function severityFromJSON(object: any): Severity {
  switch (object) {
    case 0:
    case 'SEVERITY_UNKNOWN':
      return Severity.SEVERITY_UNKNOWN
    case 1:
    case 'SEVERITY_CRITICAL':
      return Severity.SEVERITY_CRITICAL
    case 2:
    case 'SEVERITY_HIGH':
      return Severity.SEVERITY_HIGH
    case 3:
    case 'SEVERITY_MEDIUM':
      return Severity.SEVERITY_MEDIUM
    case 4:
    case 'SEVERITY_LOW':
      return Severity.SEVERITY_LOW
    case 5:
    case 'SEVERITY_INFO':
      return Severity.SEVERITY_INFO
    case 6:
    case 'SEVERITY_NONE':
      return Severity.SEVERITY_NONE
    case -1:
    case 'UNRECOGNIZED':
    default:
      return Severity.UNRECOGNIZED
  }
}

export function severityToJSON(object: Severity): string {
  switch (object) {
    case Severity.SEVERITY_UNKNOWN:
      return 'SEVERITY_UNKNOWN'
    case Severity.SEVERITY_CRITICAL:
      return 'SEVERITY_CRITICAL'
    case Severity.SEVERITY_HIGH:
      return 'SEVERITY_HIGH'
    case Severity.SEVERITY_MEDIUM:
      return 'SEVERITY_MEDIUM'
    case Severity.SEVERITY_LOW:
      return 'SEVERITY_LOW'
    case Severity.SEVERITY_INFO:
      return 'SEVERITY_INFO'
    case Severity.SEVERITY_NONE:
      return 'SEVERITY_NONE'
    case Severity.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum ScoreMethod {
  /** SCORE_METHOD_NULL - An undefined score method */
  SCORE_METHOD_NULL = 0,
  /** SCORE_METHOD_CVSSV2 - Common Vulnerability Scoring System v2 - https://www.first.org/cvss/v2/ */
  SCORE_METHOD_CVSSV2 = 1,
  /** SCORE_METHOD_CVSSV3 - Common Vulnerability Scoring System v3 - https://www.first.org/cvss/v3-0/ */
  SCORE_METHOD_CVSSV3 = 2,
  /** SCORE_METHOD_CVSSV31 - Common Vulnerability Scoring System v3.1 - https://www.first.org/cvss/v3-1/ */
  SCORE_METHOD_CVSSV31 = 3,
  /** SCORE_METHOD_OWASP - OWASP Risk Rating Methodology - https://owasp.org/www-community/OWASP_Risk_Rating_Methodology */
  SCORE_METHOD_OWASP = 4,
  /** SCORE_METHOD_OTHER - Other scoring method */
  SCORE_METHOD_OTHER = 5,
  UNRECOGNIZED = -1,
}

export function scoreMethodFromJSON(object: any): ScoreMethod {
  switch (object) {
    case 0:
    case 'SCORE_METHOD_NULL':
      return ScoreMethod.SCORE_METHOD_NULL
    case 1:
    case 'SCORE_METHOD_CVSSV2':
      return ScoreMethod.SCORE_METHOD_CVSSV2
    case 2:
    case 'SCORE_METHOD_CVSSV3':
      return ScoreMethod.SCORE_METHOD_CVSSV3
    case 3:
    case 'SCORE_METHOD_CVSSV31':
      return ScoreMethod.SCORE_METHOD_CVSSV31
    case 4:
    case 'SCORE_METHOD_OWASP':
      return ScoreMethod.SCORE_METHOD_OWASP
    case 5:
    case 'SCORE_METHOD_OTHER':
      return ScoreMethod.SCORE_METHOD_OTHER
    case -1:
    case 'UNRECOGNIZED':
    default:
      return ScoreMethod.UNRECOGNIZED
  }
}

export function scoreMethodToJSON(object: ScoreMethod): string {
  switch (object) {
    case ScoreMethod.SCORE_METHOD_NULL:
      return 'SCORE_METHOD_NULL'
    case ScoreMethod.SCORE_METHOD_CVSSV2:
      return 'SCORE_METHOD_CVSSV2'
    case ScoreMethod.SCORE_METHOD_CVSSV3:
      return 'SCORE_METHOD_CVSSV3'
    case ScoreMethod.SCORE_METHOD_CVSSV31:
      return 'SCORE_METHOD_CVSSV31'
    case ScoreMethod.SCORE_METHOD_OWASP:
      return 'SCORE_METHOD_OWASP'
    case ScoreMethod.SCORE_METHOD_OTHER:
      return 'SCORE_METHOD_OTHER'
    case ScoreMethod.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum ImpactAnalysisState {
  /** IMPACT_ANALYSIS_STATE_NULL - An undefined impact analysis state */
  IMPACT_ANALYSIS_STATE_NULL = 0,
  /** IMPACT_ANALYSIS_STATE_RESOLVED - The vulnerability has been remediated. */
  IMPACT_ANALYSIS_STATE_RESOLVED = 1,
  /** IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE - The vulnerability has been remediated and evidence of the changes are provided in the affected components pedigree containing verifiable commit history and/or diff(s). */
  IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE = 2,
  /** IMPACT_ANALYSIS_STATE_EXPLOITABLE - The vulnerability may be directly or indirectly exploitable. */
  IMPACT_ANALYSIS_STATE_EXPLOITABLE = 3,
  /** IMPACT_ANALYSIS_STATE_IN_TRIAGE - The vulnerability is being investigated. */
  IMPACT_ANALYSIS_STATE_IN_TRIAGE = 4,
  /** IMPACT_ANALYSIS_STATE_FALSE_POSITIVE - The vulnerability is not specific to the component or service and was falsely identified or associated. */
  IMPACT_ANALYSIS_STATE_FALSE_POSITIVE = 5,
  /** IMPACT_ANALYSIS_STATE_NOT_AFFECTED - The component or service is not affected by the vulnerability. Justification should be specified for all not_affected cases. */
  IMPACT_ANALYSIS_STATE_NOT_AFFECTED = 6,
  UNRECOGNIZED = -1,
}

export function impactAnalysisStateFromJSON(object: any): ImpactAnalysisState {
  switch (object) {
    case 0:
    case 'IMPACT_ANALYSIS_STATE_NULL':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_NULL
    case 1:
    case 'IMPACT_ANALYSIS_STATE_RESOLVED':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_RESOLVED
    case 2:
    case 'IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE
    case 3:
    case 'IMPACT_ANALYSIS_STATE_EXPLOITABLE':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_EXPLOITABLE
    case 4:
    case 'IMPACT_ANALYSIS_STATE_IN_TRIAGE':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_IN_TRIAGE
    case 5:
    case 'IMPACT_ANALYSIS_STATE_FALSE_POSITIVE':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_FALSE_POSITIVE
    case 6:
    case 'IMPACT_ANALYSIS_STATE_NOT_AFFECTED':
      return ImpactAnalysisState.IMPACT_ANALYSIS_STATE_NOT_AFFECTED
    case -1:
    case 'UNRECOGNIZED':
    default:
      return ImpactAnalysisState.UNRECOGNIZED
  }
}

export function impactAnalysisStateToJSON(object: ImpactAnalysisState): string {
  switch (object) {
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_NULL:
      return 'IMPACT_ANALYSIS_STATE_NULL'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_RESOLVED:
      return 'IMPACT_ANALYSIS_STATE_RESOLVED'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE:
      return 'IMPACT_ANALYSIS_STATE_RESOLVED_WITH_PEDIGREE'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_EXPLOITABLE:
      return 'IMPACT_ANALYSIS_STATE_EXPLOITABLE'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_IN_TRIAGE:
      return 'IMPACT_ANALYSIS_STATE_IN_TRIAGE'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_FALSE_POSITIVE:
      return 'IMPACT_ANALYSIS_STATE_FALSE_POSITIVE'
    case ImpactAnalysisState.IMPACT_ANALYSIS_STATE_NOT_AFFECTED:
      return 'IMPACT_ANALYSIS_STATE_NOT_AFFECTED'
    case ImpactAnalysisState.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum ImpactAnalysisJustification {
  /** IMPACT_ANALYSIS_JUSTIFICATION_NULL - An undefined impact analysis justification */
  IMPACT_ANALYSIS_JUSTIFICATION_NULL = 0,
  /** IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT - The code has been removed or tree-shaked. */
  IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT = 1,
  /** IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE - The vulnerable code is not invoked at runtime. */
  IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE = 2,
  /** IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION - Exploitability requires a configurable option to be set/unset. */
  IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION = 3,
  /** IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY - Exploitability requires a dependency that is not present. */
  IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY = 4,
  /** IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT - Exploitability requires a certain environment which is not present. */
  IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT = 5,
  /** IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER - Exploitability requires a compiler flag to be set/unset. */
  IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER = 6,
  /** IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME - Exploits are prevented at runtime. */
  IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME = 7,
  /** IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER - Attacks are blocked at physical, logical, or network perimeter. */
  IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER = 8,
  /** IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL - Preventative measures have been implemented that reduce the likelihood and/or impact of the vulnerability. */
  IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL = 9,
  UNRECOGNIZED = -1,
}

export function impactAnalysisJustificationFromJSON(object: any): ImpactAnalysisJustification {
  switch (object) {
    case 0:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_NULL':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_NULL
    case 1:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT
    case 2:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE
    case 3:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION
    case 4:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY
    case 5:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT
    case 6:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER
    case 7:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME
    case 8:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER
    case 9:
    case 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL':
      return ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL
    case -1:
    case 'UNRECOGNIZED':
    default:
      return ImpactAnalysisJustification.UNRECOGNIZED
  }
}

export function impactAnalysisJustificationToJSON(object: ImpactAnalysisJustification): string {
  switch (object) {
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_NULL:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_NULL'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_PRESENT'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_CODE_NOT_REACHABLE'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_CONFIGURATION'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_DEPENDENCY'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_REQUIRES_ENVIRONMENT'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_COMPILER'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_RUNTIME'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_AT_PERIMETER'
    case ImpactAnalysisJustification.IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL:
      return 'IMPACT_ANALYSIS_JUSTIFICATION_PROTECTED_BY_MITIGATING_CONTROL'
    case ImpactAnalysisJustification.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum VulnerabilityResponse {
  VULNERABILITY_RESPONSE_NULL = 0,
  VULNERABILITY_RESPONSE_CAN_NOT_FIX = 1,
  VULNERABILITY_RESPONSE_WILL_NOT_FIX = 2,
  VULNERABILITY_RESPONSE_UPDATE = 3,
  VULNERABILITY_RESPONSE_ROLLBACK = 4,
  VULNERABILITY_RESPONSE_WORKAROUND_AVAILABLE = 5,
  UNRECOGNIZED = -1,
}

export function vulnerabilityResponseFromJSON(object: any): VulnerabilityResponse {
  switch (object) {
    case 0:
    case 'VULNERABILITY_RESPONSE_NULL':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_NULL
    case 1:
    case 'VULNERABILITY_RESPONSE_CAN_NOT_FIX':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_CAN_NOT_FIX
    case 2:
    case 'VULNERABILITY_RESPONSE_WILL_NOT_FIX':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_WILL_NOT_FIX
    case 3:
    case 'VULNERABILITY_RESPONSE_UPDATE':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_UPDATE
    case 4:
    case 'VULNERABILITY_RESPONSE_ROLLBACK':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_ROLLBACK
    case 5:
    case 'VULNERABILITY_RESPONSE_WORKAROUND_AVAILABLE':
      return VulnerabilityResponse.VULNERABILITY_RESPONSE_WORKAROUND_AVAILABLE
    case -1:
    case 'UNRECOGNIZED':
    default:
      return VulnerabilityResponse.UNRECOGNIZED
  }
}

export function vulnerabilityResponseToJSON(object: VulnerabilityResponse): string {
  switch (object) {
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_NULL:
      return 'VULNERABILITY_RESPONSE_NULL'
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_CAN_NOT_FIX:
      return 'VULNERABILITY_RESPONSE_CAN_NOT_FIX'
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_WILL_NOT_FIX:
      return 'VULNERABILITY_RESPONSE_WILL_NOT_FIX'
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_UPDATE:
      return 'VULNERABILITY_RESPONSE_UPDATE'
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_ROLLBACK:
      return 'VULNERABILITY_RESPONSE_ROLLBACK'
    case VulnerabilityResponse.VULNERABILITY_RESPONSE_WORKAROUND_AVAILABLE:
      return 'VULNERABILITY_RESPONSE_WORKAROUND_AVAILABLE'
    case VulnerabilityResponse.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

export enum VulnerabilityAffectedStatus {
  /** VULNERABILITY_AFFECTED_STATUS_UNKNOWN - The vulnerability status of a given version or range of versions of a product. The statuses 'affected' and 'unaffected' indicate that the version is affected or unaffected by the vulnerability. The status 'unknown' indicates that it is unknown or unspecified whether the given version is affected. There can be many reasons for an 'unknown' status, including that an investigation has not been undertaken or that a vendor has not disclosed the status. */
  VULNERABILITY_AFFECTED_STATUS_UNKNOWN = 0,
  VULNERABILITY_AFFECTED_STATUS_AFFECTED = 1,
  VULNERABILITY_AFFECTED_STATUS_NOT_AFFECTED = 2,
  UNRECOGNIZED = -1,
}

export function vulnerabilityAffectedStatusFromJSON(object: any): VulnerabilityAffectedStatus {
  switch (object) {
    case 0:
    case 'VULNERABILITY_AFFECTED_STATUS_UNKNOWN':
      return VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_UNKNOWN
    case 1:
    case 'VULNERABILITY_AFFECTED_STATUS_AFFECTED':
      return VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_AFFECTED
    case 2:
    case 'VULNERABILITY_AFFECTED_STATUS_NOT_AFFECTED':
      return VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_NOT_AFFECTED
    case -1:
    case 'UNRECOGNIZED':
    default:
      return VulnerabilityAffectedStatus.UNRECOGNIZED
  }
}

export function vulnerabilityAffectedStatusToJSON(object: VulnerabilityAffectedStatus): string {
  switch (object) {
    case VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_UNKNOWN:
      return 'VULNERABILITY_AFFECTED_STATUS_UNKNOWN'
    case VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_AFFECTED:
      return 'VULNERABILITY_AFFECTED_STATUS_AFFECTED'
    case VulnerabilityAffectedStatus.VULNERABILITY_AFFECTED_STATUS_NOT_AFFECTED:
      return 'VULNERABILITY_AFFECTED_STATUS_NOT_AFFECTED'
    case VulnerabilityAffectedStatus.UNRECOGNIZED:
    default:
      return 'UNRECOGNIZED'
  }
}

/** Specifies attributes of the text */
export interface AttachedText {
  /** Specifies the content type of the text. Defaults to text/plain if not specified. */
  contentType?: string | undefined
  /** Specifies the optional encoding the text is represented in */
  encoding?: string | undefined
  /** SimpleContent value of element. Proactive controls such as input validation and sanitization should be employed to prevent misuse of attachment text. */
  value: string
}

export interface Bom {
  /** The version of the CycloneDX specification a BOM is written to (starting at version 1.3) */
  specVersion: string
  /** The version allows component publishers/authors to make changes to existing BOMs to update various aspects of the document such as description or licenses. When a system is presented with multiple BOMs for the same component, the system should use the most recent version of the BOM. The default version is '1' and should be incremented for each version of the BOM that is published. Each version of a component should have a unique BOM and if no changes are made to the BOMs, then each BOM will have a version of '1'. */
  version?: number | undefined
  /** Every BOM generated should have a unique serial number, even if the contents of the BOM being generated have not changed over time. The process or tool responsible for creating the BOM should create random UUID's for every BOM generated. */
  serialNumber?: string | undefined
  /** Provides additional information about a BOM. */
  metadata?: Metadata | undefined
  /** Provides the ability to document a list of components. */
  components: Component[]
  /** Provides the ability to document a list of external services. */
  services: Service[]
  /** Provides the ability to document external references related to the BOM or to the project the BOM describes. */
  externalReferences: ExternalReference[]
  /** Provides the ability to document dependency relationships. */
  dependencies: Dependency[]
  /** Provides the ability to document aggregate completeness */
  compositions: Composition[]
  /** Vulnerabilities identified in components or services. */
  vulnerabilities: Vulnerability[]
}

export interface Commit {
  /** A unique identifier of the commit. This may be version control specific. For example, Subversion uses revision numbers whereas git uses commit hashes. */
  uid?: string | undefined
  /** The URL to the commit. This URL will typically point to a commit in a version control system. */
  url?: string | undefined
  /** The author who created the changes in the commit */
  author?: IdentifiableAction | undefined
  /** The person who committed or pushed the commit */
  committer?: IdentifiableAction | undefined
  /** The text description of the contents of the commit */
  message?: string | undefined
}

export interface Component {
  /** Specifies the type of component. For software components, classify as application if no more specific appropriate classification is available or cannot be determined for the component. */
  type: Classification
  /** The optional mime-type of the component. When used on file components, the mime-type can provide additional context about the kind of file being represented such as an image, font, or executable. Some library or framework components may also have an associated mime-type. */
  mimeType?: string | undefined
  /** An optional identifier which can be used to reference the component elsewhere in the BOM. Uniqueness is enforced within all elements and children of the root-level bom element. */
  bomRef?: string | undefined
  /** The organization that supplied the component. The supplier may often be the manufacture, but may also be a distributor or repackager. */
  supplier?: OrganizationalEntity | undefined
  /** The person(s) or organization(s) that authored the component */
  author?: string | undefined
  /** The person(s) or organization(s) that published the component */
  publisher?: string | undefined
  /** The grouping name or identifier. This will often be a shortened, single name of the company or project that produced the component, or the source package or domain name. Whitespace and special characters should be avoided. Examples include: apache, org.apache.commons, and apache.org. */
  group?: string | undefined
  /** The name of the component. This will often be a shortened, single name of the component. Examples: commons-lang3 and jquery */
  name: string
  /** The component version. The version should ideally comply with semantic versioning but is not enforced. Version was made optional in v1.4 of the spec. For backward compatibility, it is RECOMMENDED to use an empty string to represent components without version information. */
  version: string
  /** Specifies a description for the component */
  description?: string | undefined
  /** Specifies the scope of the component. If scope is not specified, 'runtime' scope should be assumed by the consumer of the BOM */
  scope?: Scope | undefined
  hashes: Hash[]
  licenses: LicenseChoice[]
  /** An optional copyright notice informing users of the underlying claims to copyright ownership in a published work. */
  copyright?: string | undefined
  /** DEPRECATED - DO NOT USE. This will be removed in a future version. Specifies a well-formed CPE name. See https://nvd.nist.gov/products/cpe */
  cpe?: string | undefined
  /** Specifies the package-url (PURL). The purl, if specified, must be valid and conform to the specification defined at: https://github.com/package-url/purl-spec */
  purl?: string | undefined
  /** Specifies metadata and content for ISO-IEC 19770-2 Software Identification (SWID) Tags. */
  swid?: Swid | undefined
  /** DEPRECATED - DO NOT USE. This will be removed in a future version. Use the pedigree element instead to supply information on exactly how the component was modified. A boolean value indicating is the component has been modified from the original. A value of true indicates the component is a derivative of the original. A value of false indicates the component has not been modified from the original. */
  modified?: boolean | undefined
  /** Component pedigree is a way to document complex supply chain scenarios where components are created, distributed, modified, redistributed, combined with other components, etc. */
  pedigree?: Pedigree | undefined
  /** Provides the ability to document external references related to the component or to the project the component describes. */
  externalReferences: ExternalReference[]
  /** Specifies optional sub-components. This is not a dependency tree. It provides a way to specify a hierarchical representation of component assemblies, similar to system -> subsystem -> parts assembly in physical supply chains. */
  components: Component[]
  /** Specifies optional, custom, properties */
  properties: Property[]
  /** Specifies optional license and copyright evidence */
  evidence: Evidence[]
  /** Specifies optional release notes. */
  releaseNotes?: ReleaseNotes | undefined
}

/** Specifies the data classification. */
export interface DataClassification {
  /** Specifies the flow direction of the data. */
  flow: DataFlow
  /** SimpleContent value of element */
  value: string
}

export interface Dependency {
  /** References a component or service by the its bom-ref attribute */
  ref: string
  dependencies: Dependency[]
}

export interface Diff {
  /** Specifies the optional text of the diff */
  text?: AttachedText | undefined
  /** Specifies the URL to the diff */
  url?: string | undefined
}

export interface ExternalReference {
  /** Specifies the type of external reference. There are built-in types to describe common references. If a type does not exist for the reference being referred to, use the "other" type. */
  type: ExternalReferenceType
  /** The URL to the external reference */
  url: string
  /** An optional comment describing the external reference */
  comment?: string | undefined
  /** Optional integrity hashes for the external resource content */
  hashes: Hash[]
}

/** Specifies the file hash of the component */
export interface Hash {
  /** Specifies the algorithm used to create the hash */
  alg: HashAlg
  /** SimpleContent value of element */
  value: string
}

export interface IdentifiableAction {
  /** The timestamp in which the action occurred */
  timestamp?: Date | undefined
  /** The name of the individual who performed the action */
  name?: string | undefined
  /** The email address of the individual who performed the action */
  email?: string | undefined
}

export interface Issue {
  /** Specifies the type of issue */
  type: IssueClassification
  /** The identifier of the issue assigned by the source of the issue */
  id?: string | undefined
  /** The name of the issue */
  name?: string | undefined
  /** A description of the issue */
  description?: string | undefined
  source?: Source | undefined
  references: string[]
}

/** The source of the issue where it is documented. */
export interface Source {
  /** The name of the source. For example "National Vulnerability Database", "NVD", and "Apache" */
  name?: string | undefined
  /** The url of the issue documentation as provided by the source */
  url?: string | undefined
}

export interface LicenseChoice {
  license?: License | undefined
  expression?: string | undefined
}

export interface License {
  /** A valid SPDX license ID */
  id?: string | undefined
  /** If SPDX does not define the license used, this field may be used to provide the license name */
  name?: string | undefined
  /** Specifies the optional full text of the attachment */
  text?: AttachedText | undefined
  /** The URL to the attachment file. If the attachment is a license or BOM, an externalReference should also be specified for completeness. */
  url?: string | undefined
}

export interface Metadata {
  /** The date and time (timestamp) when the document was created. */
  timestamp?: Date | undefined
  /** The tool(s) used in the creation of the BOM. */
  tools: Tool[]
  /** The person(s) who created the BOM. Authors are common in BOMs created through manual processes. BOMs created through automated means may not have authors. */
  authors: OrganizationalContact[]
  /** The component that the BOM describes. */
  component?: Component | undefined
  /** The organization that manufactured the component that the BOM describes. */
  manufacture?: OrganizationalEntity | undefined
  /** The organization that supplied the component that the BOM describes. The supplier may often be the manufacture, but may also be a distributor or repackager. */
  supplier?: OrganizationalEntity | undefined
  /** The license information for the BOM document */
  licenses?: LicenseChoice | undefined
  /** Specifies optional, custom, properties */
  properties: Property[]
}

export interface OrganizationalContact {
  /** The name of the contact */
  name?: string | undefined
  /** The email address of the contact. */
  email?: string | undefined
  /** The phone number of the contact. */
  phone?: string | undefined
}

export interface OrganizationalEntity {
  /** The name of the organization */
  name?: string | undefined
  /** The URL of the organization. Multiple URLs are allowed. */
  url: string[]
  /** A contact person at the organization. Multiple contacts are allowed. */
  contact: OrganizationalContact[]
}

export interface Patch {
  /** Specifies the purpose for the patch including the resolution of defects, security issues, or new behavior or functionality */
  type: PatchClassification
  /** The patch file (or diff) that show changes. Refer to https://en.wikipedia.org/wiki/Diff */
  diff?: Diff | undefined
  resolves: Issue[]
}

/** Component pedigree is a way to document complex supply chain scenarios where components are created, distributed, modified, redistributed, combined with other components, etc. Pedigree supports viewing this complex chain from the beginning, the end, or anywhere in the middle. It also provides a way to document variants where the exact relation may not be known. */
export interface Pedigree {
  /** Describes zero or more components in which a component is derived from. This is commonly used to describe forks from existing projects where the forked version contains a ancestor node containing the original component it was forked from. For example, Component A is the original component. Component B is the component being used and documented in the BOM. However, Component B contains a pedigree node with a single ancestor documenting Component A - the original component from which Component B is derived from. */
  ancestors: Component[]
  /** Descendants are the exact opposite of ancestors. This provides a way to document all forks (and their forks) of an original or root component. */
  descendants: Component[]
  /** Variants describe relations where the relationship between the components are not known. For example, if Component A contains nearly identical code to Component B. They are both related, but it is unclear if one is derived from the other, or if they share a common ancestor. */
  variants: Component[]
  /** A list of zero or more commits which provide a trail describing how the component deviates from an ancestor, descendant, or variant. */
  commits: Commit[]
  /** A list of zero or more patches describing how the component deviates from an ancestor, descendant, or variant. Patches may be complimentary to commits or may be used in place of commits. */
  patches: Patch[]
  /** Notes, observations, and other non-structured commentary describing the components pedigree. */
  notes?: string | undefined
}

export interface Service {
  /** An optional identifier which can be used to reference the service elsewhere in the BOM. Uniqueness is enforced within all elements and children of the root-level bom element. */
  bomRef?: string | undefined
  /** The organization that provides the service. */
  provider?: OrganizationalEntity | undefined
  /** The grouping name, namespace, or identifier. This will often be a shortened, single name of the company or project that produced the service or domain name. Whitespace and special characters should be avoided. */
  group?: string | undefined
  /** The name of the service. This will often be a shortened, single name of the service. */
  name: string
  /** The service version. */
  version?: string | undefined
  /** Specifies a description for the service. */
  description?: string | undefined
  endpoints: string[]
  /** A boolean value indicating if the service requires authentication. A value of true indicates the service requires authentication prior to use. A value of false indicates the service does not require authentication. */
  authenticated?: boolean | undefined
  /** A boolean value indicating if use of the service crosses a trust zone or boundary. A value of true indicates that by using the service, a trust boundary is crossed. A value of false indicates that by using the service, a trust boundary is not crossed. */
  xTrustBoundary?: boolean | undefined
  data: DataClassification[]
  licenses: LicenseChoice[]
  /** Provides the ability to document external references related to the service. */
  externalReferences: ExternalReference[]
  /** Specifies optional sub-service. This is not a dependency tree. It provides a way to specify a hierarchical representation of service assemblies, similar to system -> subsystem -> parts assembly in physical supply chains. */
  services: Service[]
  /** Specifies optional, custom, properties */
  properties: Property[]
  /** Specifies optional release notes. */
  releaseNotes?: ReleaseNotes | undefined
}

export interface Swid {
  /** Maps to the tagId of a SoftwareIdentity. */
  tagId: string
  /** Maps to the name of a SoftwareIdentity. */
  name: string
  /** Maps to the version of a SoftwareIdentity. */
  version?: string | undefined
  /** Maps to the tagVersion of a SoftwareIdentity. */
  tagVersion?: number | undefined
  /** Maps to the patch of a SoftwareIdentity. */
  patch?: boolean | undefined
  /** Specifies the full content of the SWID tag. */
  text?: AttachedText | undefined
  /** The URL to the SWID file. */
  url?: string | undefined
}

/** Specifies a tool (manual or automated). */
export interface Tool {
  /** The vendor of the tool used to create the BOM. */
  vendor?: string | undefined
  /** The name of the tool used to create the BOM. */
  name?: string | undefined
  /** The version of the tool used to create the BOM. */
  version?: string | undefined
  hashes: Hash[]
  /** Provides the ability to document external references related to the tool. */
  externalReferences: ExternalReference[]
}

/** Specifies a property */
export interface Property {
  name: string
  value?: string | undefined
}

export interface Composition {
  /** Indicates the aggregate completeness */
  aggregate: Aggregate
  /** The assemblies the aggregate completeness applies to */
  assemblies: string[]
  /** The dependencies the aggregate completeness applies to */
  dependencies: string[]
}

export interface EvidenceCopyright {
  /** Copyright text */
  text: string
}

export interface Evidence {
  licenses: LicenseChoice[]
  copyright: EvidenceCopyright[]
}

export interface Note {
  /** The ISO-639 (or higher) language code and optional ISO-3166 (or higher) country code. Examples include: "en", "en-US", "fr" and "fr-CA". */
  locale?: string | undefined
  /** Specifies the full content of the release note. */
  text?: AttachedText | undefined
}

export interface ReleaseNotes {
  /** The software versioning type. It is RECOMMENDED that the release type use one of 'major', 'minor', 'patch', 'pre-release', or 'internal'. Representing all possible software release types is not practical, so standardizing on the recommended values, whenever possible, is strongly encouraged. */
  type: string
  /** The title of the release. */
  title?: string | undefined
  /** The URL to an image that may be prominently displayed with the release note. */
  featuredImage?: string | undefined
  /** The URL to an image that may be used in messaging on social media platforms. */
  socialImage?: string | undefined
  /** A short description of the release. */
  description?: string | undefined
  /** The date and time (timestamp) when the release note was created. */
  timestamp?: Date | undefined
  /** Optional alternate names the release may be referred to. This may include unofficial terms used by development and marketing teams (e.g. code names). */
  aliases: string[]
  /** Optional tags that may aid in search or retrieval of the release note. */
  tags: string[]
  /** A collection of issues that have been resolved. */
  resolves: Issue[]
  /** Zero or more release notes containing the locale and content. Multiple note messages may be specified to support release notes in a wide variety of languages. */
  notes: Note[]
  /** Specifies optional, custom, properties */
  properties: Property[]
}

export interface Vulnerability {
  /** An optional identifier which can be used to reference the vulnerability elsewhere in the BOM. Uniqueness is enforced within all elements and children of the root-level bom element. */
  bomRef?: string | undefined
  /** The identifier that uniquely identifies the vulnerability. */
  id?: string | undefined
  /** The source that published the vulnerability. */
  source?: Source | undefined
  /** Zero or more pointers to vulnerabilities that are the equivalent of the vulnerability specified. Often times, the same vulnerability may exist in multiple sources of vulnerability intelligence, but have different identifiers. References provide a way to correlate vulnerabilities across multiple sources of vulnerability intelligence. */
  references: VulnerabilityReference[]
  /** List of vulnerability ratings */
  ratings: VulnerabilityRating[]
  /** List of Common Weaknesses Enumerations (CWEs) codes that describes this vulnerability. For example 399 (of https://cwe.mitre.org/data/definitions/399.html) */
  cwes: number[]
  /** A description of the vulnerability as provided by the source. */
  description?: string | undefined
  /** If available, an in-depth description of the vulnerability as provided by the source organization. Details often include examples, proof-of-concepts, and other information useful in understanding root cause. */
  detail?: string | undefined
  /** Recommendations of how the vulnerability can be remediated or mitigated. */
  recommendation?: string | undefined
  /** Published advisories of the vulnerability if provided. */
  advisories: Advisory[]
  /** The date and time (timestamp) when the vulnerability record was created in the vulnerability database. */
  created?: Date | undefined
  /** The date and time (timestamp) when the vulnerability record was first published. */
  published?: Date | undefined
  /** The date and time (timestamp) when the vulnerability record was last updated. */
  updated?: Date | undefined
  /** Individuals or organizations credited with the discovery of the vulnerability. */
  credits?: VulnerabilityCredits | undefined
  /** The tool(s) used to identify, confirm, or score the vulnerability. */
  tools: Tool[]
  /** An assessment of the impact and exploitability of the vulnerability. */
  analysis?: VulnerabilityAnalysis | undefined
  /** affects */
  affects: VulnerabilityAffects[]
  /** Specifies optional, custom, properties */
  properties: Property[]
}

export interface VulnerabilityReference {
  /** An identifier that uniquely identifies the vulnerability. */
  id?: string | undefined
  /** The source that published the vulnerability. */
  source?: Source | undefined
}

export interface VulnerabilityRating {
  /** The source that calculated the severity or risk rating of the vulnerability. */
  source?: Source | undefined
  /** The numerical score of the rating. */
  score?: number | undefined
  /** Textual representation of the severity that corresponds to the numerical score of the rating. */
  severity?: Severity | undefined
  /** Specifies the severity or risk scoring methodology or standard used. */
  method?: ScoreMethod | undefined
  /** Textual representation of the metric values used to score the vulnerability. */
  vector?: string | undefined
  /** An optional reason for rating the vulnerability as it was. */
  justification?: string | undefined
}

export interface Advisory {
  /** An optional name of the advisory. */
  title?: string | undefined
  /** Location where the advisory can be obtained. */
  url: string
}

export interface VulnerabilityCredits {
  /** The organizations credited with vulnerability discovery. */
  organizations: OrganizationalEntity[]
  /** The individuals, not associated with organizations, that are credited with vulnerability discovery. */
  individuals: OrganizationalContact[]
}

export interface VulnerabilityAnalysis {
  /** Declares the current state of an occurrence of a vulnerability, after automated or manual analysis. */
  state?: ImpactAnalysisState | undefined
  /** The rationale of why the impact analysis state was asserted. */
  justification?: ImpactAnalysisJustification | undefined
  /** A response to the vulnerability by the manufacturer, supplier, or project responsible for the affected component or service. More than one response is allowed. Responses are strongly encouraged for vulnerabilities where the analysis state is exploitable. */
  response: VulnerabilityResponse[]
  /** Detailed description of the impact including methods used during assessment. If a vulnerability is not exploitable, this field should include specific details on why the component or service is not impacted by this vulnerability. */
  detail?: string | undefined
}

export interface VulnerabilityAffects {
  /** References a component or service by the objects bom-ref */
  ref: string
  /** Zero or more individual versions or range of versions. */
  versions: VulnerabilityAffectedVersions[]
}

export interface VulnerabilityAffectedVersions {
  /** A single version of a component or service. */
  version?: string | undefined
  /** A version range specified in Package URL Version Range syntax (vers) which is defined at https://github.com/package-url/purl-spec/VERSION-RANGE-SPEC.rst */
  range?: string | undefined
  /** The vulnerability status for the version or range of versions. */
  status?: VulnerabilityAffectedStatus | undefined
}

function createBaseAttachedText(): AttachedText {
  return {contentType: undefined, encoding: undefined, value: ''}
}

export const AttachedText = {
  encode(message: AttachedText, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.contentType !== undefined) {
      writer.uint32(10).string(message.contentType)
    }
    if (message.encoding !== undefined) {
      writer.uint32(18).string(message.encoding)
    }
    if (message.value !== '') {
      writer.uint32(26).string(message.value)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): AttachedText {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseAttachedText()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.contentType = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.encoding = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.value = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): AttachedText {
    return {
      contentType: isSet(object.contentType) ? String(object.contentType) : undefined,
      encoding: isSet(object.encoding) ? String(object.encoding) : undefined,
      value: isSet(object.value) ? String(object.value) : '',
    }
  },

  toJSON(message: AttachedText): unknown {
    const obj: any = {}
    if (message.contentType !== undefined) {
      obj.contentType = message.contentType
    }
    if (message.encoding !== undefined) {
      obj.encoding = message.encoding
    }
    if (message.value !== '') {
      obj.value = message.value
    }
    return obj
  },

  create<I extends Exact<DeepPartial<AttachedText>, I>>(base?: I): AttachedText {
    return AttachedText.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<AttachedText>, I>>(object: I): AttachedText {
    const message = createBaseAttachedText()
    message.contentType = object.contentType ?? undefined
    message.encoding = object.encoding ?? undefined
    message.value = object.value ?? ''
    return message
  },
}

function createBaseBom(): Bom {
  return {
    specVersion: '',
    version: undefined,
    serialNumber: undefined,
    metadata: undefined,
    components: [],
    services: [],
    externalReferences: [],
    dependencies: [],
    compositions: [],
    vulnerabilities: [],
  }
}

// @ts-ignore
export const Bom = {
  encode(message: Bom, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.specVersion !== '') {
      writer.uint32(10).string(message.specVersion)
    }
    if (message.version !== undefined) {
      writer.uint32(16).int32(message.version)
    }
    if (message.serialNumber !== undefined) {
      writer.uint32(26).string(message.serialNumber)
    }
    if (message.metadata !== undefined) {
      Metadata.encode(message.metadata, writer.uint32(34).fork()).ldelim()
    }
    for (const v of message.components) {
      Component.encode(v!, writer.uint32(42).fork()).ldelim()
    }
    for (const v of message.services) {
      Service.encode(v!, writer.uint32(50).fork()).ldelim()
    }
    for (const v of message.externalReferences) {
      ExternalReference.encode(v!, writer.uint32(58).fork()).ldelim()
    }
    for (const v of message.dependencies) {
      Dependency.encode(v!, writer.uint32(66).fork()).ldelim()
    }
    for (const v of message.compositions) {
      Composition.encode(v!, writer.uint32(74).fork()).ldelim()
    }
    for (const v of message.vulnerabilities) {
      Vulnerability.encode(v!, writer.uint32(82).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Bom {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseBom()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.specVersion = reader.string()
          continue
        case 2:
          if (tag !== 16) {
            break
          }

          message.version = reader.int32()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.serialNumber = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.metadata = Metadata.decode(reader, reader.uint32())
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.components.push(Component.decode(reader, reader.uint32()))
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.services.push(Service.decode(reader, reader.uint32()))
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.externalReferences.push(ExternalReference.decode(reader, reader.uint32()))
          continue
        case 8:
          if (tag !== 66) {
            break
          }

          message.dependencies.push(Dependency.decode(reader, reader.uint32()))
          continue
        case 9:
          if (tag !== 74) {
            break
          }

          message.compositions.push(Composition.decode(reader, reader.uint32()))
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.vulnerabilities.push(Vulnerability.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Bom {
    return {
      specVersion: isSet(object.specVersion) ? String(object.specVersion) : '',
      version: isSet(object.version) ? Number(object.version) : undefined,
      serialNumber: isSet(object.serialNumber) ? String(object.serialNumber) : undefined,
      metadata: isSet(object.metadata) ? Metadata.fromJSON(object.metadata) : undefined,
      components: Array.isArray(object?.components) ? object.components.map((e: any) => Component.fromJSON(e)) : [],
      services: Array.isArray(object?.services) ? object.services.map((e: any) => Service.fromJSON(e)) : [],
      externalReferences: Array.isArray(object?.externalReferences)
        ? object.externalReferences.map((e: any) => ExternalReference.fromJSON(e))
        : [],
      dependencies: Array.isArray(object?.dependencies)
        ? object.dependencies.map((e: any) => Dependency.fromJSON(e))
        : [],
      compositions: Array.isArray(object?.compositions)
        ? object.compositions.map((e: any) => Composition.fromJSON(e))
        : [],
      vulnerabilities: Array.isArray(object?.vulnerabilities)
        ? object.vulnerabilities.map((e: any) => Vulnerability.fromJSON(e))
        : [],
    }
  },

  toJSON(message: Bom): unknown {
    const obj: any = {}
    if (message.specVersion !== '') {
      obj.specVersion = message.specVersion
    }
    if (message.version !== undefined) {
      obj.version = Math.round(message.version)
    }
    if (message.serialNumber !== undefined) {
      obj.serialNumber = message.serialNumber
    }
    if (message.metadata !== undefined) {
      obj.metadata = Metadata.toJSON(message.metadata)
    }
    if (message.components?.length) {
      obj.components = message.components.map((e) => Component.toJSON(e))
    }
    if (message.services?.length) {
      obj.services = message.services.map((e) => Service.toJSON(e))
    }
    if (message.externalReferences?.length) {
      obj.externalReferences = message.externalReferences.map((e) => ExternalReference.toJSON(e))
    }
    if (message.dependencies?.length) {
      obj.dependencies = message.dependencies.map((e) => Dependency.toJSON(e))
    }
    if (message.compositions?.length) {
      obj.compositions = message.compositions.map((e) => Composition.toJSON(e))
    }
    if (message.vulnerabilities?.length) {
      obj.vulnerabilities = message.vulnerabilities.map((e) => Vulnerability.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Bom>, I>>(base?: I): Bom {
    return Bom.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Bom>, I>>(object: I): Bom {
    const message = createBaseBom()
    message.specVersion = object.specVersion ?? ''
    message.version = object.version ?? undefined
    message.serialNumber = object.serialNumber ?? undefined
    message.metadata =
      object.metadata !== undefined && object.metadata !== null ? Metadata.fromPartial(object.metadata) : undefined
    message.components = object.components?.map((e) => Component.fromPartial(e)) || []
    message.services = object.services?.map((e) => Service.fromPartial(e)) || []
    message.externalReferences = object.externalReferences?.map((e) => ExternalReference.fromPartial(e)) || []
    message.dependencies = object.dependencies?.map((e) => Dependency.fromPartial(e)) || []
    message.compositions = object.compositions?.map((e) => Composition.fromPartial(e)) || []
    message.vulnerabilities = object.vulnerabilities?.map((e) => Vulnerability.fromPartial(e)) || []
    return message
  },
}

function createBaseCommit(): Commit {
  return {uid: undefined, url: undefined, author: undefined, committer: undefined, message: undefined}
}

export const Commit = {
  encode(message: Commit, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.uid !== undefined) {
      writer.uint32(10).string(message.uid)
    }
    if (message.url !== undefined) {
      writer.uint32(18).string(message.url)
    }
    if (message.author !== undefined) {
      IdentifiableAction.encode(message.author, writer.uint32(26).fork()).ldelim()
    }
    if (message.committer !== undefined) {
      IdentifiableAction.encode(message.committer, writer.uint32(34).fork()).ldelim()
    }
    if (message.message !== undefined) {
      writer.uint32(42).string(message.message)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Commit {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseCommit()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.uid = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.author = IdentifiableAction.decode(reader, reader.uint32())
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.committer = IdentifiableAction.decode(reader, reader.uint32())
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.message = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Commit {
    return {
      uid: isSet(object.uid) ? String(object.uid) : undefined,
      url: isSet(object.url) ? String(object.url) : undefined,
      author: isSet(object.author) ? IdentifiableAction.fromJSON(object.author) : undefined,
      committer: isSet(object.committer) ? IdentifiableAction.fromJSON(object.committer) : undefined,
      message: isSet(object.message) ? String(object.message) : undefined,
    }
  },

  toJSON(message: Commit): unknown {
    const obj: any = {}
    if (message.uid !== undefined) {
      obj.uid = message.uid
    }
    if (message.url !== undefined) {
      obj.url = message.url
    }
    if (message.author !== undefined) {
      obj.author = IdentifiableAction.toJSON(message.author)
    }
    if (message.committer !== undefined) {
      obj.committer = IdentifiableAction.toJSON(message.committer)
    }
    if (message.message !== undefined) {
      obj.message = message.message
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Commit>, I>>(base?: I): Commit {
    return Commit.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Commit>, I>>(object: I): Commit {
    const message = createBaseCommit()
    message.uid = object.uid ?? undefined
    message.url = object.url ?? undefined
    message.author =
      object.author !== undefined && object.author !== null ? IdentifiableAction.fromPartial(object.author) : undefined
    message.committer =
      object.committer !== undefined && object.committer !== null
        ? IdentifiableAction.fromPartial(object.committer)
        : undefined
    message.message = object.message ?? undefined
    return message
  },
}

function createBaseComponent(): Component {
  return {
    type: 0,
    mimeType: undefined,
    bomRef: undefined,
    supplier: undefined,
    author: undefined,
    publisher: undefined,
    group: undefined,
    name: '',
    version: '',
    description: undefined,
    scope: undefined,
    hashes: [],
    licenses: [],
    copyright: undefined,
    cpe: undefined,
    purl: undefined,
    swid: undefined,
    modified: undefined,
    pedigree: undefined,
    externalReferences: [],
    components: [],
    properties: [],
    evidence: [],
    releaseNotes: undefined,
  }
}

// @ts-ignore
export const Component = {
  encode(message: Component, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type)
    }
    if (message.mimeType !== undefined) {
      writer.uint32(18).string(message.mimeType)
    }
    if (message.bomRef !== undefined) {
      writer.uint32(26).string(message.bomRef)
    }
    if (message.supplier !== undefined) {
      OrganizationalEntity.encode(message.supplier, writer.uint32(34).fork()).ldelim()
    }
    if (message.author !== undefined) {
      writer.uint32(42).string(message.author)
    }
    if (message.publisher !== undefined) {
      writer.uint32(50).string(message.publisher)
    }
    if (message.group !== undefined) {
      writer.uint32(58).string(message.group)
    }
    if (message.name !== '') {
      writer.uint32(66).string(message.name)
    }
    if (message.version !== '') {
      writer.uint32(74).string(message.version)
    }
    if (message.description !== undefined) {
      writer.uint32(82).string(message.description)
    }
    if (message.scope !== undefined) {
      writer.uint32(88).int32(message.scope)
    }
    for (const v of message.hashes) {
      Hash.encode(v!, writer.uint32(98).fork()).ldelim()
    }
    for (const v of message.licenses) {
      LicenseChoice.encode(v!, writer.uint32(106).fork()).ldelim()
    }
    if (message.copyright !== undefined) {
      writer.uint32(114).string(message.copyright)
    }
    if (message.cpe !== undefined) {
      writer.uint32(122).string(message.cpe)
    }
    if (message.purl !== undefined) {
      writer.uint32(130).string(message.purl)
    }
    if (message.swid !== undefined) {
      Swid.encode(message.swid, writer.uint32(138).fork()).ldelim()
    }
    if (message.modified !== undefined) {
      writer.uint32(144).bool(message.modified)
    }
    if (message.pedigree !== undefined) {
      Pedigree.encode(message.pedigree, writer.uint32(154).fork()).ldelim()
    }
    for (const v of message.externalReferences) {
      ExternalReference.encode(v!, writer.uint32(162).fork()).ldelim()
    }
    for (const v of message.components) {
      Component.encode(v!, writer.uint32(170).fork()).ldelim()
    }
    for (const v of message.properties) {
      Property.encode(v!, writer.uint32(178).fork()).ldelim()
    }
    for (const v of message.evidence) {
      Evidence.encode(v!, writer.uint32(186).fork()).ldelim()
    }
    if (message.releaseNotes !== undefined) {
      ReleaseNotes.encode(message.releaseNotes, writer.uint32(194).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Component {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseComponent()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.type = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.mimeType = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.bomRef = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.supplier = OrganizationalEntity.decode(reader, reader.uint32())
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.author = reader.string()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.publisher = reader.string()
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.group = reader.string()
          continue
        case 8:
          if (tag !== 66) {
            break
          }

          message.name = reader.string()
          continue
        case 9:
          if (tag !== 74) {
            break
          }

          message.version = reader.string()
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.description = reader.string()
          continue
        case 11:
          if (tag !== 88) {
            break
          }

          message.scope = reader.int32() as any
          continue
        case 12:
          if (tag !== 98) {
            break
          }

          message.hashes.push(Hash.decode(reader, reader.uint32()))
          continue
        case 13:
          if (tag !== 106) {
            break
          }

          message.licenses.push(LicenseChoice.decode(reader, reader.uint32()))
          continue
        case 14:
          if (tag !== 114) {
            break
          }

          message.copyright = reader.string()
          continue
        case 15:
          if (tag !== 122) {
            break
          }

          message.cpe = reader.string()
          continue
        case 16:
          if (tag !== 130) {
            break
          }

          message.purl = reader.string()
          continue
        case 17:
          if (tag !== 138) {
            break
          }

          message.swid = Swid.decode(reader, reader.uint32())
          continue
        case 18:
          if (tag !== 144) {
            break
          }

          message.modified = reader.bool()
          continue
        case 19:
          if (tag !== 154) {
            break
          }

          message.pedigree = Pedigree.decode(reader, reader.uint32())
          continue
        case 20:
          if (tag !== 162) {
            break
          }

          message.externalReferences.push(ExternalReference.decode(reader, reader.uint32()))
          continue
        case 21:
          if (tag !== 170) {
            break
          }

          message.components.push(Component.decode(reader, reader.uint32()))
          continue
        case 22:
          if (tag !== 178) {
            break
          }

          message.properties.push(Property.decode(reader, reader.uint32()))
          continue
        case 23:
          if (tag !== 186) {
            break
          }

          message.evidence.push(Evidence.decode(reader, reader.uint32()))
          continue
        case 24:
          if (tag !== 194) {
            break
          }

          message.releaseNotes = ReleaseNotes.decode(reader, reader.uint32())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Component {
    return {
      type: isSet(object.type) ? classificationFromJSON(object.type) : 0,
      mimeType: isSet(object.mimeType) ? String(object.mimeType) : undefined,
      bomRef: isSet(object.bomRef) ? String(object.bomRef) : undefined,
      supplier: isSet(object.supplier) ? OrganizationalEntity.fromJSON(object.supplier) : undefined,
      author: isSet(object.author) ? String(object.author) : undefined,
      publisher: isSet(object.publisher) ? String(object.publisher) : undefined,
      group: isSet(object.group) ? String(object.group) : undefined,
      name: isSet(object.name) ? String(object.name) : '',
      version: isSet(object.version) ? String(object.version) : '',
      description: isSet(object.description) ? String(object.description) : undefined,
      scope: isSet(object.scope) ? scopeFromJSON(object.scope) : undefined,
      hashes: Array.isArray(object?.hashes) ? object.hashes.map((e: any) => Hash.fromJSON(e)) : [],
      licenses: Array.isArray(object?.licenses) ? object.licenses.map((e: any) => LicenseChoice.fromJSON(e)) : [],
      copyright: isSet(object.copyright) ? String(object.copyright) : undefined,
      cpe: isSet(object.cpe) ? String(object.cpe) : undefined,
      purl: isSet(object.purl) ? String(object.purl) : undefined,
      swid: isSet(object.swid) ? Swid.fromJSON(object.swid) : undefined,
      modified: isSet(object.modified) ? Boolean(object.modified) : undefined,
      pedigree: isSet(object.pedigree) ? Pedigree.fromJSON(object.pedigree) : undefined,
      externalReferences: Array.isArray(object?.externalReferences)
        ? object.externalReferences.map((e: any) => ExternalReference.fromJSON(e))
        : [],
      components: Array.isArray(object?.components) ? object.components.map((e: any) => Component.fromJSON(e)) : [],
      properties: Array.isArray(object?.properties) ? object.properties.map((e: any) => Property.fromJSON(e)) : [],
      evidence: Array.isArray(object?.evidence) ? object.evidence.map((e: any) => Evidence.fromJSON(e)) : [],
      releaseNotes: isSet(object.releaseNotes) ? ReleaseNotes.fromJSON(object.releaseNotes) : undefined,
    }
  },

  toJSON(message: Component): unknown {
    const obj: any = {}
    if (message.type !== 0) {
      obj.type = classificationToJSON(message.type)
    }
    if (message.mimeType !== undefined) {
      obj.mimeType = message.mimeType
    }
    if (message.bomRef !== undefined) {
      obj.bomRef = message.bomRef
    }
    if (message.supplier !== undefined) {
      obj.supplier = OrganizationalEntity.toJSON(message.supplier)
    }
    if (message.author !== undefined) {
      obj.author = message.author
    }
    if (message.publisher !== undefined) {
      obj.publisher = message.publisher
    }
    if (message.group !== undefined) {
      obj.group = message.group
    }
    if (message.name !== '') {
      obj.name = message.name
    }
    if (message.version !== '') {
      obj.version = message.version
    }
    if (message.description !== undefined) {
      obj.description = message.description
    }
    if (message.scope !== undefined) {
      obj.scope = scopeToJSON(message.scope)
    }
    if (message.hashes?.length) {
      obj.hashes = message.hashes.map((e) => Hash.toJSON(e))
    }
    if (message.licenses?.length) {
      obj.licenses = message.licenses.map((e) => LicenseChoice.toJSON(e))
    }
    if (message.copyright !== undefined) {
      obj.copyright = message.copyright
    }
    if (message.cpe !== undefined) {
      obj.cpe = message.cpe
    }
    if (message.purl !== undefined) {
      obj.purl = message.purl
    }
    if (message.swid !== undefined) {
      obj.swid = Swid.toJSON(message.swid)
    }
    if (message.modified !== undefined) {
      obj.modified = message.modified
    }
    if (message.pedigree !== undefined) {
      obj.pedigree = Pedigree.toJSON(message.pedigree)
    }
    if (message.externalReferences?.length) {
      obj.externalReferences = message.externalReferences.map((e) => ExternalReference.toJSON(e))
    }
    if (message.components?.length) {
      obj.components = message.components.map((e) => Component.toJSON(e))
    }
    if (message.properties?.length) {
      obj.properties = message.properties.map((e) => Property.toJSON(e))
    }
    if (message.evidence?.length) {
      obj.evidence = message.evidence.map((e) => Evidence.toJSON(e))
    }
    if (message.releaseNotes !== undefined) {
      obj.releaseNotes = ReleaseNotes.toJSON(message.releaseNotes)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Component>, I>>(base?: I): Component {
    return Component.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Component>, I>>(object: I): Component {
    const message = createBaseComponent()
    message.type = object.type ?? 0
    message.mimeType = object.mimeType ?? undefined
    message.bomRef = object.bomRef ?? undefined
    message.supplier =
      object.supplier !== undefined && object.supplier !== null
        ? OrganizationalEntity.fromPartial(object.supplier)
        : undefined
    message.author = object.author ?? undefined
    message.publisher = object.publisher ?? undefined
    message.group = object.group ?? undefined
    message.name = object.name ?? ''
    message.version = object.version ?? ''
    message.description = object.description ?? undefined
    message.scope = object.scope ?? undefined
    message.hashes = object.hashes?.map((e) => Hash.fromPartial(e)) || []
    message.licenses = object.licenses?.map((e) => LicenseChoice.fromPartial(e)) || []
    message.copyright = object.copyright ?? undefined
    message.cpe = object.cpe ?? undefined
    message.purl = object.purl ?? undefined
    message.swid = object.swid !== undefined && object.swid !== null ? Swid.fromPartial(object.swid) : undefined
    message.modified = object.modified ?? undefined
    message.pedigree =
      object.pedigree !== undefined && object.pedigree !== null ? Pedigree.fromPartial(object.pedigree) : undefined
    message.externalReferences = object.externalReferences?.map((e) => ExternalReference.fromPartial(e)) || []
    message.components = object.components?.map((e) => Component.fromPartial(e)) || []
    message.properties = object.properties?.map((e) => Property.fromPartial(e)) || []
    message.evidence = object.evidence?.map((e) => Evidence.fromPartial(e)) || []
    message.releaseNotes =
      object.releaseNotes !== undefined && object.releaseNotes !== null
        ? ReleaseNotes.fromPartial(object.releaseNotes)
        : undefined
    return message
  },
}

function createBaseDataClassification(): DataClassification {
  return {flow: 0, value: ''}
}

export const DataClassification = {
  encode(message: DataClassification, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.flow !== 0) {
      writer.uint32(8).int32(message.flow)
    }
    if (message.value !== '') {
      writer.uint32(18).string(message.value)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): DataClassification {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseDataClassification()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.flow = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.value = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): DataClassification {
    return {
      flow: isSet(object.flow) ? dataFlowFromJSON(object.flow) : 0,
      value: isSet(object.value) ? String(object.value) : '',
    }
  },

  toJSON(message: DataClassification): unknown {
    const obj: any = {}
    if (message.flow !== 0) {
      obj.flow = dataFlowToJSON(message.flow)
    }
    if (message.value !== '') {
      obj.value = message.value
    }
    return obj
  },

  create<I extends Exact<DeepPartial<DataClassification>, I>>(base?: I): DataClassification {
    return DataClassification.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<DataClassification>, I>>(object: I): DataClassification {
    const message = createBaseDataClassification()
    message.flow = object.flow ?? 0
    message.value = object.value ?? ''
    return message
  },
}

function createBaseDependency(): Dependency {
  return {ref: '', dependencies: []}
}

export const Dependency = {
  encode(message: Dependency, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.ref !== '') {
      writer.uint32(10).string(message.ref)
    }
    for (const v of message.dependencies) {
      Dependency.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Dependency {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseDependency()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.ref = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.dependencies.push(Dependency.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Dependency {
    return {
      ref: isSet(object.ref) ? String(object.ref) : '',
      dependencies: Array.isArray(object?.dependencies)
        ? object.dependencies.map((e: any) => Dependency.fromJSON(e))
        : [],
    }
  },

  toJSON(message: Dependency): unknown {
    const obj: any = {}
    if (message.ref !== '') {
      obj.ref = message.ref
    }
    if (message.dependencies?.length) {
      obj.dependencies = message.dependencies.map((e) => Dependency.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Dependency>, I>>(base?: I): Dependency {
    return Dependency.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Dependency>, I>>(object: I): Dependency {
    const message = createBaseDependency()
    message.ref = object.ref ?? ''
    message.dependencies = object.dependencies?.map((e) => Dependency.fromPartial(e)) || []
    return message
  },
}

function createBaseDiff(): Diff {
  return {text: undefined, url: undefined}
}

export const Diff = {
  encode(message: Diff, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.text !== undefined) {
      AttachedText.encode(message.text, writer.uint32(10).fork()).ldelim()
    }
    if (message.url !== undefined) {
      writer.uint32(18).string(message.url)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Diff {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseDiff()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.text = AttachedText.decode(reader, reader.uint32())
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Diff {
    return {
      text: isSet(object.text) ? AttachedText.fromJSON(object.text) : undefined,
      url: isSet(object.url) ? String(object.url) : undefined,
    }
  },

  toJSON(message: Diff): unknown {
    const obj: any = {}
    if (message.text !== undefined) {
      obj.text = AttachedText.toJSON(message.text)
    }
    if (message.url !== undefined) {
      obj.url = message.url
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Diff>, I>>(base?: I): Diff {
    return Diff.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Diff>, I>>(object: I): Diff {
    const message = createBaseDiff()
    message.text = object.text !== undefined && object.text !== null ? AttachedText.fromPartial(object.text) : undefined
    message.url = object.url ?? undefined
    return message
  },
}

function createBaseExternalReference(): ExternalReference {
  return {type: 0, url: '', comment: undefined, hashes: []}
}

export const ExternalReference = {
  encode(message: ExternalReference, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type)
    }
    if (message.url !== '') {
      writer.uint32(18).string(message.url)
    }
    if (message.comment !== undefined) {
      writer.uint32(26).string(message.comment)
    }
    for (const v of message.hashes) {
      Hash.encode(v!, writer.uint32(34).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ExternalReference {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseExternalReference()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.type = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.comment = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.hashes.push(Hash.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): ExternalReference {
    return {
      type: isSet(object.type) ? externalReferenceTypeFromJSON(object.type) : 0,
      url: isSet(object.url) ? String(object.url) : '',
      comment: isSet(object.comment) ? String(object.comment) : undefined,
      hashes: Array.isArray(object?.hashes) ? object.hashes.map((e: any) => Hash.fromJSON(e)) : [],
    }
  },

  toJSON(message: ExternalReference): unknown {
    const obj: any = {}
    if (message.type !== 0) {
      obj.type = externalReferenceTypeToJSON(message.type)
    }
    if (message.url !== '') {
      obj.url = message.url
    }
    if (message.comment !== undefined) {
      obj.comment = message.comment
    }
    if (message.hashes?.length) {
      obj.hashes = message.hashes.map((e) => Hash.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<ExternalReference>, I>>(base?: I): ExternalReference {
    return ExternalReference.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<ExternalReference>, I>>(object: I): ExternalReference {
    const message = createBaseExternalReference()
    message.type = object.type ?? 0
    message.url = object.url ?? ''
    message.comment = object.comment ?? undefined
    message.hashes = object.hashes?.map((e) => Hash.fromPartial(e)) || []
    return message
  },
}

function createBaseHash(): Hash {
  return {alg: 0, value: ''}
}

export const Hash = {
  encode(message: Hash, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.alg !== 0) {
      writer.uint32(8).int32(message.alg)
    }
    if (message.value !== '') {
      writer.uint32(18).string(message.value)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Hash {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseHash()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.alg = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.value = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Hash {
    return {
      alg: isSet(object.alg) ? hashAlgFromJSON(object.alg) : 0,
      value: isSet(object.value) ? String(object.value) : '',
    }
  },

  toJSON(message: Hash): unknown {
    const obj: any = {}
    if (message.alg !== 0) {
      obj.alg = hashAlgToJSON(message.alg)
    }
    if (message.value !== '') {
      obj.value = message.value
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Hash>, I>>(base?: I): Hash {
    return Hash.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Hash>, I>>(object: I): Hash {
    const message = createBaseHash()
    message.alg = object.alg ?? 0
    message.value = object.value ?? ''
    return message
  },
}

function createBaseIdentifiableAction(): IdentifiableAction {
  return {timestamp: undefined, name: undefined, email: undefined}
}

export const IdentifiableAction = {
  encode(message: IdentifiableAction, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.timestamp !== undefined) {
      Timestamp.encode(toTimestamp(message.timestamp), writer.uint32(10).fork()).ldelim()
    }
    if (message.name !== undefined) {
      writer.uint32(18).string(message.name)
    }
    if (message.email !== undefined) {
      writer.uint32(26).string(message.email)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): IdentifiableAction {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseIdentifiableAction()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.timestamp = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.name = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.email = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): IdentifiableAction {
    return {
      timestamp: isSet(object.timestamp) ? fromJsonTimestamp(object.timestamp) : undefined,
      name: isSet(object.name) ? String(object.name) : undefined,
      email: isSet(object.email) ? String(object.email) : undefined,
    }
  },

  toJSON(message: IdentifiableAction): unknown {
    const obj: any = {}
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp.toISOString()
    }
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.email !== undefined) {
      obj.email = message.email
    }
    return obj
  },

  create<I extends Exact<DeepPartial<IdentifiableAction>, I>>(base?: I): IdentifiableAction {
    return IdentifiableAction.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<IdentifiableAction>, I>>(object: I): IdentifiableAction {
    const message = createBaseIdentifiableAction()
    message.timestamp = object.timestamp ?? undefined
    message.name = object.name ?? undefined
    message.email = object.email ?? undefined
    return message
  },
}

function createBaseIssue(): Issue {
  return {type: 0, id: undefined, name: undefined, description: undefined, source: undefined, references: []}
}

export const Issue = {
  encode(message: Issue, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type)
    }
    if (message.id !== undefined) {
      writer.uint32(18).string(message.id)
    }
    if (message.name !== undefined) {
      writer.uint32(26).string(message.name)
    }
    if (message.description !== undefined) {
      writer.uint32(34).string(message.description)
    }
    if (message.source !== undefined) {
      Source.encode(message.source, writer.uint32(42).fork()).ldelim()
    }
    for (const v of message.references) {
      writer.uint32(50).string(v!)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Issue {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseIssue()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.type = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.id = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.name = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.description = reader.string()
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.source = Source.decode(reader, reader.uint32())
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.references.push(reader.string())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Issue {
    return {
      type: isSet(object.type) ? issueClassificationFromJSON(object.type) : 0,
      id: isSet(object.id) ? String(object.id) : undefined,
      name: isSet(object.name) ? String(object.name) : undefined,
      description: isSet(object.description) ? String(object.description) : undefined,
      source: isSet(object.source) ? Source.fromJSON(object.source) : undefined,
      references: Array.isArray(object?.references) ? object.references.map((e: any) => String(e)) : [],
    }
  },

  toJSON(message: Issue): unknown {
    const obj: any = {}
    if (message.type !== 0) {
      obj.type = issueClassificationToJSON(message.type)
    }
    if (message.id !== undefined) {
      obj.id = message.id
    }
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.description !== undefined) {
      obj.description = message.description
    }
    if (message.source !== undefined) {
      obj.source = Source.toJSON(message.source)
    }
    if (message.references?.length) {
      obj.references = message.references
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Issue>, I>>(base?: I): Issue {
    return Issue.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Issue>, I>>(object: I): Issue {
    const message = createBaseIssue()
    message.type = object.type ?? 0
    message.id = object.id ?? undefined
    message.name = object.name ?? undefined
    message.description = object.description ?? undefined
    message.source =
      object.source !== undefined && object.source !== null ? Source.fromPartial(object.source) : undefined
    message.references = object.references?.map((e) => e) || []
    return message
  },
}

function createBaseSource(): Source {
  return {name: undefined, url: undefined}
}

export const Source = {
  encode(message: Source, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== undefined) {
      writer.uint32(10).string(message.name)
    }
    if (message.url !== undefined) {
      writer.uint32(18).string(message.url)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Source {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseSource()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.name = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Source {
    return {
      name: isSet(object.name) ? String(object.name) : undefined,
      url: isSet(object.url) ? String(object.url) : undefined,
    }
  },

  toJSON(message: Source): unknown {
    const obj: any = {}
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.url !== undefined) {
      obj.url = message.url
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Source>, I>>(base?: I): Source {
    return Source.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Source>, I>>(object: I): Source {
    const message = createBaseSource()
    message.name = object.name ?? undefined
    message.url = object.url ?? undefined
    return message
  },
}

function createBaseLicenseChoice(): LicenseChoice {
  return {license: undefined, expression: undefined}
}

export const LicenseChoice = {
  encode(message: LicenseChoice, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.license !== undefined) {
      License.encode(message.license, writer.uint32(10).fork()).ldelim()
    }
    if (message.expression !== undefined) {
      writer.uint32(18).string(message.expression)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): LicenseChoice {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseLicenseChoice()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.license = License.decode(reader, reader.uint32())
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.expression = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): LicenseChoice {
    return {
      license: isSet(object.license) ? License.fromJSON(object.license) : undefined,
      expression: isSet(object.expression) ? String(object.expression) : undefined,
    }
  },

  toJSON(message: LicenseChoice): unknown {
    const obj: any = {}
    if (message.license !== undefined) {
      obj.license = License.toJSON(message.license)
    }
    if (message.expression !== undefined) {
      obj.expression = message.expression
    }
    return obj
  },

  create<I extends Exact<DeepPartial<LicenseChoice>, I>>(base?: I): LicenseChoice {
    return LicenseChoice.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<LicenseChoice>, I>>(object: I): LicenseChoice {
    const message = createBaseLicenseChoice()
    message.license =
      object.license !== undefined && object.license !== null ? License.fromPartial(object.license) : undefined
    message.expression = object.expression ?? undefined
    return message
  },
}

function createBaseLicense(): License {
  return {id: undefined, name: undefined, text: undefined, url: undefined}
}

export const License = {
  encode(message: License, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== undefined) {
      writer.uint32(10).string(message.id)
    }
    if (message.name !== undefined) {
      writer.uint32(18).string(message.name)
    }
    if (message.text !== undefined) {
      AttachedText.encode(message.text, writer.uint32(26).fork()).ldelim()
    }
    if (message.url !== undefined) {
      writer.uint32(34).string(message.url)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): License {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseLicense()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.id = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.name = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.text = AttachedText.decode(reader, reader.uint32())
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.url = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): License {
    return {
      id: isSet(object.id) ? String(object.id) : undefined,
      name: isSet(object.name) ? String(object.name) : undefined,
      text: isSet(object.text) ? AttachedText.fromJSON(object.text) : undefined,
      url: isSet(object.url) ? String(object.url) : undefined,
    }
  },

  toJSON(message: License): unknown {
    const obj: any = {}
    if (message.id !== undefined) {
      obj.id = message.id
    }
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.text !== undefined) {
      obj.text = AttachedText.toJSON(message.text)
    }
    if (message.url !== undefined) {
      obj.url = message.url
    }
    return obj
  },

  create<I extends Exact<DeepPartial<License>, I>>(base?: I): License {
    return License.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<License>, I>>(object: I): License {
    const message = createBaseLicense()
    message.id = object.id ?? undefined
    message.name = object.name ?? undefined
    message.text = object.text !== undefined && object.text !== null ? AttachedText.fromPartial(object.text) : undefined
    message.url = object.url ?? undefined
    return message
  },
}

function createBaseMetadata(): Metadata {
  return {
    timestamp: undefined,
    tools: [],
    authors: [],
    component: undefined,
    manufacture: undefined,
    supplier: undefined,
    licenses: undefined,
    properties: [],
  }
}

export const Metadata = {
  encode(message: Metadata, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.timestamp !== undefined) {
      Timestamp.encode(toTimestamp(message.timestamp), writer.uint32(10).fork()).ldelim()
    }
    for (const v of message.tools) {
      Tool.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    for (const v of message.authors) {
      OrganizationalContact.encode(v!, writer.uint32(26).fork()).ldelim()
    }
    if (message.component !== undefined) {
      Component.encode(message.component, writer.uint32(34).fork()).ldelim()
    }
    if (message.manufacture !== undefined) {
      OrganizationalEntity.encode(message.manufacture, writer.uint32(42).fork()).ldelim()
    }
    if (message.supplier !== undefined) {
      OrganizationalEntity.encode(message.supplier, writer.uint32(50).fork()).ldelim()
    }
    if (message.licenses !== undefined) {
      LicenseChoice.encode(message.licenses, writer.uint32(58).fork()).ldelim()
    }
    for (const v of message.properties) {
      Property.encode(v!, writer.uint32(66).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Metadata {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseMetadata()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.timestamp = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.tools.push(Tool.decode(reader, reader.uint32()))
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.authors.push(OrganizationalContact.decode(reader, reader.uint32()))
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.component = Component.decode(reader, reader.uint32())
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.manufacture = OrganizationalEntity.decode(reader, reader.uint32())
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.supplier = OrganizationalEntity.decode(reader, reader.uint32())
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.licenses = LicenseChoice.decode(reader, reader.uint32())
          continue
        case 8:
          if (tag !== 66) {
            break
          }

          message.properties.push(Property.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Metadata {
    return {
      timestamp: isSet(object.timestamp) ? fromJsonTimestamp(object.timestamp) : undefined,
      tools: Array.isArray(object?.tools) ? object.tools.map((e: any) => Tool.fromJSON(e)) : [],
      authors: Array.isArray(object?.authors) ? object.authors.map((e: any) => OrganizationalContact.fromJSON(e)) : [],
      component: isSet(object.component) ? Component.fromJSON(object.component) : undefined,
      manufacture: isSet(object.manufacture) ? OrganizationalEntity.fromJSON(object.manufacture) : undefined,
      supplier: isSet(object.supplier) ? OrganizationalEntity.fromJSON(object.supplier) : undefined,
      licenses: isSet(object.licenses) ? LicenseChoice.fromJSON(object.licenses) : undefined,
      properties: Array.isArray(object?.properties) ? object.properties.map((e: any) => Property.fromJSON(e)) : [],
    }
  },

  toJSON(message: Metadata): unknown {
    const obj: any = {}
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp.toISOString()
    }
    if (message.tools?.length) {
      obj.tools = message.tools.map((e) => Tool.toJSON(e))
    }
    if (message.authors?.length) {
      obj.authors = message.authors.map((e) => OrganizationalContact.toJSON(e))
    }
    if (message.component !== undefined) {
      obj.component = Component.toJSON(message.component)
    }
    if (message.manufacture !== undefined) {
      obj.manufacture = OrganizationalEntity.toJSON(message.manufacture)
    }
    if (message.supplier !== undefined) {
      obj.supplier = OrganizationalEntity.toJSON(message.supplier)
    }
    if (message.licenses !== undefined) {
      obj.licenses = LicenseChoice.toJSON(message.licenses)
    }
    if (message.properties?.length) {
      obj.properties = message.properties.map((e) => Property.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Metadata>, I>>(base?: I): Metadata {
    return Metadata.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Metadata>, I>>(object: I): Metadata {
    const message = createBaseMetadata()
    message.timestamp = object.timestamp ?? undefined
    message.tools = object.tools?.map((e) => Tool.fromPartial(e)) || []
    message.authors = object.authors?.map((e) => OrganizationalContact.fromPartial(e)) || []
    message.component =
      object.component !== undefined && object.component !== null ? Component.fromPartial(object.component) : undefined
    message.manufacture =
      object.manufacture !== undefined && object.manufacture !== null
        ? OrganizationalEntity.fromPartial(object.manufacture)
        : undefined
    message.supplier =
      object.supplier !== undefined && object.supplier !== null
        ? OrganizationalEntity.fromPartial(object.supplier)
        : undefined
    message.licenses =
      object.licenses !== undefined && object.licenses !== null ? LicenseChoice.fromPartial(object.licenses) : undefined
    message.properties = object.properties?.map((e) => Property.fromPartial(e)) || []
    return message
  },
}

function createBaseOrganizationalContact(): OrganizationalContact {
  return {name: undefined, email: undefined, phone: undefined}
}

export const OrganizationalContact = {
  encode(message: OrganizationalContact, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== undefined) {
      writer.uint32(10).string(message.name)
    }
    if (message.email !== undefined) {
      writer.uint32(18).string(message.email)
    }
    if (message.phone !== undefined) {
      writer.uint32(26).string(message.phone)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): OrganizationalContact {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseOrganizationalContact()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.name = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.email = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.phone = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): OrganizationalContact {
    return {
      name: isSet(object.name) ? String(object.name) : undefined,
      email: isSet(object.email) ? String(object.email) : undefined,
      phone: isSet(object.phone) ? String(object.phone) : undefined,
    }
  },

  toJSON(message: OrganizationalContact): unknown {
    const obj: any = {}
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.email !== undefined) {
      obj.email = message.email
    }
    if (message.phone !== undefined) {
      obj.phone = message.phone
    }
    return obj
  },

  create<I extends Exact<DeepPartial<OrganizationalContact>, I>>(base?: I): OrganizationalContact {
    return OrganizationalContact.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<OrganizationalContact>, I>>(object: I): OrganizationalContact {
    const message = createBaseOrganizationalContact()
    message.name = object.name ?? undefined
    message.email = object.email ?? undefined
    message.phone = object.phone ?? undefined
    return message
  },
}

function createBaseOrganizationalEntity(): OrganizationalEntity {
  return {name: undefined, url: [], contact: []}
}

export const OrganizationalEntity = {
  encode(message: OrganizationalEntity, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== undefined) {
      writer.uint32(10).string(message.name)
    }
    for (const v of message.url) {
      writer.uint32(18).string(v!)
    }
    for (const v of message.contact) {
      OrganizationalContact.encode(v!, writer.uint32(26).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): OrganizationalEntity {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseOrganizationalEntity()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.name = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url.push(reader.string())
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.contact.push(OrganizationalContact.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): OrganizationalEntity {
    return {
      name: isSet(object.name) ? String(object.name) : undefined,
      url: Array.isArray(object?.url) ? object.url.map((e: any) => String(e)) : [],
      contact: Array.isArray(object?.contact) ? object.contact.map((e: any) => OrganizationalContact.fromJSON(e)) : [],
    }
  },

  toJSON(message: OrganizationalEntity): unknown {
    const obj: any = {}
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.url?.length) {
      obj.url = message.url
    }
    if (message.contact?.length) {
      obj.contact = message.contact.map((e) => OrganizationalContact.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<OrganizationalEntity>, I>>(base?: I): OrganizationalEntity {
    return OrganizationalEntity.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<OrganizationalEntity>, I>>(object: I): OrganizationalEntity {
    const message = createBaseOrganizationalEntity()
    message.name = object.name ?? undefined
    message.url = object.url?.map((e) => e) || []
    message.contact = object.contact?.map((e) => OrganizationalContact.fromPartial(e)) || []
    return message
  },
}

function createBasePatch(): Patch {
  return {type: 0, diff: undefined, resolves: []}
}

export const Patch = {
  encode(message: Patch, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== 0) {
      writer.uint32(8).int32(message.type)
    }
    if (message.diff !== undefined) {
      Diff.encode(message.diff, writer.uint32(18).fork()).ldelim()
    }
    for (const v of message.resolves) {
      Issue.encode(v!, writer.uint32(26).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Patch {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBasePatch()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.type = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.diff = Diff.decode(reader, reader.uint32())
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.resolves.push(Issue.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Patch {
    return {
      type: isSet(object.type) ? patchClassificationFromJSON(object.type) : 0,
      diff: isSet(object.diff) ? Diff.fromJSON(object.diff) : undefined,
      resolves: Array.isArray(object?.resolves) ? object.resolves.map((e: any) => Issue.fromJSON(e)) : [],
    }
  },

  toJSON(message: Patch): unknown {
    const obj: any = {}
    if (message.type !== 0) {
      obj.type = patchClassificationToJSON(message.type)
    }
    if (message.diff !== undefined) {
      obj.diff = Diff.toJSON(message.diff)
    }
    if (message.resolves?.length) {
      obj.resolves = message.resolves.map((e) => Issue.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Patch>, I>>(base?: I): Patch {
    return Patch.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Patch>, I>>(object: I): Patch {
    const message = createBasePatch()
    message.type = object.type ?? 0
    message.diff = object.diff !== undefined && object.diff !== null ? Diff.fromPartial(object.diff) : undefined
    message.resolves = object.resolves?.map((e) => Issue.fromPartial(e)) || []
    return message
  },
}

function createBasePedigree(): Pedigree {
  return {ancestors: [], descendants: [], variants: [], commits: [], patches: [], notes: undefined}
}

export const Pedigree = {
  encode(message: Pedigree, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.ancestors) {
      Component.encode(v!, writer.uint32(10).fork()).ldelim()
    }
    for (const v of message.descendants) {
      Component.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    for (const v of message.variants) {
      Component.encode(v!, writer.uint32(26).fork()).ldelim()
    }
    for (const v of message.commits) {
      Commit.encode(v!, writer.uint32(34).fork()).ldelim()
    }
    for (const v of message.patches) {
      Patch.encode(v!, writer.uint32(42).fork()).ldelim()
    }
    if (message.notes !== undefined) {
      writer.uint32(50).string(message.notes)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Pedigree {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBasePedigree()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.ancestors.push(Component.decode(reader, reader.uint32()))
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.descendants.push(Component.decode(reader, reader.uint32()))
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.variants.push(Component.decode(reader, reader.uint32()))
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.commits.push(Commit.decode(reader, reader.uint32()))
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.patches.push(Patch.decode(reader, reader.uint32()))
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.notes = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Pedigree {
    return {
      ancestors: Array.isArray(object?.ancestors) ? object.ancestors.map((e: any) => Component.fromJSON(e)) : [],
      descendants: Array.isArray(object?.descendants) ? object.descendants.map((e: any) => Component.fromJSON(e)) : [],
      variants: Array.isArray(object?.variants) ? object.variants.map((e: any) => Component.fromJSON(e)) : [],
      commits: Array.isArray(object?.commits) ? object.commits.map((e: any) => Commit.fromJSON(e)) : [],
      patches: Array.isArray(object?.patches) ? object.patches.map((e: any) => Patch.fromJSON(e)) : [],
      notes: isSet(object.notes) ? String(object.notes) : undefined,
    }
  },

  toJSON(message: Pedigree): unknown {
    const obj: any = {}
    if (message.ancestors?.length) {
      obj.ancestors = message.ancestors.map((e) => Component.toJSON(e))
    }
    if (message.descendants?.length) {
      obj.descendants = message.descendants.map((e) => Component.toJSON(e))
    }
    if (message.variants?.length) {
      obj.variants = message.variants.map((e) => Component.toJSON(e))
    }
    if (message.commits?.length) {
      obj.commits = message.commits.map((e) => Commit.toJSON(e))
    }
    if (message.patches?.length) {
      obj.patches = message.patches.map((e) => Patch.toJSON(e))
    }
    if (message.notes !== undefined) {
      obj.notes = message.notes
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Pedigree>, I>>(base?: I): Pedigree {
    return Pedigree.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Pedigree>, I>>(object: I): Pedigree {
    const message = createBasePedigree()
    message.ancestors = object.ancestors?.map((e) => Component.fromPartial(e)) || []
    message.descendants = object.descendants?.map((e) => Component.fromPartial(e)) || []
    message.variants = object.variants?.map((e) => Component.fromPartial(e)) || []
    message.commits = object.commits?.map((e) => Commit.fromPartial(e)) || []
    message.patches = object.patches?.map((e) => Patch.fromPartial(e)) || []
    message.notes = object.notes ?? undefined
    return message
  },
}

function createBaseService(): Service {
  return {
    bomRef: undefined,
    provider: undefined,
    group: undefined,
    name: '',
    version: undefined,
    description: undefined,
    endpoints: [],
    authenticated: undefined,
    xTrustBoundary: undefined,
    data: [],
    licenses: [],
    externalReferences: [],
    services: [],
    properties: [],
    releaseNotes: undefined,
  }
}

export const Service = {
  encode(message: Service, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.bomRef !== undefined) {
      writer.uint32(10).string(message.bomRef)
    }
    if (message.provider !== undefined) {
      OrganizationalEntity.encode(message.provider, writer.uint32(18).fork()).ldelim()
    }
    if (message.group !== undefined) {
      writer.uint32(26).string(message.group)
    }
    if (message.name !== '') {
      writer.uint32(34).string(message.name)
    }
    if (message.version !== undefined) {
      writer.uint32(42).string(message.version)
    }
    if (message.description !== undefined) {
      writer.uint32(50).string(message.description)
    }
    for (const v of message.endpoints) {
      writer.uint32(58).string(v!)
    }
    if (message.authenticated !== undefined) {
      writer.uint32(64).bool(message.authenticated)
    }
    if (message.xTrustBoundary !== undefined) {
      writer.uint32(72).bool(message.xTrustBoundary)
    }
    for (const v of message.data) {
      DataClassification.encode(v!, writer.uint32(82).fork()).ldelim()
    }
    for (const v of message.licenses) {
      LicenseChoice.encode(v!, writer.uint32(90).fork()).ldelim()
    }
    for (const v of message.externalReferences) {
      ExternalReference.encode(v!, writer.uint32(98).fork()).ldelim()
    }
    for (const v of message.services) {
      Service.encode(v!, writer.uint32(106).fork()).ldelim()
    }
    for (const v of message.properties) {
      Property.encode(v!, writer.uint32(114).fork()).ldelim()
    }
    if (message.releaseNotes !== undefined) {
      ReleaseNotes.encode(message.releaseNotes, writer.uint32(122).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Service {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseService()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.bomRef = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.provider = OrganizationalEntity.decode(reader, reader.uint32())
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.group = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.name = reader.string()
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.version = reader.string()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.description = reader.string()
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.endpoints.push(reader.string())
          continue
        case 8:
          if (tag !== 64) {
            break
          }

          message.authenticated = reader.bool()
          continue
        case 9:
          if (tag !== 72) {
            break
          }

          message.xTrustBoundary = reader.bool()
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.data.push(DataClassification.decode(reader, reader.uint32()))
          continue
        case 11:
          if (tag !== 90) {
            break
          }

          message.licenses.push(LicenseChoice.decode(reader, reader.uint32()))
          continue
        case 12:
          if (tag !== 98) {
            break
          }

          message.externalReferences.push(ExternalReference.decode(reader, reader.uint32()))
          continue
        case 13:
          if (tag !== 106) {
            break
          }

          message.services.push(Service.decode(reader, reader.uint32()))
          continue
        case 14:
          if (tag !== 114) {
            break
          }

          message.properties.push(Property.decode(reader, reader.uint32()))
          continue
        case 15:
          if (tag !== 122) {
            break
          }

          message.releaseNotes = ReleaseNotes.decode(reader, reader.uint32())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Service {
    return {
      bomRef: isSet(object.bomRef) ? String(object.bomRef) : undefined,
      provider: isSet(object.provider) ? OrganizationalEntity.fromJSON(object.provider) : undefined,
      group: isSet(object.group) ? String(object.group) : undefined,
      name: isSet(object.name) ? String(object.name) : '',
      version: isSet(object.version) ? String(object.version) : undefined,
      description: isSet(object.description) ? String(object.description) : undefined,
      endpoints: Array.isArray(object?.endpoints) ? object.endpoints.map((e: any) => String(e)) : [],
      authenticated: isSet(object.authenticated) ? Boolean(object.authenticated) : undefined,
      xTrustBoundary: isSet(object.xTrustBoundary) ? Boolean(object.xTrustBoundary) : undefined,
      data: Array.isArray(object?.data) ? object.data.map((e: any) => DataClassification.fromJSON(e)) : [],
      licenses: Array.isArray(object?.licenses) ? object.licenses.map((e: any) => LicenseChoice.fromJSON(e)) : [],
      externalReferences: Array.isArray(object?.externalReferences)
        ? object.externalReferences.map((e: any) => ExternalReference.fromJSON(e))
        : [],
      services: Array.isArray(object?.services) ? object.services.map((e: any) => Service.fromJSON(e)) : [],
      properties: Array.isArray(object?.properties) ? object.properties.map((e: any) => Property.fromJSON(e)) : [],
      releaseNotes: isSet(object.releaseNotes) ? ReleaseNotes.fromJSON(object.releaseNotes) : undefined,
    }
  },

  toJSON(message: Service): unknown {
    const obj: any = {}
    if (message.bomRef !== undefined) {
      obj.bomRef = message.bomRef
    }
    if (message.provider !== undefined) {
      obj.provider = OrganizationalEntity.toJSON(message.provider)
    }
    if (message.group !== undefined) {
      obj.group = message.group
    }
    if (message.name !== '') {
      obj.name = message.name
    }
    if (message.version !== undefined) {
      obj.version = message.version
    }
    if (message.description !== undefined) {
      obj.description = message.description
    }
    if (message.endpoints?.length) {
      obj.endpoints = message.endpoints
    }
    if (message.authenticated !== undefined) {
      obj.authenticated = message.authenticated
    }
    if (message.xTrustBoundary !== undefined) {
      obj.xTrustBoundary = message.xTrustBoundary
    }
    if (message.data?.length) {
      obj.data = message.data.map((e) => DataClassification.toJSON(e))
    }
    if (message.licenses?.length) {
      obj.licenses = message.licenses.map((e) => LicenseChoice.toJSON(e))
    }
    if (message.externalReferences?.length) {
      obj.externalReferences = message.externalReferences.map((e) => ExternalReference.toJSON(e))
    }
    if (message.services?.length) {
      obj.services = message.services.map((e) => Service.toJSON(e))
    }
    if (message.properties?.length) {
      obj.properties = message.properties.map((e) => Property.toJSON(e))
    }
    if (message.releaseNotes !== undefined) {
      obj.releaseNotes = ReleaseNotes.toJSON(message.releaseNotes)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Service>, I>>(base?: I): Service {
    return Service.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Service>, I>>(object: I): Service {
    const message = createBaseService()
    message.bomRef = object.bomRef ?? undefined
    message.provider =
      object.provider !== undefined && object.provider !== null
        ? OrganizationalEntity.fromPartial(object.provider)
        : undefined
    message.group = object.group ?? undefined
    message.name = object.name ?? ''
    message.version = object.version ?? undefined
    message.description = object.description ?? undefined
    message.endpoints = object.endpoints?.map((e) => e) || []
    message.authenticated = object.authenticated ?? undefined
    message.xTrustBoundary = object.xTrustBoundary ?? undefined
    message.data = object.data?.map((e) => DataClassification.fromPartial(e)) || []
    message.licenses = object.licenses?.map((e) => LicenseChoice.fromPartial(e)) || []
    message.externalReferences = object.externalReferences?.map((e) => ExternalReference.fromPartial(e)) || []
    message.services = object.services?.map((e) => Service.fromPartial(e)) || []
    message.properties = object.properties?.map((e) => Property.fromPartial(e)) || []
    message.releaseNotes =
      object.releaseNotes !== undefined && object.releaseNotes !== null
        ? ReleaseNotes.fromPartial(object.releaseNotes)
        : undefined
    return message
  },
}

function createBaseSwid(): Swid {
  return {
    tagId: '',
    name: '',
    version: undefined,
    tagVersion: undefined,
    patch: undefined,
    text: undefined,
    url: undefined,
  }
}

export const Swid = {
  encode(message: Swid, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.tagId !== '') {
      writer.uint32(10).string(message.tagId)
    }
    if (message.name !== '') {
      writer.uint32(18).string(message.name)
    }
    if (message.version !== undefined) {
      writer.uint32(26).string(message.version)
    }
    if (message.tagVersion !== undefined) {
      writer.uint32(32).int32(message.tagVersion)
    }
    if (message.patch !== undefined) {
      writer.uint32(40).bool(message.patch)
    }
    if (message.text !== undefined) {
      AttachedText.encode(message.text, writer.uint32(50).fork()).ldelim()
    }
    if (message.url !== undefined) {
      writer.uint32(58).string(message.url)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Swid {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseSwid()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.tagId = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.name = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.version = reader.string()
          continue
        case 4:
          if (tag !== 32) {
            break
          }

          message.tagVersion = reader.int32()
          continue
        case 5:
          if (tag !== 40) {
            break
          }

          message.patch = reader.bool()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.text = AttachedText.decode(reader, reader.uint32())
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.url = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Swid {
    return {
      tagId: isSet(object.tagId) ? String(object.tagId) : '',
      name: isSet(object.name) ? String(object.name) : '',
      version: isSet(object.version) ? String(object.version) : undefined,
      tagVersion: isSet(object.tagVersion) ? Number(object.tagVersion) : undefined,
      patch: isSet(object.patch) ? Boolean(object.patch) : undefined,
      text: isSet(object.text) ? AttachedText.fromJSON(object.text) : undefined,
      url: isSet(object.url) ? String(object.url) : undefined,
    }
  },

  toJSON(message: Swid): unknown {
    const obj: any = {}
    if (message.tagId !== '') {
      obj.tagId = message.tagId
    }
    if (message.name !== '') {
      obj.name = message.name
    }
    if (message.version !== undefined) {
      obj.version = message.version
    }
    if (message.tagVersion !== undefined) {
      obj.tagVersion = Math.round(message.tagVersion)
    }
    if (message.patch !== undefined) {
      obj.patch = message.patch
    }
    if (message.text !== undefined) {
      obj.text = AttachedText.toJSON(message.text)
    }
    if (message.url !== undefined) {
      obj.url = message.url
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Swid>, I>>(base?: I): Swid {
    return Swid.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Swid>, I>>(object: I): Swid {
    const message = createBaseSwid()
    message.tagId = object.tagId ?? ''
    message.name = object.name ?? ''
    message.version = object.version ?? undefined
    message.tagVersion = object.tagVersion ?? undefined
    message.patch = object.patch ?? undefined
    message.text = object.text !== undefined && object.text !== null ? AttachedText.fromPartial(object.text) : undefined
    message.url = object.url ?? undefined
    return message
  },
}

function createBaseTool(): Tool {
  return {vendor: undefined, name: undefined, version: undefined, hashes: [], externalReferences: []}
}

export const Tool = {
  encode(message: Tool, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.vendor !== undefined) {
      writer.uint32(10).string(message.vendor)
    }
    if (message.name !== undefined) {
      writer.uint32(18).string(message.name)
    }
    if (message.version !== undefined) {
      writer.uint32(26).string(message.version)
    }
    for (const v of message.hashes) {
      Hash.encode(v!, writer.uint32(34).fork()).ldelim()
    }
    for (const v of message.externalReferences) {
      ExternalReference.encode(v!, writer.uint32(42).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Tool {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseTool()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.vendor = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.name = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.version = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.hashes.push(Hash.decode(reader, reader.uint32()))
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.externalReferences.push(ExternalReference.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Tool {
    return {
      vendor: isSet(object.vendor) ? String(object.vendor) : undefined,
      name: isSet(object.name) ? String(object.name) : undefined,
      version: isSet(object.version) ? String(object.version) : undefined,
      hashes: Array.isArray(object?.hashes) ? object.hashes.map((e: any) => Hash.fromJSON(e)) : [],
      externalReferences: Array.isArray(object?.externalReferences)
        ? object.externalReferences.map((e: any) => ExternalReference.fromJSON(e))
        : [],
    }
  },

  toJSON(message: Tool): unknown {
    const obj: any = {}
    if (message.vendor !== undefined) {
      obj.vendor = message.vendor
    }
    if (message.name !== undefined) {
      obj.name = message.name
    }
    if (message.version !== undefined) {
      obj.version = message.version
    }
    if (message.hashes?.length) {
      obj.hashes = message.hashes.map((e) => Hash.toJSON(e))
    }
    if (message.externalReferences?.length) {
      obj.externalReferences = message.externalReferences.map((e) => ExternalReference.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Tool>, I>>(base?: I): Tool {
    return Tool.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Tool>, I>>(object: I): Tool {
    const message = createBaseTool()
    message.vendor = object.vendor ?? undefined
    message.name = object.name ?? undefined
    message.version = object.version ?? undefined
    message.hashes = object.hashes?.map((e) => Hash.fromPartial(e)) || []
    message.externalReferences = object.externalReferences?.map((e) => ExternalReference.fromPartial(e)) || []
    return message
  },
}

function createBaseProperty(): Property {
  return {name: '', value: undefined}
}

export const Property = {
  encode(message: Property, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.name !== '') {
      writer.uint32(10).string(message.name)
    }
    if (message.value !== undefined) {
      writer.uint32(18).string(message.value)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Property {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseProperty()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.name = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.value = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Property {
    return {
      name: isSet(object.name) ? String(object.name) : '',
      value: isSet(object.value) ? String(object.value) : undefined,
    }
  },

  toJSON(message: Property): unknown {
    const obj: any = {}
    if (message.name !== '') {
      obj.name = message.name
    }
    if (message.value !== undefined) {
      obj.value = message.value
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Property>, I>>(base?: I): Property {
    return Property.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Property>, I>>(object: I): Property {
    const message = createBaseProperty()
    message.name = object.name ?? ''
    message.value = object.value ?? undefined
    return message
  },
}

function createBaseComposition(): Composition {
  return {aggregate: 0, assemblies: [], dependencies: []}
}

export const Composition = {
  encode(message: Composition, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.aggregate !== 0) {
      writer.uint32(8).int32(message.aggregate)
    }
    for (const v of message.assemblies) {
      writer.uint32(18).string(v!)
    }
    for (const v of message.dependencies) {
      writer.uint32(26).string(v!)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Composition {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseComposition()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.aggregate = reader.int32() as any
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.assemblies.push(reader.string())
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.dependencies.push(reader.string())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Composition {
    return {
      aggregate: isSet(object.aggregate) ? aggregateFromJSON(object.aggregate) : 0,
      assemblies: Array.isArray(object?.assemblies) ? object.assemblies.map((e: any) => String(e)) : [],
      dependencies: Array.isArray(object?.dependencies) ? object.dependencies.map((e: any) => String(e)) : [],
    }
  },

  toJSON(message: Composition): unknown {
    const obj: any = {}
    if (message.aggregate !== 0) {
      obj.aggregate = aggregateToJSON(message.aggregate)
    }
    if (message.assemblies?.length) {
      obj.assemblies = message.assemblies
    }
    if (message.dependencies?.length) {
      obj.dependencies = message.dependencies
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Composition>, I>>(base?: I): Composition {
    return Composition.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Composition>, I>>(object: I): Composition {
    const message = createBaseComposition()
    message.aggregate = object.aggregate ?? 0
    message.assemblies = object.assemblies?.map((e) => e) || []
    message.dependencies = object.dependencies?.map((e) => e) || []
    return message
  },
}

function createBaseEvidenceCopyright(): EvidenceCopyright {
  return {text: ''}
}

export const EvidenceCopyright = {
  encode(message: EvidenceCopyright, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.text !== '') {
      writer.uint32(10).string(message.text)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): EvidenceCopyright {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseEvidenceCopyright()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.text = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): EvidenceCopyright {
    return {text: isSet(object.text) ? String(object.text) : ''}
  },

  toJSON(message: EvidenceCopyright): unknown {
    const obj: any = {}
    if (message.text !== '') {
      obj.text = message.text
    }
    return obj
  },

  create<I extends Exact<DeepPartial<EvidenceCopyright>, I>>(base?: I): EvidenceCopyright {
    return EvidenceCopyright.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<EvidenceCopyright>, I>>(object: I): EvidenceCopyright {
    const message = createBaseEvidenceCopyright()
    message.text = object.text ?? ''
    return message
  },
}

function createBaseEvidence(): Evidence {
  return {licenses: [], copyright: []}
}

export const Evidence = {
  encode(message: Evidence, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.licenses) {
      LicenseChoice.encode(v!, writer.uint32(10).fork()).ldelim()
    }
    for (const v of message.copyright) {
      EvidenceCopyright.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Evidence {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseEvidence()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.licenses.push(LicenseChoice.decode(reader, reader.uint32()))
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.copyright.push(EvidenceCopyright.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Evidence {
    return {
      licenses: Array.isArray(object?.licenses) ? object.licenses.map((e: any) => LicenseChoice.fromJSON(e)) : [],
      copyright: Array.isArray(object?.copyright)
        ? object.copyright.map((e: any) => EvidenceCopyright.fromJSON(e))
        : [],
    }
  },

  toJSON(message: Evidence): unknown {
    const obj: any = {}
    if (message.licenses?.length) {
      obj.licenses = message.licenses.map((e) => LicenseChoice.toJSON(e))
    }
    if (message.copyright?.length) {
      obj.copyright = message.copyright.map((e) => EvidenceCopyright.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Evidence>, I>>(base?: I): Evidence {
    return Evidence.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Evidence>, I>>(object: I): Evidence {
    const message = createBaseEvidence()
    message.licenses = object.licenses?.map((e) => LicenseChoice.fromPartial(e)) || []
    message.copyright = object.copyright?.map((e) => EvidenceCopyright.fromPartial(e)) || []
    return message
  },
}

function createBaseNote(): Note {
  return {locale: undefined, text: undefined}
}

export const Note = {
  encode(message: Note, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.locale !== undefined) {
      writer.uint32(10).string(message.locale)
    }
    if (message.text !== undefined) {
      AttachedText.encode(message.text, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Note {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseNote()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.locale = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.text = AttachedText.decode(reader, reader.uint32())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Note {
    return {
      locale: isSet(object.locale) ? String(object.locale) : undefined,
      text: isSet(object.text) ? AttachedText.fromJSON(object.text) : undefined,
    }
  },

  toJSON(message: Note): unknown {
    const obj: any = {}
    if (message.locale !== undefined) {
      obj.locale = message.locale
    }
    if (message.text !== undefined) {
      obj.text = AttachedText.toJSON(message.text)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Note>, I>>(base?: I): Note {
    return Note.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Note>, I>>(object: I): Note {
    const message = createBaseNote()
    message.locale = object.locale ?? undefined
    message.text = object.text !== undefined && object.text !== null ? AttachedText.fromPartial(object.text) : undefined
    return message
  },
}

function createBaseReleaseNotes(): ReleaseNotes {
  return {
    type: '',
    title: undefined,
    featuredImage: undefined,
    socialImage: undefined,
    description: undefined,
    timestamp: undefined,
    aliases: [],
    tags: [],
    resolves: [],
    notes: [],
    properties: [],
  }
}

export const ReleaseNotes = {
  encode(message: ReleaseNotes, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.type !== '') {
      writer.uint32(10).string(message.type)
    }
    if (message.title !== undefined) {
      writer.uint32(18).string(message.title)
    }
    if (message.featuredImage !== undefined) {
      writer.uint32(26).string(message.featuredImage)
    }
    if (message.socialImage !== undefined) {
      writer.uint32(34).string(message.socialImage)
    }
    if (message.description !== undefined) {
      writer.uint32(42).string(message.description)
    }
    if (message.timestamp !== undefined) {
      Timestamp.encode(toTimestamp(message.timestamp), writer.uint32(50).fork()).ldelim()
    }
    for (const v of message.aliases) {
      writer.uint32(58).string(v!)
    }
    for (const v of message.tags) {
      writer.uint32(66).string(v!)
    }
    for (const v of message.resolves) {
      Issue.encode(v!, writer.uint32(74).fork()).ldelim()
    }
    for (const v of message.notes) {
      Note.encode(v!, writer.uint32(82).fork()).ldelim()
    }
    for (const v of message.properties) {
      Property.encode(v!, writer.uint32(90).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): ReleaseNotes {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseReleaseNotes()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.type = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.title = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.featuredImage = reader.string()
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.socialImage = reader.string()
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.description = reader.string()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.timestamp = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 7:
          if (tag !== 58) {
            break
          }

          message.aliases.push(reader.string())
          continue
        case 8:
          if (tag !== 66) {
            break
          }

          message.tags.push(reader.string())
          continue
        case 9:
          if (tag !== 74) {
            break
          }

          message.resolves.push(Issue.decode(reader, reader.uint32()))
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.notes.push(Note.decode(reader, reader.uint32()))
          continue
        case 11:
          if (tag !== 90) {
            break
          }

          message.properties.push(Property.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): ReleaseNotes {
    return {
      type: isSet(object.type) ? String(object.type) : '',
      title: isSet(object.title) ? String(object.title) : undefined,
      featuredImage: isSet(object.featuredImage) ? String(object.featuredImage) : undefined,
      socialImage: isSet(object.socialImage) ? String(object.socialImage) : undefined,
      description: isSet(object.description) ? String(object.description) : undefined,
      timestamp: isSet(object.timestamp) ? fromJsonTimestamp(object.timestamp) : undefined,
      aliases: Array.isArray(object?.aliases) ? object.aliases.map((e: any) => String(e)) : [],
      tags: Array.isArray(object?.tags) ? object.tags.map((e: any) => String(e)) : [],
      resolves: Array.isArray(object?.resolves) ? object.resolves.map((e: any) => Issue.fromJSON(e)) : [],
      notes: Array.isArray(object?.notes) ? object.notes.map((e: any) => Note.fromJSON(e)) : [],
      properties: Array.isArray(object?.properties) ? object.properties.map((e: any) => Property.fromJSON(e)) : [],
    }
  },

  toJSON(message: ReleaseNotes): unknown {
    const obj: any = {}
    if (message.type !== '') {
      obj.type = message.type
    }
    if (message.title !== undefined) {
      obj.title = message.title
    }
    if (message.featuredImage !== undefined) {
      obj.featuredImage = message.featuredImage
    }
    if (message.socialImage !== undefined) {
      obj.socialImage = message.socialImage
    }
    if (message.description !== undefined) {
      obj.description = message.description
    }
    if (message.timestamp !== undefined) {
      obj.timestamp = message.timestamp.toISOString()
    }
    if (message.aliases?.length) {
      obj.aliases = message.aliases
    }
    if (message.tags?.length) {
      obj.tags = message.tags
    }
    if (message.resolves?.length) {
      obj.resolves = message.resolves.map((e) => Issue.toJSON(e))
    }
    if (message.notes?.length) {
      obj.notes = message.notes.map((e) => Note.toJSON(e))
    }
    if (message.properties?.length) {
      obj.properties = message.properties.map((e) => Property.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<ReleaseNotes>, I>>(base?: I): ReleaseNotes {
    return ReleaseNotes.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<ReleaseNotes>, I>>(object: I): ReleaseNotes {
    const message = createBaseReleaseNotes()
    message.type = object.type ?? ''
    message.title = object.title ?? undefined
    message.featuredImage = object.featuredImage ?? undefined
    message.socialImage = object.socialImage ?? undefined
    message.description = object.description ?? undefined
    message.timestamp = object.timestamp ?? undefined
    message.aliases = object.aliases?.map((e) => e) || []
    message.tags = object.tags?.map((e) => e) || []
    message.resolves = object.resolves?.map((e) => Issue.fromPartial(e)) || []
    message.notes = object.notes?.map((e) => Note.fromPartial(e)) || []
    message.properties = object.properties?.map((e) => Property.fromPartial(e)) || []
    return message
  },
}

function createBaseVulnerability(): Vulnerability {
  return {
    bomRef: undefined,
    id: undefined,
    source: undefined,
    references: [],
    ratings: [],
    cwes: [],
    description: undefined,
    detail: undefined,
    recommendation: undefined,
    advisories: [],
    created: undefined,
    published: undefined,
    updated: undefined,
    credits: undefined,
    tools: [],
    analysis: undefined,
    affects: [],
    properties: [],
  }
}

export const Vulnerability = {
  encode(message: Vulnerability, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.bomRef !== undefined) {
      writer.uint32(10).string(message.bomRef)
    }
    if (message.id !== undefined) {
      writer.uint32(18).string(message.id)
    }
    if (message.source !== undefined) {
      Source.encode(message.source, writer.uint32(26).fork()).ldelim()
    }
    for (const v of message.references) {
      VulnerabilityReference.encode(v!, writer.uint32(34).fork()).ldelim()
    }
    for (const v of message.ratings) {
      VulnerabilityRating.encode(v!, writer.uint32(42).fork()).ldelim()
    }
    writer.uint32(50).fork()
    for (const v of message.cwes) {
      writer.int32(v)
    }
    writer.ldelim()
    if (message.description !== undefined) {
      writer.uint32(58).string(message.description)
    }
    if (message.detail !== undefined) {
      writer.uint32(66).string(message.detail)
    }
    if (message.recommendation !== undefined) {
      writer.uint32(74).string(message.recommendation)
    }
    for (const v of message.advisories) {
      Advisory.encode(v!, writer.uint32(82).fork()).ldelim()
    }
    if (message.created !== undefined) {
      Timestamp.encode(toTimestamp(message.created), writer.uint32(90).fork()).ldelim()
    }
    if (message.published !== undefined) {
      Timestamp.encode(toTimestamp(message.published), writer.uint32(98).fork()).ldelim()
    }
    if (message.updated !== undefined) {
      Timestamp.encode(toTimestamp(message.updated), writer.uint32(106).fork()).ldelim()
    }
    if (message.credits !== undefined) {
      VulnerabilityCredits.encode(message.credits, writer.uint32(114).fork()).ldelim()
    }
    for (const v of message.tools) {
      Tool.encode(v!, writer.uint32(122).fork()).ldelim()
    }
    if (message.analysis !== undefined) {
      VulnerabilityAnalysis.encode(message.analysis, writer.uint32(130).fork()).ldelim()
    }
    for (const v of message.affects) {
      VulnerabilityAffects.encode(v!, writer.uint32(138).fork()).ldelim()
    }
    for (const v of message.properties) {
      Property.encode(v!, writer.uint32(146).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Vulnerability {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerability()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.bomRef = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.id = reader.string()
          continue
        case 3:
          if (tag !== 26) {
            break
          }

          message.source = Source.decode(reader, reader.uint32())
          continue
        case 4:
          if (tag !== 34) {
            break
          }

          message.references.push(VulnerabilityReference.decode(reader, reader.uint32()))
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.ratings.push(VulnerabilityRating.decode(reader, reader.uint32()))
          continue
        case 6:
          if (tag === 48) {
            message.cwes.push(reader.int32())

            continue
          }

          if (tag === 50) {
            const end2 = reader.uint32() + reader.pos
            while (reader.pos < end2) {
              message.cwes.push(reader.int32())
            }

            continue
          }

          break
        case 7:
          if (tag !== 58) {
            break
          }

          message.description = reader.string()
          continue
        case 8:
          if (tag !== 66) {
            break
          }

          message.detail = reader.string()
          continue
        case 9:
          if (tag !== 74) {
            break
          }

          message.recommendation = reader.string()
          continue
        case 10:
          if (tag !== 82) {
            break
          }

          message.advisories.push(Advisory.decode(reader, reader.uint32()))
          continue
        case 11:
          if (tag !== 90) {
            break
          }

          message.created = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 12:
          if (tag !== 98) {
            break
          }

          message.published = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 13:
          if (tag !== 106) {
            break
          }

          message.updated = fromTimestamp(Timestamp.decode(reader, reader.uint32()))
          continue
        case 14:
          if (tag !== 114) {
            break
          }

          message.credits = VulnerabilityCredits.decode(reader, reader.uint32())
          continue
        case 15:
          if (tag !== 122) {
            break
          }

          message.tools.push(Tool.decode(reader, reader.uint32()))
          continue
        case 16:
          if (tag !== 130) {
            break
          }

          message.analysis = VulnerabilityAnalysis.decode(reader, reader.uint32())
          continue
        case 17:
          if (tag !== 138) {
            break
          }

          message.affects.push(VulnerabilityAffects.decode(reader, reader.uint32()))
          continue
        case 18:
          if (tag !== 146) {
            break
          }

          message.properties.push(Property.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Vulnerability {
    return {
      bomRef: isSet(object.bomRef) ? String(object.bomRef) : undefined,
      id: isSet(object.id) ? String(object.id) : undefined,
      source: isSet(object.source) ? Source.fromJSON(object.source) : undefined,
      references: Array.isArray(object?.references)
        ? object.references.map((e: any) => VulnerabilityReference.fromJSON(e))
        : [],
      ratings: Array.isArray(object?.ratings) ? object.ratings.map((e: any) => VulnerabilityRating.fromJSON(e)) : [],
      cwes: Array.isArray(object?.cwes) ? object.cwes.map((e: any) => Number(e)) : [],
      description: isSet(object.description) ? String(object.description) : undefined,
      detail: isSet(object.detail) ? String(object.detail) : undefined,
      recommendation: isSet(object.recommendation) ? String(object.recommendation) : undefined,
      advisories: Array.isArray(object?.advisories) ? object.advisories.map((e: any) => Advisory.fromJSON(e)) : [],
      created: isSet(object.created) ? fromJsonTimestamp(object.created) : undefined,
      published: isSet(object.published) ? fromJsonTimestamp(object.published) : undefined,
      updated: isSet(object.updated) ? fromJsonTimestamp(object.updated) : undefined,
      credits: isSet(object.credits) ? VulnerabilityCredits.fromJSON(object.credits) : undefined,
      tools: Array.isArray(object?.tools) ? object.tools.map((e: any) => Tool.fromJSON(e)) : [],
      analysis: isSet(object.analysis) ? VulnerabilityAnalysis.fromJSON(object.analysis) : undefined,
      affects: Array.isArray(object?.affects) ? object.affects.map((e: any) => VulnerabilityAffects.fromJSON(e)) : [],
      properties: Array.isArray(object?.properties) ? object.properties.map((e: any) => Property.fromJSON(e)) : [],
    }
  },

  toJSON(message: Vulnerability): unknown {
    const obj: any = {}
    if (message.bomRef !== undefined) {
      obj.bomRef = message.bomRef
    }
    if (message.id !== undefined) {
      obj.id = message.id
    }
    if (message.source !== undefined) {
      obj.source = Source.toJSON(message.source)
    }
    if (message.references?.length) {
      obj.references = message.references.map((e) => VulnerabilityReference.toJSON(e))
    }
    if (message.ratings?.length) {
      obj.ratings = message.ratings.map((e) => VulnerabilityRating.toJSON(e))
    }
    if (message.cwes?.length) {
      obj.cwes = message.cwes.map((e) => Math.round(e))
    }
    if (message.description !== undefined) {
      obj.description = message.description
    }
    if (message.detail !== undefined) {
      obj.detail = message.detail
    }
    if (message.recommendation !== undefined) {
      obj.recommendation = message.recommendation
    }
    if (message.advisories?.length) {
      obj.advisories = message.advisories.map((e) => Advisory.toJSON(e))
    }
    if (message.created !== undefined) {
      obj.created = message.created.toISOString()
    }
    if (message.published !== undefined) {
      obj.published = message.published.toISOString()
    }
    if (message.updated !== undefined) {
      obj.updated = message.updated.toISOString()
    }
    if (message.credits !== undefined) {
      obj.credits = VulnerabilityCredits.toJSON(message.credits)
    }
    if (message.tools?.length) {
      obj.tools = message.tools.map((e) => Tool.toJSON(e))
    }
    if (message.analysis !== undefined) {
      obj.analysis = VulnerabilityAnalysis.toJSON(message.analysis)
    }
    if (message.affects?.length) {
      obj.affects = message.affects.map((e) => VulnerabilityAffects.toJSON(e))
    }
    if (message.properties?.length) {
      obj.properties = message.properties.map((e) => Property.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Vulnerability>, I>>(base?: I): Vulnerability {
    return Vulnerability.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Vulnerability>, I>>(object: I): Vulnerability {
    const message = createBaseVulnerability()
    message.bomRef = object.bomRef ?? undefined
    message.id = object.id ?? undefined
    message.source =
      object.source !== undefined && object.source !== null ? Source.fromPartial(object.source) : undefined
    message.references = object.references?.map((e) => VulnerabilityReference.fromPartial(e)) || []
    message.ratings = object.ratings?.map((e) => VulnerabilityRating.fromPartial(e)) || []
    message.cwes = object.cwes?.map((e) => e) || []
    message.description = object.description ?? undefined
    message.detail = object.detail ?? undefined
    message.recommendation = object.recommendation ?? undefined
    message.advisories = object.advisories?.map((e) => Advisory.fromPartial(e)) || []
    message.created = object.created ?? undefined
    message.published = object.published ?? undefined
    message.updated = object.updated ?? undefined
    message.credits =
      object.credits !== undefined && object.credits !== null
        ? VulnerabilityCredits.fromPartial(object.credits)
        : undefined
    message.tools = object.tools?.map((e) => Tool.fromPartial(e)) || []
    message.analysis =
      object.analysis !== undefined && object.analysis !== null
        ? VulnerabilityAnalysis.fromPartial(object.analysis)
        : undefined
    message.affects = object.affects?.map((e) => VulnerabilityAffects.fromPartial(e)) || []
    message.properties = object.properties?.map((e) => Property.fromPartial(e)) || []
    return message
  },
}

function createBaseVulnerabilityReference(): VulnerabilityReference {
  return {id: undefined, source: undefined}
}

export const VulnerabilityReference = {
  encode(message: VulnerabilityReference, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.id !== undefined) {
      writer.uint32(10).string(message.id)
    }
    if (message.source !== undefined) {
      Source.encode(message.source, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityReference {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityReference()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.id = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.source = Source.decode(reader, reader.uint32())
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityReference {
    return {
      id: isSet(object.id) ? String(object.id) : undefined,
      source: isSet(object.source) ? Source.fromJSON(object.source) : undefined,
    }
  },

  toJSON(message: VulnerabilityReference): unknown {
    const obj: any = {}
    if (message.id !== undefined) {
      obj.id = message.id
    }
    if (message.source !== undefined) {
      obj.source = Source.toJSON(message.source)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityReference>, I>>(base?: I): VulnerabilityReference {
    return VulnerabilityReference.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityReference>, I>>(object: I): VulnerabilityReference {
    const message = createBaseVulnerabilityReference()
    message.id = object.id ?? undefined
    message.source =
      object.source !== undefined && object.source !== null ? Source.fromPartial(object.source) : undefined
    return message
  },
}

function createBaseVulnerabilityRating(): VulnerabilityRating {
  return {
    source: undefined,
    score: undefined,
    severity: undefined,
    method: undefined,
    vector: undefined,
    justification: undefined,
  }
}

export const VulnerabilityRating = {
  encode(message: VulnerabilityRating, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.source !== undefined) {
      Source.encode(message.source, writer.uint32(10).fork()).ldelim()
    }
    if (message.score !== undefined) {
      writer.uint32(17).double(message.score)
    }
    if (message.severity !== undefined) {
      writer.uint32(24).int32(message.severity)
    }
    if (message.method !== undefined) {
      writer.uint32(32).int32(message.method)
    }
    if (message.vector !== undefined) {
      writer.uint32(42).string(message.vector)
    }
    if (message.justification !== undefined) {
      writer.uint32(50).string(message.justification)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityRating {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityRating()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.source = Source.decode(reader, reader.uint32())
          continue
        case 2:
          if (tag !== 17) {
            break
          }

          message.score = reader.double()
          continue
        case 3:
          if (tag !== 24) {
            break
          }

          message.severity = reader.int32() as any
          continue
        case 4:
          if (tag !== 32) {
            break
          }

          message.method = reader.int32() as any
          continue
        case 5:
          if (tag !== 42) {
            break
          }

          message.vector = reader.string()
          continue
        case 6:
          if (tag !== 50) {
            break
          }

          message.justification = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityRating {
    return {
      source: isSet(object.source) ? Source.fromJSON(object.source) : undefined,
      score: isSet(object.score) ? Number(object.score) : undefined,
      severity: isSet(object.severity) ? severityFromJSON(object.severity) : undefined,
      method: isSet(object.method) ? scoreMethodFromJSON(object.method) : undefined,
      vector: isSet(object.vector) ? String(object.vector) : undefined,
      justification: isSet(object.justification) ? String(object.justification) : undefined,
    }
  },

  toJSON(message: VulnerabilityRating): unknown {
    const obj: any = {}
    if (message.source !== undefined) {
      obj.source = Source.toJSON(message.source)
    }
    if (message.score !== undefined) {
      obj.score = message.score
    }
    if (message.severity !== undefined) {
      obj.severity = severityToJSON(message.severity)
    }
    if (message.method !== undefined) {
      obj.method = scoreMethodToJSON(message.method)
    }
    if (message.vector !== undefined) {
      obj.vector = message.vector
    }
    if (message.justification !== undefined) {
      obj.justification = message.justification
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityRating>, I>>(base?: I): VulnerabilityRating {
    return VulnerabilityRating.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityRating>, I>>(object: I): VulnerabilityRating {
    const message = createBaseVulnerabilityRating()
    message.source =
      object.source !== undefined && object.source !== null ? Source.fromPartial(object.source) : undefined
    message.score = object.score ?? undefined
    message.severity = object.severity ?? undefined
    message.method = object.method ?? undefined
    message.vector = object.vector ?? undefined
    message.justification = object.justification ?? undefined
    return message
  },
}

function createBaseAdvisory(): Advisory {
  return {title: undefined, url: ''}
}

export const Advisory = {
  encode(message: Advisory, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.title !== undefined) {
      writer.uint32(10).string(message.title)
    }
    if (message.url !== '') {
      writer.uint32(18).string(message.url)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): Advisory {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseAdvisory()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.title = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.url = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): Advisory {
    return {
      title: isSet(object.title) ? String(object.title) : undefined,
      url: isSet(object.url) ? String(object.url) : '',
    }
  },

  toJSON(message: Advisory): unknown {
    const obj: any = {}
    if (message.title !== undefined) {
      obj.title = message.title
    }
    if (message.url !== '') {
      obj.url = message.url
    }
    return obj
  },

  create<I extends Exact<DeepPartial<Advisory>, I>>(base?: I): Advisory {
    return Advisory.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<Advisory>, I>>(object: I): Advisory {
    const message = createBaseAdvisory()
    message.title = object.title ?? undefined
    message.url = object.url ?? ''
    return message
  },
}

function createBaseVulnerabilityCredits(): VulnerabilityCredits {
  return {organizations: [], individuals: []}
}

export const VulnerabilityCredits = {
  encode(message: VulnerabilityCredits, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    for (const v of message.organizations) {
      OrganizationalEntity.encode(v!, writer.uint32(10).fork()).ldelim()
    }
    for (const v of message.individuals) {
      OrganizationalContact.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityCredits {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityCredits()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.organizations.push(OrganizationalEntity.decode(reader, reader.uint32()))
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.individuals.push(OrganizationalContact.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityCredits {
    return {
      organizations: Array.isArray(object?.organizations)
        ? object.organizations.map((e: any) => OrganizationalEntity.fromJSON(e))
        : [],
      individuals: Array.isArray(object?.individuals)
        ? object.individuals.map((e: any) => OrganizationalContact.fromJSON(e))
        : [],
    }
  },

  toJSON(message: VulnerabilityCredits): unknown {
    const obj: any = {}
    if (message.organizations?.length) {
      obj.organizations = message.organizations.map((e) => OrganizationalEntity.toJSON(e))
    }
    if (message.individuals?.length) {
      obj.individuals = message.individuals.map((e) => OrganizationalContact.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityCredits>, I>>(base?: I): VulnerabilityCredits {
    return VulnerabilityCredits.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityCredits>, I>>(object: I): VulnerabilityCredits {
    const message = createBaseVulnerabilityCredits()
    message.organizations = object.organizations?.map((e) => OrganizationalEntity.fromPartial(e)) || []
    message.individuals = object.individuals?.map((e) => OrganizationalContact.fromPartial(e)) || []
    return message
  },
}

function createBaseVulnerabilityAnalysis(): VulnerabilityAnalysis {
  return {state: undefined, justification: undefined, response: [], detail: undefined}
}

export const VulnerabilityAnalysis = {
  encode(message: VulnerabilityAnalysis, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.state !== undefined) {
      writer.uint32(8).int32(message.state)
    }
    if (message.justification !== undefined) {
      writer.uint32(16).int32(message.justification)
    }
    writer.uint32(26).fork()
    for (const v of message.response) {
      writer.int32(v)
    }
    writer.ldelim()
    if (message.detail !== undefined) {
      writer.uint32(34).string(message.detail)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityAnalysis {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityAnalysis()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 8) {
            break
          }

          message.state = reader.int32() as any
          continue
        case 2:
          if (tag !== 16) {
            break
          }

          message.justification = reader.int32() as any
          continue
        case 3:
          if (tag === 24) {
            message.response.push(reader.int32() as any)

            continue
          }

          if (tag === 26) {
            const end2 = reader.uint32() + reader.pos
            while (reader.pos < end2) {
              message.response.push(reader.int32() as any)
            }

            continue
          }

          break
        case 4:
          if (tag !== 34) {
            break
          }

          message.detail = reader.string()
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityAnalysis {
    return {
      state: isSet(object.state) ? impactAnalysisStateFromJSON(object.state) : undefined,
      justification: isSet(object.justification)
        ? impactAnalysisJustificationFromJSON(object.justification)
        : undefined,
      response: Array.isArray(object?.response)
        ? object.response.map((e: any) => vulnerabilityResponseFromJSON(e))
        : [],
      detail: isSet(object.detail) ? String(object.detail) : undefined,
    }
  },

  toJSON(message: VulnerabilityAnalysis): unknown {
    const obj: any = {}
    if (message.state !== undefined) {
      obj.state = impactAnalysisStateToJSON(message.state)
    }
    if (message.justification !== undefined) {
      obj.justification = impactAnalysisJustificationToJSON(message.justification)
    }
    if (message.response?.length) {
      obj.response = message.response.map((e) => vulnerabilityResponseToJSON(e))
    }
    if (message.detail !== undefined) {
      obj.detail = message.detail
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityAnalysis>, I>>(base?: I): VulnerabilityAnalysis {
    return VulnerabilityAnalysis.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityAnalysis>, I>>(object: I): VulnerabilityAnalysis {
    const message = createBaseVulnerabilityAnalysis()
    message.state = object.state ?? undefined
    message.justification = object.justification ?? undefined
    message.response = object.response?.map((e) => e) || []
    message.detail = object.detail ?? undefined
    return message
  },
}

function createBaseVulnerabilityAffects(): VulnerabilityAffects {
  return {ref: '', versions: []}
}

export const VulnerabilityAffects = {
  encode(message: VulnerabilityAffects, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.ref !== '') {
      writer.uint32(10).string(message.ref)
    }
    for (const v of message.versions) {
      VulnerabilityAffectedVersions.encode(v!, writer.uint32(18).fork()).ldelim()
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityAffects {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityAffects()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.ref = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.versions.push(VulnerabilityAffectedVersions.decode(reader, reader.uint32()))
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityAffects {
    return {
      ref: isSet(object.ref) ? String(object.ref) : '',
      versions: Array.isArray(object?.versions)
        ? object.versions.map((e: any) => VulnerabilityAffectedVersions.fromJSON(e))
        : [],
    }
  },

  toJSON(message: VulnerabilityAffects): unknown {
    const obj: any = {}
    if (message.ref !== '') {
      obj.ref = message.ref
    }
    if (message.versions?.length) {
      obj.versions = message.versions.map((e) => VulnerabilityAffectedVersions.toJSON(e))
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityAffects>, I>>(base?: I): VulnerabilityAffects {
    return VulnerabilityAffects.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityAffects>, I>>(object: I): VulnerabilityAffects {
    const message = createBaseVulnerabilityAffects()
    message.ref = object.ref ?? ''
    message.versions = object.versions?.map((e) => VulnerabilityAffectedVersions.fromPartial(e)) || []
    return message
  },
}

function createBaseVulnerabilityAffectedVersions(): VulnerabilityAffectedVersions {
  return {version: undefined, range: undefined, status: undefined}
}

export const VulnerabilityAffectedVersions = {
  encode(message: VulnerabilityAffectedVersions, writer: _m0.Writer = _m0.Writer.create()): _m0.Writer {
    if (message.version !== undefined) {
      writer.uint32(10).string(message.version)
    }
    if (message.range !== undefined) {
      writer.uint32(18).string(message.range)
    }
    if (message.status !== undefined) {
      writer.uint32(24).int32(message.status)
    }
    return writer
  },

  decode(input: _m0.Reader | Uint8Array, length?: number): VulnerabilityAffectedVersions {
    const reader = input instanceof _m0.Reader ? input : _m0.Reader.create(input)
    let end = length === undefined ? reader.len : reader.pos + length
    const message = createBaseVulnerabilityAffectedVersions()
    while (reader.pos < end) {
      const tag = reader.uint32()
      switch (tag >>> 3) {
        case 1:
          if (tag !== 10) {
            break
          }

          message.version = reader.string()
          continue
        case 2:
          if (tag !== 18) {
            break
          }

          message.range = reader.string()
          continue
        case 3:
          if (tag !== 24) {
            break
          }

          message.status = reader.int32() as any
          continue
      }
      if ((tag & 7) === 4 || tag === 0) {
        break
      }
      reader.skipType(tag & 7)
    }
    return message
  },

  fromJSON(object: any): VulnerabilityAffectedVersions {
    return {
      version: isSet(object.version) ? String(object.version) : undefined,
      range: isSet(object.range) ? String(object.range) : undefined,
      status: isSet(object.status) ? vulnerabilityAffectedStatusFromJSON(object.status) : undefined,
    }
  },

  toJSON(message: VulnerabilityAffectedVersions): unknown {
    const obj: any = {}
    if (message.version !== undefined) {
      obj.version = message.version
    }
    if (message.range !== undefined) {
      obj.range = message.range
    }
    if (message.status !== undefined) {
      obj.status = vulnerabilityAffectedStatusToJSON(message.status)
    }
    return obj
  },

  create<I extends Exact<DeepPartial<VulnerabilityAffectedVersions>, I>>(base?: I): VulnerabilityAffectedVersions {
    return VulnerabilityAffectedVersions.fromPartial(base ?? ({} as any))
  },
  fromPartial<I extends Exact<DeepPartial<VulnerabilityAffectedVersions>, I>>(
    object: I
  ): VulnerabilityAffectedVersions {
    const message = createBaseVulnerabilityAffectedVersions()
    message.version = object.version ?? undefined
    message.range = object.range ?? undefined
    message.status = object.status ?? undefined
    return message
  },
}

type Builtin = Date | Function | Uint8Array | string | number | boolean | undefined

export type DeepPartial<T> = T extends Builtin
  ? T
  : T extends Array<infer U>
  ? Array<DeepPartial<U>>
  : T extends ReadonlyArray<infer U>
  ? ReadonlyArray<DeepPartial<U>>
  : T extends {}
  ? {[K in keyof T]?: DeepPartial<T[K]>}
  : Partial<T>

type KeysOfUnion<T> = T extends T ? keyof T : never
export type Exact<P, I extends P> = P extends Builtin
  ? P
  : P & {[K in keyof P]: Exact<P[K], I[K]>} & {[K in Exclude<keyof I, KeysOfUnion<P>>]: never}

function toTimestamp(date: Date): Timestamp {
  const seconds = date.getTime() / 1_000
  const nanos = (date.getTime() % 1_000) * 1_000_000
  return {seconds, nanos}
}

function fromTimestamp(t: Timestamp): Date {
  let millis = (t.seconds || 0) * 1_000
  millis += (t.nanos || 0) / 1_000_000
  return new Date(millis)
}

function fromJsonTimestamp(o: any): Date {
  if (o instanceof Date) {
    return o
  } else if (typeof o === 'string') {
    return new Date(o)
  } else {
    return fromTimestamp(Timestamp.fromJSON(o))
  }
}

function isSet(value: any): boolean {
  return value !== null && value !== undefined
}
