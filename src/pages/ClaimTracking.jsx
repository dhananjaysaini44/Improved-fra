import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { clearClaimsError, fetchClaims } from '../store/slices/claimsSlice';

const ClaimTracking = () => {
  const [filter, setFilter] = useState('');
  const dispatch = useDispatch();
  const { items: claims, loading, error } = useSelector((state) => state.claims);

  useEffect(() => {
    dispatch(fetchClaims());

    return () => {
      dispatch(clearClaimsError());
    };
  }, [dispatch]);

  const filteredClaims = claims.filter(claim =>
    (claim.village || '').toLowerCase().includes(filter.toLowerCase()) ||
    (claim.status || '').toLowerCase().includes(filter.toLowerCase()) ||
    (claim.claimantName || '').toLowerCase().includes(filter.toLowerCase())
  );

  const duplicateLabel = (claim) => {
    const score = claim?.duplicateAnalysis?.duplicate_score || 0;
    if (score >= 0.8) return { text: 'High duplicate risk', className: 'bg-red-100 text-red-800' };
    if (score >= 0.5) return { text: 'Needs duplicate review', className: 'bg-amber-100 text-amber-800' };
    if (claim.modelStatus === 'success') return { text: 'OCR reviewed', className: 'bg-green-100 text-green-800' };
    return { text: 'No OCR result', className: 'bg-gray-100 text-gray-700' };
  };

  const pipelineLabel = (claim) => {
    const status = String(claim.pipelineStatus || '').toUpperCase();
    if (status.includes('ERROR')) {
      return { text: 'Error', className: 'bg-red-100 text-red-800' };
    }
    if ((claim.spatialConflicts || []).length > 0) {
      return { text: `${claim.spatialConflicts.length} spatial conflict(s)`, className: 'bg-red-100 text-red-800' };
    }
    if ((claim.gisWarnings || []).length > 0) {
      return { text: `${claim.gisWarnings.length} GIS warning(s)`, className: 'bg-amber-100 text-amber-800' };
    }
    if ((claim.pipelineStatus || '').toUpperCase().startsWith('SCORED')) {
      return { text: 'GIS checked', className: 'bg-blue-100 text-blue-800' };
    }
    return { text: 'Pipeline pending', className: 'bg-gray-100 text-gray-700' };
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Claim Tracking</h1>
      </div>

      <div className="mb-4">
        <input
          type="text"
          placeholder="Filter by village or status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border p-2 rounded w-full"
        />
      </div>

      {error && (
        <div className="mb-4 text-red-600">{error}</div>
      )}
      {loading && (
        <div className="mb-4 text-gray-600">Loading...</div>
      )}
      <div className="bg-white shadow rounded">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50">
              <th className="p-4 text-left">ID</th>
              <th className="p-4 text-left">Village</th>
              <th className="p-4 text-left">Status</th>
              <th className="p-4 text-left">OCR / Duplicate</th>
              <th className="p-4 text-left">GIS / Pipeline</th>
              <th className="p-4 text-left">Date</th>
              <th className="p-4 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredClaims.map(claim => (
              <tr key={claim.id} className="border-t">
                <td className="p-4">{claim.id}</td>
                <td className="p-4">{claim.village || '-'}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded ${
                    claim.status?.toLowerCase() === 'approved' ? 'bg-green-100 text-green-800' :
                    claim.status?.toLowerCase() === 'rejected' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {claim.status}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${duplicateLabel(claim).className}`}>
                    {duplicateLabel(claim).text}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${pipelineLabel(claim).className}`}>
                    {pipelineLabel(claim).text}
                  </span>
                </td>
                <td className="p-4">{claim.submissionDate || '-'}</td>
                <td className="p-4">
                  <Link to={`/map?claim=${claim.id}`} className="text-blue-500 hover:underline">
                    View on Map
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClaimTracking;
