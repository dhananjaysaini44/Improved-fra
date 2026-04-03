import axios from 'axios';

// The base URL defaults to /api due to Vite proxy setup
const API_URL = '/api/geo';

const geoService = {
  /**
   * Fetches all supported states from the hierarchy.
   */
  getStates: async () => {
    const response = await axios.get(`${API_URL}/states`);
    return response.data;
  },

  /**
   * Fetches districts for a given state code.
   */
  getDistricts: async (stateCode) => {
    const response = await axios.get(`${API_URL}/districts/${stateCode}`);
    return response.data;
  },

  /**
   * Fetches tehsils for a state and district.
   */
  getTehsils: async (stateCode, districtCode) => {
    const response = await axios.get(`${API_URL}/tehsils/${stateCode}/${districtCode}`);
    return response.data;
  },

  /**
   * Fetches villages for a tehsil within a state and district.
   */
  getVillages: async (stateCode, districtCode, tehsilCode) => {
    const response = await axios.get(`${API_URL}/villages/${stateCode}/${districtCode}/${tehsilCode}`);
    return response.data;
  },

  /**
   * Fetches khasra plots for a specific village.
   */
  getKhasraPlots: async (villageCode) => {
    const response = await axios.get(`${API_URL}/khasra/${villageCode}`);
    return response.data;
  },

  /**
   * Checks if a specific khasra in a village is available for claim.
   */
  checkKhasra: async (khasra_no, village_code) => {
    const response = await axios.post(`${API_URL}/khasra/check`, { khasra_no, village_code });
    return response.data;
  }
};

export default geoService;
