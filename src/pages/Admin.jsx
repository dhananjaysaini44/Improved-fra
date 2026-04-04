import { useCallback, useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Edit, Eye, Plus, Save, Shield, Trash2, X } from 'lucide-react';
import authService from '../services/authService';
import { approveClaim, clearClaimsError, fetchClaims, rejectClaim } from '../store/slices/claimsSlice';
import { clearUsersError, deleteUser as deleteUserAction, fetchUsers, updateUser as updateUserAction } from '../store/slices/usersSlice';
import { getDuplicateSeverity, getPipelineSeverity } from '../utils/claimReviewStatus';

const Admin = () => {
  const { user, isAuthenticated } = useSelector((state) => state.auth);
  const { items: users, error: usersError } = useSelector((state) => state.users);
  const { items: claims, error: claimsError } = useSelector((state) => state.claims);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectClaimId, setRejectClaimId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [khasraVerifyData, setKhasraVerifyData] = useState(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [notification, setNotification] = useState(null);
  const pendingClaims = claims.filter((claim) => String(claim.status || '').toLowerCase() === 'pending');

  // Check admin access and fetch users
  useEffect(() => {
    if (usersError) {
      showNotification(usersError, 'error');
      dispatch(clearUsersError());
    }
  }, [dispatch, usersError]);

  useEffect(() => {
    if (claimsError) {
      showNotification(claimsError, 'error');
      dispatch(clearClaimsError());
    }
  }, [claimsError, dispatch]);

  const refreshUsers = useCallback(async () => {
    try {
      await dispatch(fetchUsers()).unwrap();
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  }, [dispatch]);

  const fetchLogs = async () => {
    try {
      const logService = (await import('../services/logService')).default;
      const recent = await logService.getRecentLogs(20);
      setLogs(recent);
    } catch (error) {
      console.error('Error fetching logs:', error);
      // Do not show notification here to avoid spamming on non-admin
    }
  };

  const refreshPendingClaims = useCallback(async () => {
    try {
      await dispatch(fetchClaims({ status: 'pending' })).unwrap();
    } catch (error) {
      console.error('Error fetching pending claims:', error);
    }
  }, [dispatch]);

  useEffect(() => {
    if (!isAuthenticated) {
      showNotification('Please log in to access the admin panel.', 'error');
      navigate('/login');
      return;
    }

    if (user?.role !== 'admin') {
      showNotification('Admin access required. Please contact an administrator.', 'error');
      return;
    }

    refreshUsers();
    fetchLogs();
    refreshPendingClaims();
  }, [isAuthenticated, user, navigate, refreshPendingClaims, refreshUsers]);

  const clearLogs = async () => {
    try {
      const logService = (await import('../services/logService')).default;
      // 1) Export all logs as CSV and trigger browser download
      const { blob, filename } = await logService.exportAllLogsAsBlob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 0);

      // 2) After successful download, clear logs on the server
      try {
        await authService.api.delete('/logs');
        setLogs([]);
        showNotification('Logs exported and cleared');
      } catch (clearErr) {
        console.error('Error clearing logs after export:', clearErr);
        const message = clearErr?.response?.data?.message || clearErr.message || 'Logs exported, but failed to clear on server';
        showNotification(message, 'error');
      }
    } catch (error) {
      console.error('Error exporting logs:', error);
      const message = error?.response?.data?.message || error.message || 'Failed to export logs';
      showNotification(message, 'error');
    }
  };

  const handleApproveClaim = async (id) => {
    try {
      await dispatch(approveClaim(id)).unwrap();
      showNotification(`Claim #${id} approved`);
    } catch (error) {
      console.error('Error approving claim:', error);
      showNotification(error.message || String(error), 'error');
    }
  };

  const handleRejectClaim = (id) => {
    setRejectClaimId(id);
    setRejectReason('');
    setIsRejectModalOpen(true);
  };

  const confirmRejectClaim = async () => {
    if (!rejectReason || !rejectReason.trim()) {
      showNotification('Rejection reason is required', 'error');
      return;
    }
    try {
      await dispatch(rejectClaim({ id: rejectClaimId, reason: rejectReason.trim() })).unwrap();
      showNotification(`Claim #${rejectClaimId} rejected`);
      setIsRejectModalOpen(false);
      setRejectClaimId(null);
      setRejectReason('');
    } catch (error) {
      console.error('Error rejecting claim:', error);
      const message = error?.response?.data?.message || error.message || 'Failed to reject claim';
      showNotification(message, 'error');
    }
  };

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleFetchKhasraVerify = async (id) => {
    try {
      const resp = await authService.api.get(`/admin/claims/${id}/khasra-verify`);
      setKhasraVerifyData(resp.data);
    } catch (error) {
      console.error('Error fetching Khasra verification:', error);
    }
  };

  useEffect(() => {
    if (selectedClaim?.id) {
      handleFetchKhasraVerify(selectedClaim.id);
    } else {
      setKhasraVerifyData(null);
    }
  }, [selectedClaim]);

  const handleTogglePatwariVerify = async () => {
    if (!selectedClaim) return;
    try {
      setIsVerifying(true);
      const newVal = !selectedClaim.patwari_verified;
      await authService.api.patch(`/admin/claims/${selectedClaim.id}`, { patwari_verified: newVal });
      setSelectedClaim({ ...selectedClaim, patwari_verified: newVal });
      showNotification(`Patwari verification updated to ${newVal ? 'Verified' : 'Unverified'}`);
    } catch (error) {
      showNotification('Failed to update verification', 'error');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleEditUser = (user) => {
    setEditingUser({ ...user });
    setIsEditModalOpen(true);
  };

  const handleSaveUser = async () => {
    try {
      const gpid = String(editingUser.gram_panchayat_id || '').trim();
      if (!gpid) {
        showNotification('Gram Panchayat ID is required', 'error');
        return;
      }
      if (!/^[A-Za-z0-9]+$/.test(gpid) || gpid.length < 10) {
        showNotification('Gram Panchayat ID must be alphanumeric and at least 10 characters long', 'error');
        return;
      }
      await dispatch(updateUserAction({
        id: editingUser.id,
        userData: { ...editingUser, gram_panchayat_id: gpid },
      })).unwrap();
      setIsEditModalOpen(false);
      setEditingUser(null);
      showNotification('User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      showNotification(error.message, 'error');
    }
  };

  const handleDeleteUser = async (userId) => {
    if (window.confirm('Are you sure you want to delete this user?')) {
      try {
        await dispatch(deleteUserAction(userId)).unwrap();
        showNotification('User deleted successfully');
      } catch (error) {
        console.error('Error deleting user:', error);
        showNotification(error.message, 'error');
      }
    }
  };

  const handleAddUser = async (newUser) => {
    try {
      // Register via auth to follow the same signup rules (phone, password hashing, validations)
      const phoneDigits = String(newUser.phone || '').replace(/\D/g, '');
      if (!phoneDigits || phoneDigits.length < 10 || phoneDigits.length > 11) {
        showNotification('Phone number must be 10 or 11 digits', 'error');
        return;
      }
      if (!newUser.password || newUser.password.length < 8) {
        showNotification('Password must be at least 8 characters long', 'error');
        return;
      }
      if (!newUser.state || !['MP','TR','OD','TL'].includes(newUser.state)) {
        showNotification('Please select a valid state', 'error');
        return;
      }
      if (!newUser.district || !newUser.village) {
        showNotification('District and village are required', 'error');
        return;
      }
      const gpid = String(newUser.gram_panchayat_id || '').trim();
      if (!gpid) {
        showNotification('Gram Panchayat ID is required', 'error');
        return;
      }
      if (!/^[A-Za-z0-9]+$/.test(gpid) || gpid.length < 10) {
        showNotification('Gram Panchayat ID must be alphanumeric and at least 10 characters long', 'error');
        return;
      }

      const reg = await authService.register({
        name: newUser.name,
        email: newUser.email,
        password: newUser.password,
        phone: phoneDigits,
        state: newUser.state,
        district: newUser.district,
        village: newUser.village,
        gram_panchayat_id: gpid,
      });

      // If admin selected a role other than 'user', update it
      if (newUser.role && newUser.role !== 'user' && reg?.id) {
        try {
          await dispatch(updateUserAction({
            id: reg.id,
            userData: {
              id: reg.id,
              name: newUser.name,
              email: newUser.email,
              role: newUser.role,
              state: newUser.state || 'Not specified',
              district: newUser.district || '',
              village: newUser.village || '',
              phone: phoneDigits,
              gram_panchayat_id: gpid,
            },
          })).unwrap();
        } catch (e) {
          console.warn('Role update failed for new user, leaving as default user role.', e);
        }
      }

      await refreshUsers();
      setIsAddModalOpen(false);
      showNotification('User added successfully');
    } catch (error) {
      console.error('Error adding user:', error);
      showNotification(error.message, 'error');
    }
  };

  // If not authenticated or not admin, show access denied
  if (!isAuthenticated || user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
          <div className="mb-4">
            <Shield className="h-16 w-16 text-red-500 mx-auto" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Restricted</h2>
          <p className="text-gray-600 mb-6">
            {!isAuthenticated 
              ? 'You need to log in to access the admin panel.' 
              : 'Admin privileges are required to access this section.'}
          </p>
          <div className="space-y-3">
            {!isAuthenticated ? (
              <button
                onClick={() => navigate('/login')}
                className="w-full bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
              >
                Go to Login
              </button>
            ) : (
              <p className="text-sm text-gray-500">
                Please contact an administrator for access.
              </p>
            )}
            <button
              onClick={() => navigate('/dashboard')}
              className="w-full bg-gray-300 text-gray-700 px-4 py-2 rounded-md hover:bg-gray-400"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Notification */}
      {notification && (
        <div className={`fixed top-20 right-4 p-4 rounded-md shadow-lg z-[12000] ${
          notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
        }`}>
          {notification.message}
        </div>
      )}

      <div className="mb-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="w-full sm:w-auto bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center justify-center"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-8">
          <div className="bg-white p-6 rounded shadow overflow-hidden">
            <h2 className="text-xl font-semibold mb-4">Claim Moderation</h2>
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-gray-600">Review and decide on pending claims</p>
              <button onClick={refreshPendingClaims} className="w-full sm:w-auto text-sm px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">Refresh</button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="p-2 text-left">ID</th>
                    <th className="p-2 text-left">Claimant</th>
                    <th className="p-2 text-left">Village</th>
                    <th className="p-2 text-left">State</th>
                    <th className="p-2 text-left">OCR Review</th>
                    <th className="p-2 text-left">GIS Review</th>
                    <th className="p-2 text-left">Submitted</th>
                    <th className="p-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingClaims.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="p-4 text-center text-gray-500">
                        No pending claims.
                      </td>
                    </tr>
                  ) : (
                    pendingClaims.map(c => (
                      <tr key={c.id} className="border-t">
                        <td className="p-2">{c.id}</td>
                        <td className="p-2">{c.claimantName || '-'}</td>
                        <td className="p-2">{c.village || '-'}</td>
                        <td className="p-2">{c.state || '-'}</td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${getDuplicateSeverity(c).className}`}>
                              {getDuplicateSeverity(c).label}
                            </span>
                            {c.duplicateAnalysis && (
                              <button
                                type="button"
                                onClick={() => setSelectedClaim(c)}
                                className="text-blue-600 hover:text-blue-800"
                                title="View OCR and duplicate analysis"
                              >
                                <Eye className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-2">
                          <span className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${getPipelineSeverity(c).className}`}>
                            {getPipelineSeverity(c).label}
                          </span>
                        </td>
                        <td className="p-2 whitespace-nowrap">{c.submissionDate || '-'}</td>
                        <td className="p-2">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <button onClick={() => handleApproveClaim(c.id)} className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 whitespace-nowrap">Approve</button>
                            <button onClick={() => handleRejectClaim(c.id)} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 whitespace-nowrap">Reject</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white p-6 rounded shadow overflow-hidden">
            <h2 className="text-xl font-semibold mb-4">User Management</h2>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="p-2 text-left">Name</th>
                <th className="p-2 text-left">Role</th>
                <th className="p-2 text-left">Email</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan="4" className="p-4 text-center text-gray-500">
                    No users found. Click "Add User" to create one.
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <tr key={user.id} className="border-t">
                    <td className="p-2">{user.name}</td>
                    <td className="p-2">{user.role}</td>
                    <td className="p-2">{user.email}</td>
                    <td className="p-2">
                      <button
                        onClick={() => handleEditUser(user)}
                        className="text-blue-500 hover:text-blue-700 mr-3 p-1"
                        title="Edit User"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                        title="Delete User"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded shadow overflow-hidden">
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between sm:items-center mb-4">
            <h2 className="text-xl font-semibold">System Logs</h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={fetchLogs} className="text-sm px-3 py-1 bg-gray-100 rounded hover:bg-gray-200">Refresh</button>
              <button onClick={clearLogs} className="text-sm px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700">Clear Logs</button>
            </div>
          </div>
          <div className="space-y-2 max-h-96 overflow-auto">
            {logs.length === 0 ? (
              <div className="text-gray-500">No logs found.</div>
            ) : (
              logs.map(log => (
                <div key={log.id} className="border p-2 rounded">
                  <div className="flex justify-between">
                    <p>
                      <strong>{log.action}</strong>
                      {log.user_name || log.user_email ? (
                        <span className="text-gray-600"> by {log.user_name || log.user_email}</span>
                      ) : null}
                      {log.entity_type && log.entity_id ? (
                        <span className="text-gray-600"> on {log.entity_type} #{log.entity_id}</span>
                      ) : null}
                    </p>
                    <span className="text-sm text-gray-600">{(() => { const s = log.created_at_iso || log.created_at; if (!s) return '-'; const iso = typeof s === 'string' ? s.replace(/\.(\d{3})\d+Z$/, '.$1Z') : s; const d = new Date(iso); return isNaN(d) ? String(s) : d.toLocaleString(); })()}</span>
                  </div>
                  {log.details && (
                    <pre className="mt-1 text-xs bg-gray-50 p-2 rounded overflow-auto">{(() => { try { return JSON.stringify(JSON.parse(log.details), null, 2); } catch { return String(log.details); } })()}</pre>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit User Modal */}
      {isEditModalOpen && editingUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[12000]">
          <div className="bg-white dark:bg-gray-800 dark:text-white p-6 rounded-lg w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Edit User</h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Name</label>
                <input
                  type="text"
                  value={editingUser.name}
                  onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Role</label>
                <select
                  value={editingUser.role}
                  onChange={(e) => setEditingUser({...editingUser, role: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="Gram Sabha">Gram Sabha</option>
                  <option value="District Officer">District Officer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Gram Panchayat ID</label>
                <input
                  type="text"
                  value={editingUser.gram_panchayat_id || ''}
                  onChange={(e) => setEditingUser({...editingUser, gram_panchayat_id: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                  placeholder="Alphanumeric, min 10 chars"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={editingUser.email}
                  onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                  className="w-full border rounded-md px-3 py-2"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveUser}
                className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center"
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedClaim && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[12000]">
          <div className="bg-white dark:bg-gray-800 dark:text-white p-6 rounded-lg w-full max-w-4xl mx-4 max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">OCR and Duplicate Review</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">
                  Claim #{selectedClaim.id} for {selectedClaim.claimantName || 'Unknown claimant'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedClaim(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <h4 className="font-semibold">Duplicate Analysis</h4>
                  </div>
                  {selectedClaim.duplicateAnalysis ? (
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getDuplicateSeverity(selectedClaim).className}`}>
                          {getDuplicateSeverity(selectedClaim).label}
                        </span>
                        <span>Score: {selectedClaim.duplicateAnalysis.duplicate_score ?? 0}</span>
                      </div>
                      <p className="text-gray-700 dark:text-gray-300">
                        {selectedClaim.duplicateAnalysis.explanation || 'No explanation available.'}
                      </p>
                      <div>
                        <h5 className="font-medium mb-2">Matched Claim IDs</h5>
                        <p className="text-gray-700 dark:text-gray-300">
                          {selectedClaim.duplicateAnalysis.matched_claim_ids?.length
                            ? selectedClaim.duplicateAnalysis.matched_claim_ids.join(', ')
                            : 'None'}
                        </p>
                      </div>
                      <div>
                        <h5 className="font-medium mb-2">Candidate Matches</h5>
                        <div className="space-y-2">
                          {(selectedClaim.duplicateAnalysis.candidate_matches || []).map((match) => (
                            <div key={match.claim_id} className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                              <div className="flex items-center justify-between">
                                <span className="font-medium">Claim #{match.claim_id}</span>
                                <span className="text-xs">Score: {match.score}</span>
                              </div>
                              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                                {match.reasons?.join(' ') || 'No reason text provided.'}
                              </p>
                            </div>
                          ))}
                          {(selectedClaim.duplicateAnalysis.candidate_matches || []).length === 0 && (
                            <p className="text-gray-500">No candidate matches returned.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No OCR/duplicate analysis found for this claim.</p>
                  )}
                </div>

                <div className="border rounded-lg p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200">
                  <h4 className="font-bold mb-3 flex items-center">
                    <Shield className="h-5 w-5 mr-2 text-blue-600" />
                    Land Record Verification
                  </h4>
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                       <div>
                         <p className="text-xs text-gray-500 uppercase font-bold">Khasra No</p>
                         <p className="font-mono text-lg">{selectedClaim.khasra_no || 'N/A'}</p>
                       </div>
                       <div>
                         <p className="text-xs text-gray-500 uppercase font-bold">Village/Dist</p>
                         <p>{selectedClaim.village || 'N/A'} / {selectedClaim.district || 'N/A'}</p>
                       </div>
                    </div>
                    
                    {selectedClaim.khasra_no && (
                      <div className="pt-2 flex flex-col space-y-2">
                        <a 
                          href={khasraVerifyData?.portalUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="w-full text-center py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 transition-colors"
                        >
                          Verify on State Portal
                        </a>
                        
                        <label className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded border cursor-pointer">
                          <span className="font-semibold text-gray-700 dark:text-gray-200">Patwari Verified</span>
                          <input 
                            type="checkbox" 
                            checked={!!selectedClaim.patwari_verified}
                            onChange={handleTogglePatwariVerify}
                            disabled={isVerifying}
                            className="h-5 w-5 rounded text-blue-600 focus:ring-blue-500"
                          />
                        </label>
                      </div>
                    )}

                    {/* Conflict Warning */}
                    {claims.some(c => c.id !== selectedClaim.id && c.khasra_no === selectedClaim.khasra_no && c.khasra_no !== null && c.status !== 'rejected') && (
                      <div className="mt-2 p-3 bg-red-100 text-red-800 rounded border border-red-300 flex items-start">
                        <AlertTriangle className="h-5 w-5 mr-2 flex-shrink-0" />
                        <div>
                          <p className="font-bold">Khasra Conflict</p>
                          <p className="text-xs">Another active claim exists for this Khasra number.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Extracted Fields</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    {Object.entries(selectedClaim.extractedFields || {})
                      .filter(([key]) => key !== 'normalized')
                      .map(([key, value]) => (
                        <div key={key} className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">{key.replace(/_/g, ' ')}</p>
                          <p className="text-gray-800 dark:text-gray-100 break-words">
                            {Array.isArray(value) ? value.join(', ') : value || '-'}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">GIS Diagnostics</h4>
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Pipeline Status</p>
                        <p>{selectedClaim.pipelineStatus || 'Pending'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Overall Score</p>
                        <p>{selectedClaim.confidenceScores?.overall_score ?? '-'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">GIS Score</p>
                        <p>{selectedClaim.confidenceScores?.gis_score ?? '-'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Spatial Conflicts</p>
                        <p>{selectedClaim.spatialConflicts?.length || 0}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Claimed Area (ha)</p>
                        <p>{selectedClaim.gisDiagnostics?.claimed_area_ha ?? '-'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Polygon Area (ha)</p>
                        <p>{selectedClaim.gisDiagnostics?.polygon_area_ha ?? '-'}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Area Discrepancy</p>
                        <p>{selectedClaim.gisDiagnostics?.area_discrepancy_ratio ?? '-'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">District Boundary</p>
                        <p>{selectedClaim.gisDiagnostics?.district_boundary_match ?? 'Not checked'}</p>
                      </div>
                    </div>

                    <div>
                      <h5 className="font-medium mb-2">Warnings</h5>
                      {(selectedClaim.gisWarnings || []).length > 0 ? (
                        <ul className="space-y-2">
                          {selectedClaim.gisWarnings.map((warning, index) => (
                            <li key={`${warning}-${index}`} className="bg-amber-50 text-amber-900 rounded p-3">
                              {warning}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-500">No GIS warnings returned.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Review Summary</h4>
                  <div className="space-y-3 text-sm">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Severity</p>
                        <p>{selectedClaim.reviewSummary?.severity || 'pending'}</p>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                        <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Recommendation</p>
                        <p>{selectedClaim.reviewSummary?.recommendation || 'Await pipeline completion before final review.'}</p>
                      </div>
                    </div>
                    <div>
                      <h5 className="font-medium mb-2">Reasons</h5>
                      {(selectedClaim.reviewSummary?.reasons || []).length > 0 ? (
                        <ul className="space-y-2">
                          {selectedClaim.reviewSummary.reasons.map((reason, index) => (
                            <li key={`${reason}-${index}`} className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-gray-500">No additional review reasons were generated.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="border rounded-lg p-4">
                  <h4 className="font-semibold mb-3">Parcel or Land Record Match</h4>
                  {selectedClaim.parcelMatch?.best_match ? (
                    <div className="space-y-3 text-sm">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Reference ID</p>
                          <p>{selectedClaim.parcelMatch.best_match.reference_id || '-'}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Match Confidence</p>
                          <p>{selectedClaim.parcelMatch.best_match.match_confidence ?? '-'}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Source</p>
                          <p>{selectedClaim.parcelMatch.best_match.source_name || '-'}</p>
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                          <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Restricted</p>
                          <p>{selectedClaim.parcelMatch.best_match.is_restricted ? 'Yes' : 'No'}</p>
                        </div>
                      </div>
                      <div>
                        <h5 className="font-medium mb-2">Match Basis</h5>
                        {(selectedClaim.parcelMatch.best_match.match_basis || []).length > 0 ? (
                          <ul className="space-y-2">
                            {selectedClaim.parcelMatch.best_match.match_basis.map((item, index) => (
                              <li key={`${item}-${index}`} className="bg-gray-50 dark:bg-gray-700 rounded p-3">
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-gray-500">No match explanation available.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      {selectedClaim.parcelMatch?.source_available
                        ? 'No parcel or land record match was strong enough to persist.'
                        : 'No local parcel reference dataset is available yet.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="border rounded-lg p-4">
                <h4 className="font-semibold mb-3">OCR Text</h4>
                <pre className="text-xs whitespace-pre-wrap break-words bg-gray-50 dark:bg-gray-700 rounded p-4 max-h-[60vh] overflow-auto">
                  {selectedClaim.ocrText || 'No OCR text available.'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[12000]">
          <div className="bg-white dark:bg-gray-800 dark:text-white p-6 rounded-lg w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add New User</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form className="text-gray-900 dark:text-gray-100" onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const newUser = {
                name: formData.get('name'),
                role: formData.get('role'),
                email: formData.get('email'),
                phone: formData.get('phone'),
                password: formData.get('password'),
                state: formData.get('state'),
                district: formData.get('district'),
                village: formData.get('village'),
                gram_panchayat_id: formData.get('gram_panchayat_id')
              };
              handleAddUser(newUser);
            }}>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Name</label>
                  <input
                    type="text"
                    name="name"
                    required
                    className="w-full border rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Role</label>
                  <select
                    name="role"
                    required
                    className="w-full border rounded-md px-3 py-2"
                  >
                    <option value="">Select Role</option>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="Gram Sabha">Gram Sabha</option>
                    <option value="District Officer">District Officer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Email</label>
                  <input
                    type="email"
                    name="email"
                    required
                    className="w-full border rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Phone</label>
                  <input
                    type="tel"
                    name="phone"
                    required
                    pattern="[0-9]{10,11}"
                    title="Enter 10 or 11 digits"
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="10 or 11 digits"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Password</label>
                  <input
                    type="password"
                    name="password"
                    required
                    minLength="8"
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="Minimum 8 characters"
                  />
                  <p className="text-xs text-gray-500 mt-1">Password must be at least 8 characters.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">State</label>
                  <select
                    name="state"
                    required
                    className="w-full border rounded-md px-3 py-2"
                  >
                    <option value="">Select State</option>
                    <option value="MP">Madhya Pradesh</option>
                    <option value="TR">Tripura</option>
                    <option value="OD">Odisha</option>
                    <option value="TL">Telangana</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">District</label>
                  <input
                    type="text"
                    name="district"
                    required
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="District"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Village</label>
                  <input
                    type="text"
                    name="village"
                    required
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="Village"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Gram Panchayat ID</label>
                  <input
                    type="text"
                    name="gram_panchayat_id"
                    required
                    pattern="[A-Za-z0-9]{10,}"
                    title="Alphanumeric, minimum 10 characters"
                    className="w-full border rounded-md px-3 py-2"
                    placeholder="Alphanumeric, min 10 chars"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center"
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reject Claim Modal */}
      {isRejectModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[12000]">
          <div className="bg-white dark:bg-gray-800 dark:text-white p-6 rounded-lg w-full max-w-[calc(100vw-2rem)] sm:max-w-md mx-4 shadow-lg">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Reject Claim #{rejectClaimId}</h3>
              <button
                onClick={() => setIsRejectModalOpen(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Rejection Reason <span className="text-red-500">*</span></label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Enter the mandatory reason for rejection..."
                  className="w-full border rounded-md px-3 py-2 text-gray-900 focus:ring-red-500 focus:border-red-500"
                  rows={4}
                  required
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => setIsRejectModalOpen(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 focus:outline-none"
              >
                Cancel
              </button>
              <button
                onClick={confirmRejectClaim}
                className="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 flex items-center focus:outline-none"
              >
                Reject Claim
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Admin;
