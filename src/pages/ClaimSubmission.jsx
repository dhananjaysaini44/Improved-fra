import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { MapContainer, TileLayer, FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import { FileText, MapPin, Upload, CheckCircle, ArrowLeft, ArrowRight, Save } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import { submitClaimWithDocs } from '../store/slices/claimsSlice';
import { saveOfflineClaim, syncOfflineClaims } from '../services/offlineSync';
import { useEffect } from 'react';

const ClaimSubmission = () => {
  const [step, setStep] = useState(1);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [polygonData, setPolygonData] = useState(null);
  const { register, handleSubmit, watch, formState: { errors } } = useForm();
  const navigate = useNavigate();
  const dispatch = useDispatch();

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
    if (step !== 4) {
      return;
    }

    const payload = {
      claimantName: data.claimantName,
      village: data.village,
      state: data.state,
      district: data.district,
      polygon: polygonData,
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
    }
  };

  const nextStep = () => {
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Village Name *
                  </label>
                  <input
                    {...register('village', { required: 'Village name is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Enter village name"
                  />
                  {errors.village && (
                    <p className="mt-1 text-sm text-red-600">{errors.village.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gram Panchayat
                  </label>
                  <input
                    {...register('gramPanchayat')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Enter gram panchayat"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State *
                  </label>
                  <select
                    {...register('state', { required: 'State selection is required' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                  >
                    <option value="">Select State</option>
                    <option value="MP">Madhya Pradesh</option>
                    <option value="TR">Tripura</option>
                    <option value="OD">Odisha</option>
                    <option value="TL">Telangana</option>
                  </select>
                  {errors.state && (
                    <p className="mt-1 text-sm text-red-600">{errors.state.message}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    District
                  </label>
                  <input
                    {...register('district')}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                    placeholder="Enter district"
                  />
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

              <div className="h-96 w-full border border-gray-300 rounded-lg overflow-hidden">
                <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '100%', width: '100%' }}>
                  <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  />
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
                </MapContainer>
              </div>

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
              </div>

              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                <div className="text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="mt-4">
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <span className="mt-2 block text-sm font-medium text-gray-900">
                        Upload files
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
                    <div><strong>Name:</strong> {watchedValues.claimantName || 'Not provided'}</div>
                    <div><strong>Village:</strong> {watchedValues.village || 'Not provided'}</div>
                    <div><strong>State:</strong> {watchedValues.state || 'Not provided'}</div>
                    <div><strong>District:</strong> {watchedValues.district || 'Not provided'}</div>
                    <div><strong>Land Area:</strong> {watchedValues.landArea ? `${watchedValues.landArea} ha` : 'Not provided'}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium text-gray-900 dark:text-white">Documents & Area</h4>
                  <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                    <div><strong>Files Uploaded:</strong> {uploadedFiles.length}</div>
                    <div><strong>Area Defined:</strong> {polygonData ? 'Yes' : 'No'}</div>
                    <div><strong>Claim Type:</strong> {watchedValues.claimType || 'Not specified'}</div>
                  </div>
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
                className="flex items-center px-6 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700"
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Submit Claim
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
};

export default ClaimSubmission;
