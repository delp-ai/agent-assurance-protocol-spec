import {
  extractSchemaAliasReferences,
  loadPrimarySpecSources,
  querySourceFields,
  queryUniqueSection,
} from './docs.mjs';
import { extractTypedDefinitionsFromDocs } from './objects.mjs';

function normalizeTableValue(value) {
  return value.replace(/`/g, '').trim();
}

function toLowerCamelCase(value) {
  return value.length > 0 ? value[0].toLowerCase() + value.slice(1) : value;
}

function encodeFieldTable(entries) {
  return entries.map((entry) => [entry.tag, entry.field, entry.type, entry.required ? 1 : 0]);
}

function encodeTableGroup(group) {
  return Object.fromEntries(
    Object.entries(group).map(([typeName, entries]) => [typeName, encodeFieldTable(entries)]),
  );
}

function parseCsvValue(value) {
  return normalizeTableValue(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBooleanValue(value) {
  return normalizeTableValue(value) === 'true';
}

function parseDashOrCsv(value) {
  const normalized = normalizeTableValue(value);
  return normalized === '-' ? [] : parseCsvValue(normalized);
}

function normalizeRows(rows) {
  return rows.map((cells) => cells.map((cell) => normalizeTableValue(cell)));
}

function projectRecord(record, fieldPlan) {
  return Object.fromEntries(
    Object.entries(fieldPlan).map(([fieldName, parser]) => [fieldName, parser(record[fieldName])]),
  );
}

function executeSectionPlan(source, plan) {
  return Object.fromEntries(
    Object.entries(plan).map(([key, spec]) => {
      const result = queryUniqueSection(source, spec.query);
      return [key, spec.select(result.value, result)];
    }),
  );
}

function buildProjectedMap(groups) {
  return Object.fromEntries(
    groups.flatMap(({ entries, filter = () => true, project }) =>
      entries.filter(filter).map(project)
    ),
  );
}

function parseEncodingSpec(wireSource) {
  const projection = querySourceFields(wireSource, {
    description: 'wire encoding metadata',
    fields: {
      magicHex: {
        pattern: /Fixed constant: `((?:0x[0-9A-Fa-f]{2})(?:\s+0x[0-9A-Fa-f]{2})*)`\./,
        select: (match) => match[1].trim().toUpperCase().replace(/0X/g, '0x'),
      },
      bootstrapVersion: {
        pattern: /fixed bootstrap version `(\d+\.\d+)`/,
        select: (match) => {
          const [major, minor] = match[1].split('.').map(Number);
          return { major, minor };
        },
      },
    },
  });

  return {
    ...projection.value,
    versionFieldWidthBytes: 1,
    frameTypeWidthBytes: 2,
    flagsWidthBytes: 2,
    sessionIdWidthBytes: 16,
    headerBitmapWidthBytes: 4,
    headerBitmapWidthBits: 32,
    sectionTagShiftBits: 1,
    sectionCriticalBitMask: 1,
    payloadEnvelope: {
      defaultSchemaLocalRevision: 1,
    },
  };
}

function deriveCanonicalAliases(typed, canonicalContent, canonicalSourceFile) {
  return buildProjectedMap([
    {
      entries: Object.keys(typed.commonTypes),
      project: (typeName) => [typeName[0].toLowerCase() + typeName.slice(1), typeName],
    },
    {
      entries: extractSchemaAliasReferences(canonicalContent, canonicalSourceFile),
      filter: (reference) =>
        typed.commonTypes[reference.target]
        || typed.compositeTypes[reference.target]
        || typed.objects[reference.target],
      project: (reference) => [reference.alias, reference.target],
    },
  ]);
}

const wireSectionPlan = {
  flagNames: {
    query: {
      kind: 'headingBody',
      heading: 'Flags',
      description: 'flag names',
    },
    select: (body, result) => {
      const matches = [...body.matchAll(/- bit \d+: `([^`]+)`/g)].map((entry) => entry[1]);
      if (matches.length === 0) {
        throw new Error(
          `${result.sourceFile}: could not parse flag names from '${result.sourceHeading}'`,
        );
      }
      return matches;
    },
  },
  mandatoryFrameSet: {
    query: {
      kind: 'list',
      description: 'mandatory frame set',
      minLength: 10,
      requiredItems: ['HELLO', 'CAPS', 'PROPOSE', 'CLOSE'],
    },
    select: (list) => list,
  },
  frameTypes: {
    query: {
      kind: 'table',
      description: 'frame type registry table',
      headers: ['Code', 'Name', 'Default reliability'],
    },
    select: (rows) => rows.map(([code, name, reliability]) => [Number(code), name, reliability]),
  },
  headerSections: {
    query: {
      kind: 'table',
      description: 'header section registry table',
      headers: ['Tag', 'Name', 'Purpose', 'Schema'],
    },
    select: (rows) => rows.map(([tag, name, purpose, type]) => [Number(tag), name, purpose, type]),
  },
  headerSectionPolicies: {
    query: {
      kind: 'table',
      description: 'header section semantics table',
      headers: [
        'Tag',
        'Name',
        'Repeatable',
        'Required when',
        'Allowed when present',
        'Non-empty fields',
        'Additional checks',
      ],
    },
    select: (rows) =>
      Object.fromEntries(
        rows.map(([tag, name, repeatable, requiredWhen, allowedWhen, nonEmptyFields, checks]) => [
          normalizeTableValue(name),
          {
            tag: Number(tag),
            repeatable: normalizeTableValue(repeatable) === 'yes',
            requiredWhenFlags: parseDashOrCsv(requiredWhen),
            allowedWhenFlags: parseDashOrCsv(allowedWhen),
            nonEmptyFields: parseDashOrCsv(nonEmptyFields),
            checks: parseDashOrCsv(checks),
          },
        ]),
      ),
  },
  errorRecoveryMatrix: {
    query: {
      kind: 'table',
      description: 'wire error recovery matrix',
      headers: [
        'Code',
        'Symbol',
        'Default scope',
        'Default session effect',
        'Mandatory retryable',
        'Required handling',
      ],
    },
    select: (rows) =>
      rows.map(([code, symbol, scope, sessionEffect, retryable, requiredHandling]) => [
        Number(code),
        normalizeTableValue(symbol),
        normalizeTableValue(scope),
        normalizeTableValue(sessionEffect),
        parseBooleanValue(retryable),
        normalizeTableValue(requiredHandling),
      ]),
  },
};

