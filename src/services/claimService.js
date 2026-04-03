import axios from 'axios';
import { API_BASE_URL } from '../config/api';

const safeJsonParse = (value, fallback) => {
  try {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value !== 'string') return value;
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const normalizeClaim = (claim) => {
  const modelResult = safeJsonParse(claim.model_result, null);
  const pipelineResult = safeJsonParse(claim.pipeline_result, null);
  const extractedFields = modelResult?.extracted_fields || null;
  const gisDiagnostics = pipelineResult?.gis || null;
  return {
    ...claim,
    claimId: `FRA-2024-${claim.id.toString().padStart(3, '0')}`,
    claimantName: claim.claimant_name,
    submissionDate: new Date(claim.created_at).toISOString().split('T')[0],
    documents: safeJsonParse(claim.documents, []),
    polygon: safeJsonParse(claim.polygon, []),
    modelResult,
    pipelineResult,
    modelStatus: claim.model_status || null,
    pipelineStatus: claim.pipeline_status || pipelineResult?.pipeline_status || null,
    pipelineError: claim.pipeline_error || pipelineResult?.error || null,
    duplicateAnalysis: modelResult?.duplicate_analysis || null,
    extractedFields,
    gisDiagnostics,
    confidenceScores: pipelineResult?.score || null,
    spatialConflicts: gisDiagnostics?.conflicts || [],
    gisWarnings: gisDiagnostics?.warnings || [],
    parcelMatch: pipelineResult?.parcel || null,
    reviewSummary: safeJsonParse(claim.review_summary, claim.review_summary || null),
    ocrText: modelResult?.ocr_text || '',
  };
};

class ClaimService {
  constructor() {
    this.api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add token to requests if available
    this.api.interceptors.request.use((config) => {
      const token = localStorage.getItem('token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  async getClaims(filters = {}) {
    try {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.state) params.append('state', filters.state);
      if (filters.search) params.append('search', filters.search);
      
      const response = await this.api.get(`/claims?${params.toString()}`);
      return response.data.map(normalizeClaim);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch claims');
    }
  }

  async getClaimById(id) {
    try {
      const response = await this.api.get(`/claims/${id}`);
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Claim not found');
    }
  }

  async createClaim(claimData) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const payload = {
        claimant_name: claimData.claimantName,
        village: claimData.village,
        state: claimData.state,
        district: claimData.district,
        polygon: claimData.polygon || [],
        documents: claimData.files ? claimData.files.map(f => f.name) : [],
        user_id: user.id
      };
      
      const response = await this.api.post('/claims', payload);
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to create claim');
    }
  }

  async createClaimWithDocs(claimData) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const form = new FormData();
      form.append('claimant_name', claimData.claimantName || '');
      form.append('village', claimData.village || '');
      form.append('state', claimData.state || '');
      form.append('district', claimData.district || '');
      form.append('polygon', JSON.stringify(claimData.polygon || []));
      form.append('user_id', user.id || '');
      (claimData.files || []).forEach(f => form.append('documents', f, f.name));

      const response = await this.api.post('/claims/submit', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to submit claim with documents');
    }
  }

  async updateClaim(id, updateData) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const payload = {
        claimant_name: updateData.claimantName,
        village: updateData.village,
        state: updateData.state,
        district: updateData.district,
        status: updateData.status,
        polygon: updateData.polygon || [],
        documents: updateData.documents || [],
        actor_user_id: user.id,
        rejection_reason: updateData.rejection_reason,
      };
      
      const response = await this.api.put(`/claims/${id}`, payload);
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to update claim');
    }
  }

  async approveClaim(id) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const response = await this.api.post(`/claims/${id}/approve`, { actor_user_id: user.id });
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to approve claim');
    }
  }

  async rejectClaim(id, reason) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const response = await this.api.post(`/claims/${id}/reject`, { actor_user_id: user.id, reason });
      return normalizeClaim(response.data);
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to reject claim');
    }
  }

  async deleteClaim(id) {
    try {
      const response = await this.api.delete(`/claims/${id}`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to delete claim');
    }
  }

  async getClaimStats() {
    try {
      const response = await this.api.get('/claims/stats/summary');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch statistics');
    }
  }

  async getClaimTrends() {
    try {
      const response = await this.api.get('/claims/stats/trends');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch trends');
    }
  }

  async getStateDistribution() {
    try {
      const response = await this.api.get('/claims/stats/state-distribution');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch state distribution');
    }
  }

  async getDistrictDistribution() {
    try {
      const response = await this.api.get('/claims/stats/district-distribution');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch district distribution');
    }
  }

  async uploadDocument(file) {
    try {
      const formData = new FormData();
      formData.append('document', file);
      
      const response = await this.api.post('/claims/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to upload document');
    }
  }

  async getDocuments(claimId) {
    try {
      const response = await this.api.get(`/claims/${claimId}/documents`);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to fetch documents');
    }
  }

  async downloadDocument(documentId) {
    try {
      const response = await this.api.get(`/claims/documents/${documentId}/download`, {
        responseType: 'blob'
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.message || 'Failed to download document');
    }
  }
}

export default new ClaimService();
