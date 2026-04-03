import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { MapContainer, TileLayer, FeatureGroup, GeoJSON, useMap, LayersControl } from 'react-leaflet';
const { BaseLayer } = LayersControl;
import { EditControl } from 'react-leaflet-draw';
import { FileText, MapPin, Upload, CheckCircle, ArrowLeft, ArrowRight, Save } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import L from 'leaflet';
import { submitClaimWithDocs } from '../store/slices/claimsSlice';
import { saveOfflineClaim, syncOfflineClaims } from '../services/offlineSync';
import { useEffect } from 'react';
import LocationSelector from '../components/ClaimWizard/LocationSelector';
import KhasraLayer from '../components/Map/KhasraLayer';
import KhasraSelectionPanel from '../components/ClaimWizard/KhasraSelectionPanel';
import geoService from '../services/geoService';
import { useSelector } from 'react-redux';
import { setLocation } from '../store/slices/locationSlice';
import GPSWalkBoundary from '../components/Map/GPSWalkBoundary';

// Internal component to handle map centering
const MapRefocuser = ({ bounds }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
};

const ClaimSubmission = () => {
  const [step, setStep] = useState(1);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [polygonData, setPolygonData] = useState(null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  const watchData = watch();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { selectedState, selectedDistrict, selectedTehsil, selectedVillage, villageCode } = useSelector(state => state.location);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Local state for Khasra selection
  const [selectedKhasra, setSelectedKhasra] = useState(null);
  const [khasraStatus, setKhasraStatus] = useState(null);

  const steps = [
    { id: 1, title: 'Basic Information', icon: FileText },
    { id: 2, title: 'Define Area', icon: MapPin },
    { id: 3, title: 'Upload Documents', icon: Upload },
    { id: 4, title: 'Review & Submit', icon: CheckCircle }
  ];

  // Auto-sync offline claims when network returns
  useEffect(() => {
    const handleOnline = () => {
      syncOfflineClaims(dispatch, submitClaimWithDocs);
    };
    window.addEventListener('online', handleOnline);
    // Attempt sync on mount if online
    if (navigator.onLine) {
      handleOnline();
    }
    return () => window.removeEventListener('online', handleOnline);
  }, [dispatch]);

  const onSubmit = async (data) => {
    // Safety guard: only allow actual submission on the final Review step
    if (step !== 4 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    const payload = {
      claimant_name: data.claimantName,
      village: selectedVillage?.name || '',
      state: selectedState?.name || '',
      district: selectedDistrict?.name || '',
      khasra_no: selectedKhasra?.khasraNo || '',
      khata_no: data.khata_no || selectedKhasra?.khataNo || '',
      village_code: villageCode || '',
      tehsil_code: selectedTehsil?.code || '',
      patwari_name: data.patwari_name || '',
      land_area_hectares: selectedKhasra?.areaHectares || data.landArea || 0,
      polygon: selectedKhasra?.geometry || polygonData || [],
      files: uploadedFiles,
    };

    if (!navigator.onLine) {
      try {
        await saveOfflineClaim(payload);
        alert('You are offline. Claim saved locally. Will sync when online.');
        navigate('/map');
      } catch (e) {
        console.error('Failed to save offline:', e);
        alert('Failed to save claim offline.');
      }
      return;
    }

    try {
      const created = await dispatch(submitClaimWithDocs(payload)).unwrap();
      // Navigate to map focused on this claim
      navigate(`/map?claim=${created.id}`);
    } catch (e) {
      console.error('Failed to submit claim:', e);
      alert(e.message || 'Failed to submit claim');
    } finally {
      setIsSubmitting(false);
    }
  };

  const nextStep = () => {
    if (step === 1 && !villageCode) {
      alert('Please select a state, district, tehsil, and village before proceeding.');
      return;
    }
    if (step === 2 && !selectedKhasra && !polygonData) {
      alert('Please identify the land by selecting a Khasra from the map, performing a GPS walk, or drawing manually.');
      return;
    }
    if (step < 4) setStep(step + 1);
  };

  const prevStep = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    setUploadedFiles(files);
  };

  const handlePolygonCreated = (e) => {
    const layer = e.layer;
    const geoJson = layer.toGeoJSON();
    setPolygonData(geoJson);
    setSelectedKhasra(null); // Clear Khasra if user draws manually
  };

  const handleGPSWalkComplete = (geoJson) => {
    setPolygonData(geoJson);
    setSelectedKhasra(null);
  };

  const handleKhasraSelect = async (plot) => {
    setSelectedKhasra(plot);
    setPolygonData(null); // Clear manual polygon if Khasra selected
    try {
      const status = await geoService.checkKhasra(plot.khasraNo, villageCode);
      setKhasraStatus(status);
    } catch (err) {
      console.error("Status check failed", err);
    }
  };

  const watchedValues = watch();

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">Submit New FRA Claim</h1>
        <p className="text-gray-600 dark:text-gray-300">Complete the form below to submit your Forest Rights Act claim</p>
      </div>

      {/* Progress Indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {steps.map((s, index) => (
            <div key={s.id} className="flex items-center">
              <div className={`flex items-center justify-center w-10 h-10 rounded-full ${
                step >= s.id ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-400'
              }`}>
                <s.icon className="h-5 w-5" />
              </div>
              <span className={`ml-2 text-sm font-medium ${
                step >= s.id ? 'text-green-600' : 'text-gray-400'
              }`}>
                {s.title}
              </span>
              {index < steps.length - 1 && (
                <div className={`w-12 h-0.5 mx-4 ${
                  step > s.id ? 'bg-green-600' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form Content */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <form onSubmit={handleSubmit(onSubmit)}>
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Claimant Name *
                  </label>
                  <input
                    {...register('claimantName', { required: 'Claimant name is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Enter full name"
                  />
                  {errors.claimantName && (
                    <p className="mt-1 text-sm text-red-600">{errors.claimantName.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Father/Husband Name
                  </label>
                  <input
                    {...register('fatherName')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Enter father's or husband's name"
                  />
                </div>

                <div className="col-span-full">
                  <LocationSelector />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Land Area (in hectares)
                  </label>
                  <input
                    {...register('landArea', { pattern: { value: /^\d*\.?\d+$/, message: 'Please enter a valid number' } })}
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="0.00"
                  />
                  {errors.landArea && (
                    <p className="mt-1 text-sm text-red-600">{errors.landArea.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Claim Type
                  </label>
                  <select
                    {...register('claimType')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="">Select Claim Type</option>
                    <option value="individual">Individual Rights</option>
                    <option value="community">Community Rights</option>
                    <option value="forest">Community Forest Resource</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Define Claim Area</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Use the drawing tools to mark the boundaries of your claimed land on the map.
                </p>
              </div>

              <div className="h-96 w-full border border-gray-300 rounded-lg overflow-hidden relative">
                <MapContainer 
                  center={[22.9734, 78.6569]} 
                  zoom={5} 
                  style={{ height: '100%', width: '100%' }}
                >
                  <LayersControl position="topright">
                    <BaseLayer checked name="Streets">
                      <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                    </BaseLayer>
                    <BaseLayer name="Satellite">
                      <TileLayer
                        attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EBP, and the GIS User Community'
                        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                      />
                    </BaseLayer>
                  </LayersControl>

                  {villageCode && (
                    <KhasraLayer 
                      villageCode={villageCode} 
                      stateCode={selectedState?.code}
                      onKhasraSelect={handleKhasraSelect}
                      selectedKhasraNo={selectedKhasra?.khasraNo}
                    />
                  )}
                  <GPSWalkBoundary onComplete={handleGPSWalkComplete} />
                  <FeatureGroup>
                    <EditControl
                      position="topright"
                      onCreated={handlePolygonCreated}
                      draw={{
                        rectangle: true,
                        polygon: true,
                        circle: false,
                        marker: false,
                        polyline: false,
                      }}
                    />
                  </FeatureGroup>
                  {polygonData && (
                    <GeoJSON 
                      data={polygonData} 
                      style={{ color: '#10b981', weight: 3, fillOpacity: 0.3 }}
                      onEachFeature={(feature, layer) => {
                        layer.on('mousemove', (e) => {
                          const { lat, lng } = e.latlng;
                          layer.bindTooltip(`Lat: ${lat.toFixed(6)}<br/>Lng: ${lng.toFixed(6)}`, {
                            sticky: true,
                            className: 'custom-tooltip'
                          }).openTooltip();
                        });
                      }}
                    />
                  )}
                  {polygonData && (
                    <MapRefocuser 
                      bounds={L.geoJSON(polygonData).getBounds()} 
                    />
                  )}
                </MapContainer>
              </div>

              <KhasraSelectionPanel 
                selectedKhasra={selectedKhasra}
                statusInfo={khasraStatus}
                onConfirm={() => nextStep()}
                onReset={() => setSelectedKhasra(null)}
              />

              {polygonData && (
                <div className="bg-green-50 border border-green-200 rounded-md p-4">
                  <div className="flex items-center">
                    <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
                    <span className="text-green-800">Polygon defined successfully</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">Upload Supporting Documents</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4">
                  Upload relevant documents to support your claim (PDF, images, etc.)
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Patwari Name *</label>
                    <input 
                      {...register('patwari_name', { required: 'Patwari name is required' })}
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Enter name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Khata/Khatauni No</label>
                    <input 
                      {...register('khata_no')}
                      className="w-full px-3 py-2 border rounded-md"
                      placeholder="Optional"
                    />
                  </div>
                  <div className="col-span-full">
                    <label className="flex items-center space-x-2 text-sm text-gray-700">
                      <input 
                        type="checkbox" 
                        {...register('verified', { required: 'You must confirm record verification' })}
                        className="rounded text-green-600" 
                      />
                      <span>I confirm this land is correctly identified based on Patwari records.</span>
                    </label>
                    {errors.verified && <p className="text-xs text-red-500 mt-1">{errors.verified.message}</p>}
                  </div>
                </div>
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                <div className="text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <span className="mt-2 block text-sm font-medium text-gray-900">
                        Khasra Nakal / Patwari Copy
                      </span>
                      <input
                        id="file-upload"
                        name="files"
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                        onChange={handleFileUpload}
                        className="sr-only"
                      />
                    </label>
                    <p className="mt-1 text-xs text-gray-500">
                      PDF, JPG, PNG, DOC up to 10MB each
                    </p>
                  </div>
                </div>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">Uploaded Files:</h4>
                  {uploadedFiles.map((file, index) => (
                    <div key={index} className="flex items-center justify-between bg-gray-50 p-3 rounded-md">
                      <div className="flex items-center">
                        <FileText className="h-5 w-5 text-gray-400 mr-2" />
                        <span className="text-sm text-gray-900">{file.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">Review Your Submission</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-6">
                  Please review all the information before submitting your claim.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h4 className="font-medium text-gray-900 dark:text-white">Basic Information</h4>
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <div><strong>Name:</strong> {watchData.claimantName || 'Not provided'}</div>
                    <div><strong>State:</strong> {selectedState?.name || 'Not selected'}</div>
                    <div><strong>District:</strong> {selectedDistrict?.name || 'Not selected'}</div>
                    <div><strong>Tehsil:</strong> {selectedTehsil?.name || 'Not selected'}</div>
                    <div><strong>Village:</strong> {selectedVillage?.name || 'Not selected'}</div>
                    <div><strong>Land Area:</strong> {(selectedKhasra?.areaHectares || watchData.landArea) ? `${selectedKhasra?.areaHectares || watchData.landArea} ha` : 'Not provided'}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-gray-900 dark:text-white">Documents & Area</h4>
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <div><strong>Files Uploaded:</strong> {uploadedFiles.length}</div>
                    <div><strong>Area Defined:</strong> {polygonData || selectedKhasra ? 'Yes' : 'No'}</div>
                    <div><strong>Claim Type:</strong> {watchData.claimType || 'Not specified'}</div>
                  </div>

                  {(polygonData?.geometry?.coordinates[0] || selectedKhasra?.geometry?.coordinates[0]) && (
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h5 className="text-xs font-bold text-blue-700 uppercase mb-2">Mapped Boundary Coordinates</h5>
                      <div className="max-h-32 overflow-y-auto text-[10px] font-mono space-y-1">
                        {(polygonData?.geometry?.coordinates[0] || selectedKhasra?.geometry?.coordinates[0]).map((coord, i) => (
                           <div key={i} className="flex justify-between border-b border-blue-100 last:border-0 pb-1">
                             <span>Pt {i+1}:</span>
                             <span>{coord[1].toFixed(6)}, {coord[0].toFixed(6)}</span>
                           </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <CheckCircle className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div className="ml-3">
                    <h4 className="text-sm font-medium text-yellow-800">
                      Important Notice
                    </h4>
                    <div className="mt-2 text-sm text-yellow-700">
                      <p>
                        By submitting this claim, you certify that all information provided is true and accurate.
                        False claims may result in legal consequences.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={prevStep}
              disabled={step === 1}
              className="flex items-center px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Previous
            </button>

            {step < 4 ? (
              <button
                type="button"
                onClick={nextStep}
                className="flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700"
              >
                Next
                <ArrowRight className="h-4 w-4 ml-2" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex items-center px-6 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Submitting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Submit Claim
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClaimSubmission;
