import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { clearClaimsError, fetchClaims } from '../store/slices/claimsSlice';
import { getDuplicateSeverity, getPipelineFailureReason, getPipelineSeverity } from '../utils/claimReviewStatus';

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
            {filteredClaims.map(claim => {
              const duplicateSeverity = getDuplicateSeverity(claim);
              const pipelineSeverity = getPipelineSeverity(claim);
              const pipelineReason = getPipelineFailureReason(claim);
              return (
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
                  <span className={`px-2 py-1 rounded text-xs font-medium ${duplicateSeverity.className}`}>
                    {duplicateSeverity.label}
                  </span>
                </td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${pipelineSeverity.className}`}>
                    {pipelineSeverity.label}
                  </span>
                  {pipelineReason && (
                    <p className="mt-1 text-xs text-gray-600 max-w-xs truncate" title={pipelineReason}>
                      {pipelineReason}
                    </p>
                  )}
                </td>
                <td className="p-4">{claim.submissionDate || '-'}</td>
                <td className="p-4">
                  <Link to={`/map?claim=${claim.id}`} className="text-blue-500 hover:underline">
                    View on Map
                  </Link>
                </td>
              </tr>
            );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ClaimTracking;
