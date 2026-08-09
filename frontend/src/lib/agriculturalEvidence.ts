import type { RuntimeContext, SatelliteAssessment } from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAgriculturalEvidenceReady(
  assessment: SatelliteAssessment | undefined,
  locationId: string,
  runtime: RuntimeContext,
): assessment is SatelliteAssessment {
  if (
    !assessment?.persisted
    || assessment.locationId !== locationId
    || assessment.provider !== 'amazon-bedrock'
    || runtime.persistence !== 'cockroachdb'
  ) return false

  const source = assessment.source
  if (!isRecord(source) || !isRecord(source.upstream)) return false
  if (source.upstream.provider !== 'aws-open-data-sentinel-2-l2a') return false

  const guardDutyVerified = source.malware_scan_status === 'NO_THREATS_FOUND'
  const trustedSourceVerified = (
    source.malware_scan_status === 'NOT_APPLICABLE_TRUSTED_SOURCE'
    && source.content_validation_provider === 'sentineltwin-allowlisted-aws-open-data'
    && source.content_validation_status === 'SOURCE_HASH_VERIFIED'
  )
  return guardDutyVerified || trustedSourceVerified
}
