import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { setLocation } from '../../store/slices/locationSlice';
import geoService from '../../services/geoService';

/**
 * LocationSelector implements a 4-level cascading dropdown for State, District, Tehsil, and Village.
 * It uses Tailwind CSS for a premium look and includes loading states between transitions.
 */
const LocationSelector = () => {
  const dispatch = useDispatch();
  const location = useSelector((state) => state.location);
  
  const [states, setStates] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [tehsils, setTehsils] = useState([]);
  const [villages, setVillages] = useState([]);
  const [loading, setLoading] = useState(false);

  // Initial fetch of supported states
  useEffect(() => {
    const fetchStates = async () => {
      try {
        setLoading(true);
        const data = await geoService.getStates();
        setStates(data);
      } catch (err) {
        console.error('Failed to fetch states:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchStates();
  }, []);

  const handleStateChange = async (e) => {
    const stateCode = e.target.value;
    if (!stateCode) return;
    
    const stateName = states.find(s => s.code === stateCode)?.name;
    dispatch(setLocation({ 
      selectedState: { code: stateCode, name: stateName },
      selectedDistrict: null, 
      selectedTehsil: null, 
      selectedVillage: null,
      villageCode: null 
    }));
    
    setDistricts([]);
    setTehsils([]);
    setVillages([]);
    
    try {
      setLoading(true);
      const data = await geoService.getDistricts(stateCode);
      setDistricts(data);
    } catch (err) {
      console.error('Failed to fetch districts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDistrictChange = async (e) => {
    const districtCode = e.target.value;
    if (!districtCode) return;
    
    const districtName = districts.find(d => d.code === districtCode)?.name;
    dispatch(setLocation({ 
      selectedDistrict: { code: districtCode, name: districtName },
      selectedTehsil: null, 
      selectedVillage: null,
      villageCode: null 
    }));
    
    setTehsils([]);
    setVillages([]);
    
    try {
      setLoading(true);
      const data = await geoService.getTehsils(location.selectedState.code, districtCode);
      setTehsils(data);
    } catch (err) {
      console.error('Failed to fetch tehsils:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleTehsilChange = async (e) => {
    const tehsilCode = e.target.value;
    if (!tehsilCode) return;
    
    const tehsilName = tehsils.find(t => t.code === tehsilCode)?.name;
    dispatch(setLocation({ 
      selectedTehsil: { code: tehsilCode, name: tehsilName },
      selectedVillage: null,
      villageCode: null 
    }));
    
    setVillages([]);
    
    try {
      setLoading(true);
      const data = await geoService.getVillages(
        location.selectedState.code, 
        location.selectedDistrict.code, 
        tehsilCode
      );
      setVillages(data);
    } catch (err) {
      console.error('Failed to fetch villages:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleVillageChange = (e) => {
    const villageCode = e.target.value;
    if (!villageCode) return;
    
    const villageName = villages.find(v => v.code === villageCode)?.name;
    dispatch(setLocation({ 
      selectedVillage: { code: villageCode, name: villageName },
      villageCode 
    }));
  };

  const selectClasses = "block w-full px-4 py-3 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 outline-none hover:border-blue-400";
  const labelClasses = "block mb-2 text-sm font-semibold text-gray-600 tracking-wide uppercase";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 bg-gray-50 p-6 rounded-xl border border-gray-200 shadow-sm relative">
      {loading && (
        <div className="absolute inset-0 bg-white bg-opacity-40 flex items-center justify-center z-10 rounded-xl backdrop-blur-[1px]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* State Selection */}
      <div>
        <label className={labelClasses}>State</label>
        <select 
          className={selectClasses}
          value={location.selectedState?.code || ''}
          onChange={handleStateChange}
          disabled={loading}
        >
          <option value="">Select State</option>
          {states.map(s => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </div>

      {/* District Selection */}
      <div>
        <label className={labelClasses}>District</label>
        <select 
          className={selectClasses}
          value={location.selectedDistrict?.code || ''}
          onChange={handleDistrictChange}
          disabled={!location.selectedState || loading}
        >
          <option value="">Select District</option>
          {districts.map(d => (
            <option key={d.code} value={d.code}>{d.name}</option>
          ))}
        </select>
      </div>

      {/* Tehsil Selection */}
      <div>
        <label className={labelClasses}>Tehsil</label>
        <select 
          className={selectClasses}
          value={location.selectedTehsil?.code || ''}
          onChange={handleTehsilChange}
          disabled={!location.selectedDistrict || loading}
        >
          <option value="">Select Tehsil</option>
          {tehsils.map(t => (
            <option key={t.code} value={t.code}>{t.name}</option>
          ))}
        </select>
      </div>

      {/* Village Selection */}
      <div>
        <label className={labelClasses}>Village</label>
        <select 
          className={selectClasses}
          value={location.villageCode || ''}
          onChange={handleVillageChange}
          disabled={!location.selectedTehsil || loading}
        >
          <option value="">Select Village</option>
          {villages.map(v => (
            <option key={v.code} value={v.code}>{v.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default LocationSelector;