const workflowSectionPlans = {
  wire: {
    handshakeNegotiation: {
      query: {
        kind: 'table',
        description: 'handshake invariant table',
        headers: ['ID', 'Scope', 'Requirement', 'Enforcement'],
        requiredFirstColumnValues: [
          'bootstrapVersion',
          'handshakeOrder',
          'policyDigestConvergence',
        ],
      },
      select: normalizeRows,
    },
    handshakeProfile: {
      query: {
        kind: 'keyValue',
        description: 'handshake validation profile',
        requiredKeys: [
          'negotiationFrameOrder',
          'negotiationFrameStreams',
          'bootstrapVersion',
          'helloConvergenceFields',
          'capsConvergenceFields',
          'policyBindingSourceField',
          'policyBindingTargetField',
          'bootstrapAcceptanceModeField',
          'resumeAcceptanceModeField',
          'normalBootstrapModeValue',
          'degradedBootstrapModes',
          'forbidContractBoundTrafficBeforeCaps',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          negotiationFrameOrder: parseCsvValue,
          negotiationFrameStreams: parseCsvValue,
          bootstrapVersion: normalizeTableValue,
          helloConvergenceFields: parseCsvValue,
          capsConvergenceFields: parseCsvValue,
          policyBindingSourceField: normalizeTableValue,
          policyBindingTargetField: normalizeTableValue,
          bootstrapAcceptanceModeField: normalizeTableValue,
          resumeAcceptanceModeField: normalizeTableValue,
          normalBootstrapModeValue: normalizeTableValue,
          degradedBootstrapModes: parseCsvValue,
          forbidContractBoundTrafficBeforeCaps: parseBooleanValue,
        }),
    },
    closeScopeValidationProfile: {
      query: {
        kind: 'keyValue',
        description: 'close scope validation profile',
        requiredKeys: [
          'sessionRequiredFields',
          'sessionForbiddenFields',
          'sessionRequiresFinalityContext',
          'contractRequiredFields',
          'contractForbiddenFields',
          'contractRequiresFinalityContext',
          'diagnosticRequiredFields',
          'diagnosticForbiddenFields',
          'diagnosticRequiresFinalityContext',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          sessionRequiredFields: parseCsvValue,
          sessionForbiddenFields: parseCsvValue,
          sessionRequiresFinalityContext: parseBooleanValue,
          contractRequiredFields: parseCsvValue,
          contractForbiddenFields: parseCsvValue,
          contractRequiresFinalityContext: parseBooleanValue,
          diagnosticRequiredFields: parseCsvValue,
          diagnosticForbiddenFields: parseCsvValue,
          diagnosticRequiresFinalityContext: parseBooleanValue,
        }),
    },
    degradedBootstrapAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'degraded bootstrap admission profile',
        requiredKeys: [
          'domainLimitedAllowedPhases',
          'domainLimitedRejectedTrustLevels',
          'domainLimitedRejectedFinalityModes',
          'domainLimitedAllowsBridgeDomains',
          'domainLimitedAllowsQuorumClaims',
          'finalityBlockedAllowedPhases',
          'finalityBlockedForbiddenFrames',
          'finalityBlockedLateEvidencePolicy',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          domainLimitedAllowedPhases: parseCsvValue,
          domainLimitedRejectedTrustLevels: parseCsvValue,
          domainLimitedRejectedFinalityModes: parseCsvValue,
          domainLimitedAllowsBridgeDomains: parseBooleanValue,
          domainLimitedAllowsQuorumClaims: parseBooleanValue,
          finalityBlockedAllowedPhases: parseCsvValue,
          finalityBlockedForbiddenFrames: parseCsvValue,
          finalityBlockedLateEvidencePolicy: normalizeTableValue,
        }),
    },
    deadlineAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'deadline admission profile',
        requiredKeys: [
          'deadlineBoundaryRule',
          'stalePredicate',
          'sameBatchOrderingFields',
          'sameBatchOrderingPurpose',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          deadlineBoundaryRule: normalizeTableValue,
          stalePredicate: normalizeTableValue,
          sameBatchOrderingFields: parseCsvValue,
          sameBatchOrderingPurpose: normalizeTableValue,
        }),
    },
    sessionResumption: {
      query: {
        kind: 'table',
        description: 'session resumption invariant table',
        headers: ['ID', 'Scope', 'Requirement', 'Enforcement'],
        requiredFirstColumnValues: [
          'resumeTokenBinding',
          'lineagePreservation',
          'postResumeTrafficGate',
        ],
      },
      select: normalizeRows,
    },
    resumeProfile: {
      query: {
        kind: 'keyValue',
        description: 'session resumption validation profile',
        requiredKeys: [
          'resumeAcceptanceType',
          'resumeRefusalType',
          'resumeAcceptancePolicyField',
          'resumeAcceptanceLineageField',
          'resumeAcceptanceSessionField',
          'resumeRefusalLineageField',
          'resumeRefusalActionField',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          resumeAcceptanceType: normalizeTableValue,
          resumeRefusalType: normalizeTableValue,
          resumeAcceptancePolicyField: normalizeTableValue,
          resumeAcceptanceLineageField: normalizeTableValue,
          resumeAcceptanceSessionField: normalizeTableValue,
          resumeRefusalLineageField: normalizeTableValue,
          resumeRefusalActionField: normalizeTableValue,
        }),
    },
  },
  contract: {
    basePredicateRuntimeAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'base predicate runtime admission profile',
        requiredKeys: [
          'runtimeId',
          'moduleFormat',
          'entrypoint',
          'inputEncoding',
          'outputEncoding',
          'allowedImports',
          'floatingPoint',
          'randomness',
          'wallClockReads',
          'networkAccess',
          'filesystemAccess',
          'stdoutStderrWrites',
          'outputDigestScope',
          'unsupportedRuntimeAction',
          'deterministicFailureMode',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          runtimeId: normalizeTableValue,
          moduleFormat: normalizeTableValue,
          entrypoint: normalizeTableValue,
          inputEncoding: normalizeTableValue,
          outputEncoding: normalizeTableValue,
          allowedImports: normalizeTableValue,
          floatingPoint: normalizeTableValue,
          randomness: normalizeTableValue,
          wallClockReads: normalizeTableValue,
          networkAccess: normalizeTableValue,
          filesystemAccess: normalizeTableValue,
          stdoutStderrWrites: normalizeTableValue,
          outputDigestScope: normalizeTableValue,
          unsupportedRuntimeAction: parseCsvValue,
          deterministicFailureMode: normalizeTableValue,
        }),
    },
    deterministicPredicateFailureProfile: {
      query: {
        kind: 'keyValue',
        description: 'deterministic predicate failure profile',
        requiredKeys: [
          'manifestValidationFailure',
          'moduleValidationFailure',
          'forbiddenImportRequested',
          'trapOutcome',
          'fuelExhaustionOutcome',
          'wallClockTimeoutOutcome',
          'memoryLimitExceededOutcome',
          'canonicalOutputMismatchOutcome',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          manifestValidationFailure: normalizeTableValue,
          moduleValidationFailure: normalizeTableValue,
          forbiddenImportRequested: normalizeTableValue,
          trapOutcome: normalizeTableValue,
          fuelExhaustionOutcome: normalizeTableValue,
          wallClockTimeoutOutcome: normalizeTableValue,
          memoryLimitExceededOutcome: normalizeTableValue,
          canonicalOutputMismatchOutcome: normalizeTableValue,
        }),
    },
    raceResolutionAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'race resolution admission profile',
        requiredKeys: [
          'deadlineBoundaryRule',
          'stalePredicate',
          'concurrencyEvaluationOrder',
          'protectedArrivalOrderFields',
          'unresolvedTieOutcome',
          'exactDuplicateOutcome',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          deadlineBoundaryRule: normalizeTableValue,
          stalePredicate: normalizeTableValue,
          concurrencyEvaluationOrder: parseCsvValue,
          protectedArrivalOrderFields: parseCsvValue,
          unresolvedTieOutcome: normalizeTableValue,
          exactDuplicateOutcome: normalizeTableValue,
        }),
    },
    stateReportingProfile: {
      query: {
        kind: 'keyValue',
        description: 'state reporting validation profile',
        requiredKeys: [
          'phaseChangingStateRequiresDigest',
          'latestOnlyRequiresSemanticKey',
          'latestOnlyAllowsAcceptedPhaseChange',
          'explicitPhaseTransitions',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          phaseChangingStateRequiresDigest: parseBooleanValue,
          latestOnlyRequiresSemanticKey: parseBooleanValue,
          latestOnlyAllowsAcceptedPhaseChange: parseBooleanValue,
          explicitPhaseTransitions: parseCsvValue,
        }),
    },
    stateTransitionTable: {
      query: {
        kind: 'table',
        description: 'state transition table',
        headers: [
          'Current state',
          'Initiating frame',
          'Required authority',
          'Next state',
          'Mandatory preconditions',
          'Mandatory postconditions',
        ],
      },
      select: normalizeRows,
    },
    disputeValidationProfile: {
      query: {
        kind: 'keyValue',
        description: 'dispute validation profile',
        requiredKeys: [
          'maxActiveBlockingChallengesPerRevision',
          'replacementDigestField',
          'replacementRequiresActiveDigestMatch',
          'repairClearsBlockingStatus',
          'blockedTransitionPhases',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          maxActiveBlockingChallengesPerRevision: normalizeTableValue,
          replacementDigestField: normalizeTableValue,
          replacementRequiresActiveDigestMatch: parseBooleanValue,
          repairClearsBlockingStatus: parseBooleanValue,
          blockedTransitionPhases: parseCsvValue,
        }),
    },
  },
  trust: {
    trustFinalityBridge: {
      query: {
        kind: 'table',
        description: 'trust finality invariant table',
        headers: ['ID', 'Scope', 'Requirement', 'Enforcement'],
        requiredFirstColumnValues: [
          'bridgeSubmissionBinding',
          'finalityEvidenceBinding',
          'lateEvidenceAuditOnly',
        ],
      },
      select: normalizeRows,
    },
    bridgeBindingProfile: {
      query: {
        kind: 'keyValue',
        description: 'bridge binding profile',
        requiredKeys: ['submissionType', 'verificationType', 'verificationMethod', 'bindingFields'],
      },
      select: (profile) =>
        projectRecord(profile, {
          submissionType: normalizeTableValue,
          verificationType: normalizeTableValue,
          verificationMethod: normalizeTableValue,
          bindingFields: parseCsvValue,
        }),
    },
    bootstrapBundleValidationProfile: {
      query: {
        kind: 'keyValue',
        description: 'bootstrap bundle validation profile',
        requiredKeys: [
          'bundleType',
          'protectionProfileField',
          'policyDigestField',
          'manifestDigestField',
          'successorField',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          bundleType: normalizeTableValue,
          protectionProfileField: normalizeTableValue,
          policyDigestField: normalizeTableValue,
          manifestDigestField: normalizeTableValue,
          successorField: normalizeTableValue,
        }),
    },
    trustPolicyAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'trust policy admission profile',
        requiredKeys: [
          'bridgeDigestField',
          'bridgeAbsentBehavior',
          'proofProfileField',
          'proofProfileAbsentBehavior',
          'runtimeProfileField',
          'runtimeAbsentBehavior',
          'manifestSuccessorRule',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          bridgeDigestField: normalizeTableValue,
          bridgeAbsentBehavior: normalizeTableValue,
          proofProfileField: normalizeTableValue,
          proofProfileAbsentBehavior: normalizeTableValue,
          runtimeProfileField: normalizeTableValue,
          runtimeAbsentBehavior: normalizeTableValue,
          manifestSuccessorRule: normalizeTableValue,
        }),
    },
    closeBindingProfile: {
      query: {
        kind: 'keyValue',
        description: 'close binding profile',
        requiredKeys: [
          'settleFrameType',
          'closeFrameType',
          'settleFinalityField',
          'closePayloadFinalityField',
          'closeTraceField',
          'closeSectionType',
          'closeSectionDigestField',
          'closeSectionRequiredFields',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          settleFrameType: normalizeTableValue,
          closeFrameType: normalizeTableValue,
          settleFinalityField: normalizeTableValue,
          closePayloadFinalityField: normalizeTableValue,
          closeTraceField: normalizeTableValue,
          closeSectionType: normalizeTableValue,
          closeSectionDigestField: normalizeTableValue,
          closeSectionRequiredFields: parseCsvValue,
        }),
    },
    finalityAdmissionProfile: {
      query: {
        kind: 'keyValue',
        description: 'finality admission profile',
        requiredKeys: [
          'countStaleDomainsInWitnessSets',
          'countRevokedDomainsInWitnessSets',
          'countUnresolvedDomainsInWitnessSets',
          'conflictingEvidenceOutcome',
          'lateEvidenceOutcome',
        ],
      },
      select: (profile) =>
        projectRecord(profile, {
          countStaleDomainsInWitnessSets: parseBooleanValue,
          countRevokedDomainsInWitnessSets: parseBooleanValue,
          countUnresolvedDomainsInWitnessSets: parseBooleanValue,
          conflictingEvidenceOutcome: normalizeTableValue,
          lateEvidenceOutcome: normalizeTableValue,
        }),
    },
  },
};

