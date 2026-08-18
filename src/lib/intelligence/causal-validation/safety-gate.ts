// =============================================================================
// Causal Safety Gate (Section 8) — deterministic server-side gate
// =============================================================================
// The optimizer MUST call this gate before using causal estimates to
// influence live budget allocation. The gate is:
//   - Server-side (not UI state)
//   - Deterministic (same inputs → same result)
//   - Based on validation suite results + confidence thresholds
//
// A causal estimate may influence live budget ONLY when:
//   - method validation passes
//   - data quality passes
//   - confidence threshold passes
//   - experiment calibration requirements pass
//   - assumptions are satisfied

import { runCausalValidation } from './validation-suite'
import type { CausalEstimate } from '../../domain/entities'

export interface CausalSafetyGateResult {
  allowed: boolean
  reason: string
  validationPassed: boolean
  confidencePassed: boolean
  evidenceType: string
  checks: Array<{ name: string; passed: boolean; detail: string }>
}

const MIN_CONFIDENCE_FOR_LIVE_BUDGET = 0.7
const CAUSAL_EVIDENCE_TYPES = ['CAUSAL'] // Only CAUSAL can influence live budget
// CORRELATED (MMM) and OBSERVED cannot

export async function causalSafetyGate(estimate: {
  confidence: number
  evidenceType?: string
  methodology: string
}): Promise<CausalSafetyGateResult> {
  const checks: Array<{ name: string; passed: boolean; detail: string }> = []

  // 1. Run the validation suite
  const validation = await runCausalValidation()
  checks.push({
    name: 'validation_suite',
    passed: validation.canInfluenceLiveBudget,
    detail: `${validation.passed}/${validation.totalTests} tests passed`,
  })

  // 2. Check confidence threshold
  const confidencePassed = estimate.confidence >= MIN_CONFIDENCE_FOR_LIVE_BUDGET
  checks.push({
    name: 'confidence_threshold',
    passed: confidencePassed,
    detail: `${(estimate.confidence * 100).toFixed(0)}% >= ${MIN_CONFIDENCE_FOR_LIVE_BUDGET * 100}% threshold`,
  })

  // 3. Check evidence type (only CAUSAL can influence live budget)
  const evidenceType = estimate.evidenceType ?? inferEvidenceType(estimate.methodology)
  const evidenceTypePassed = CAUSAL_EVIDENCE_TYPES.includes(evidenceType)
  checks.push({
    name: 'evidence_type',
    passed: evidenceTypePassed,
    detail: `type=${evidenceType} (only CAUSAL can influence live budget)`,
  })

  // 4. Method-specific assumption checks
  if (estimate.methodology === 'mmm' || estimate.methodology.includes('mmm')) {
    checks.push({
      name: 'mmm_cannot_influence_live_budget',
      passed: false,
      detail: 'MMM is CORRELATED evidence — cannot directly influence live budget without experiment calibration',
    })
  }

  const allowed = checks.every((c) => c.passed)
  const failedChecks = checks.filter((c) => !c.passed)

  return {
    allowed,
    reason: allowed
      ? 'Causal estimate passed all safety checks — may influence live budget'
      : `BLOCKED: ${failedChecks.map((c) => c.name).join(', ')}`,
    validationPassed: validation.canInfluenceLiveBudget,
    confidencePassed,
    evidenceType,
    checks,
  }
}

function inferEvidenceType(methodology: string): string {
  const m = methodology.toLowerCase()
  if (m.includes('mmm')) return 'CORRELATED'
  if (m.includes('ab_test') || m.includes('ab test') || m.includes('rct')) return 'CAUSAL'
  if (m.includes('holdout')) return 'CAUSAL'
  if (m.includes('geo')) return 'CAUSAL'
  if (m.includes('uplift')) return 'CAUSAL'
  if (m.includes('difference_in_differences') || m.includes('did')) return 'CAUSAL'
  if (m.includes('causal_impact') || m.includes('synthetic_control')) return 'CAUSAL'
  if (m.includes('attribution')) return 'CORRELATED'
  return 'CORRELATED' // default: not causal
}

/**
 * The deterministic gate function — can be called synchronously
 * with pre-validated estimates. Used by the optimizer.
 */
export function causalGateForEstimate(estimate: {
  confidence: number
  methodology: string
  evidenceType?: string
}): { allowed: boolean; reason: string } {
  const evidenceType = estimate.evidenceType ?? inferEvidenceType(estimate.methodology)
  if (evidenceType !== 'CAUSAL') {
    return {
      allowed: false,
      reason: `Evidence type ${evidenceType} cannot influence live budget (only CAUSAL)`,
    }
  }
  if (estimate.confidence < MIN_CONFIDENCE_FOR_LIVE_BUDGET) {
    return {
      allowed: false,
      reason: `Confidence ${(estimate.confidence * 100).toFixed(0)}% below threshold ${MIN_CONFIDENCE_FOR_LIVE_BUDGET * 100}%`,
    }
  }
  return { allowed: true, reason: 'Passed causal safety gate' }
}
