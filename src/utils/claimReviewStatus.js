const asNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export const getDuplicateSeverity = (claim) => {
  const score = asNumber(claim?.duplicateAnalysis?.duplicate_score);
  const modelStatus = String(claim?.modelStatus || '').toLowerCase();

  if (score >= 0.8) return { label: 'High risk', className: 'bg-red-100 text-red-800' };
  if (score >= 0.5) return { label: 'Review', className: 'bg-amber-100 text-amber-800' };
  if (modelStatus === 'success') return { label: 'Clear', className: 'bg-green-100 text-green-800' };
  return { label: 'No OCR result', className: 'bg-gray-100 text-gray-700' };
};

export const getPipelineSeverity = (claim) => {
  const status = String(claim?.pipelineStatus || '').toUpperCase();
  const suspicious = Boolean(claim?.confidenceScores?.is_suspicious);
  const warningCount = claim?.gisWarnings?.length || 0;
  const conflictCount = claim?.spatialConflicts?.length || 0;

  if (status.includes('ERROR')) {
    return { label: 'Error', className: 'bg-red-100 text-red-800' };
  }
  if (suspicious || conflictCount > 0 || warningCount > 0) {
    return { label: 'Spatial review', className: 'bg-amber-100 text-amber-800' };
  }
  if (status.startsWith('PROCESSING')) {
    return { label: 'Processing', className: 'bg-gray-100 text-gray-700' };
  }
  if (status.startsWith('SCORED')) {
    return { label: 'Pipeline scored', className: 'bg-blue-100 text-blue-800' };
  }
  return { label: 'Pending', className: 'bg-gray-100 text-gray-700' };
};

export const getPipelineFailureReason = (claim) => {
  const status = String(claim?.pipelineStatus || '').toUpperCase();
  const explicitError =
    claim?.pipelineResult?.error ||
    claim?.pipelineResult?.message ||
    claim?.pipelineError ||
    '';

  if (status.includes('ERROR') && explicitError) {
    return explicitError;
  }

  if ((claim?.spatialConflicts || []).length > 0) {
    const firstConflict = claim.spatialConflicts[0];
    if (typeof firstConflict === 'string' && firstConflict.trim()) {
      return firstConflict;
    }
    if (firstConflict?.reason) {
      return firstConflict.reason;
    }
    if (firstConflict?.type) {
      return `Spatial conflict: ${firstConflict.type}`;
    }
    return `${claim.spatialConflicts.length} spatial conflict(s) detected`;
  }

  if ((claim?.gisWarnings || []).length > 0) {
    const firstWarning = claim.gisWarnings[0];
    if (typeof firstWarning === 'string' && firstWarning.trim()) {
      return firstWarning;
    }
    return `${claim.gisWarnings.length} GIS warning(s) raised`;
  }

  return '';
};