export function buildProtocolState() {
  const sources = loadPrimarySpecSources();
  const wireSource = sources.wire;
  const contractSource = sources.contract;
  const trustSource = sources.trust;
  const canonicalSource = sources.canonical;
  const typed = extractTypedDefinitionsFromDocs();
  const wireSections = executeSectionPlan(wireSource, wireSectionPlan);

  return {
    agentManagementMode: 'agent-native',
    wire: {
      flagNames: wireSections.flagNames,
      encoding: {
        ...parseEncodingSpec(wireSource),
        namedSectionViews: Object.fromEntries(
          wireSections.headerSections
            .filter(([, name, , type]) => type)
            .map(([, name]) => [toLowerCamelCase(name), name]),
        ),
      },
      mandatoryFrameSet: wireSections.mandatoryFrameSet,
      frameTypes: wireSections.frameTypes,
      headerSections: wireSections.headerSections,
      headerSectionPolicies: wireSections.headerSectionPolicies,
      compositeTypes: encodeTableGroup(typed.compositeTypes),
      payloads: encodeTableGroup(typed.payloads),
    },
    workflow: {
      ...executeSectionPlan(wireSource, workflowSectionPlans.wire),
      ...executeSectionPlan(contractSource, workflowSectionPlans.contract),
      ...executeSectionPlan(trustSource, workflowSectionPlans.trust),
    },
    canonical: {
      aliases: deriveCanonicalAliases(typed, canonicalSource.content, canonicalSource.file),
      commonTypes: encodeTableGroup(typed.commonTypes),
      objects: encodeTableGroup(typed.objects),
    },
  };
}
