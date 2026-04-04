import React, { useState, useEffect } from 'react';
import { GeoJSON, useMap, useMapEvents, WMSTileLayer } from 'react-leaflet';
import L from 'leaflet';
import geoService from '../../services/geoService';

/**
 * KhasraLayer renders cadastral plots as interactive GeoJSON layers.
 * It also intelligently attempts to load state-level WMS layers where available.
 * 
 * Constraints:
 * - Only visible at zoom level >= 14 to maintain performance.
 * - Color codes: Green (Available), Yellow (Pending), Red (Approved), Blue (Selected).
 */
const KhasraLayer = ({ villageCode, stateCode, onKhasraSelect, selectedKhasraNo }) => {
  const map = useMap();
  const [plots, setPlots] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(map.getZoom());
  const [wmsEnabled, setWmsEnabled] = useState(true);

  // Monitor zoom level for performance-based visibility
  useMapEvents({
    zoomend: () => setZoomLevel(map.getZoom())
  });

  useEffect(() => {
    if (!villageCode) {
      setPlots([]);
      return;
    }

    const fetchPlots = async () => {
      try {
        const data = await geoService.getKhasraPlots(villageCode);
        
        // Ensure data is in GeoJSON format. Our backend might return raw rows or full FeatureCollections.
        const geoJsonData = Array.isArray(data) 
          ? { 
              type: 'FeatureCollection', 
              features: data.map(p => ({
                type: 'Feature',
                properties: { ...p },
                geometry: typeof p.polygon === 'string' ? JSON.parse(p.polygon) : p.polygon
              }))
            } 
          : data;

        setPlots(geoJsonData);

        // Auto-center on village if we have features
        if (geoJsonData.features?.length > 0) {
          const bounds = L.geoJSON(geoJsonData).getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
          }
        }
      } catch (err) {
        console.error('Failed to fetch khasra plots:', err);
      }
    };
    fetchPlots();
  }, [villageCode, map]);

  // Determine style based on claim status and selection
  const getStyle = (feature) => {
    const isSelected = selectedKhasraNo === feature.properties.khasra_no;
    const status = feature.properties.status;
    
    const baseStyle = { weight: 1, color: '#FFFFFF', opacity: 0.8 };

    if (isSelected) return { ...baseStyle, fillColor: '#3b82f6', fillOpacity: 0.7, color: '#2563eb', weight: 2 };
    if (status === 'approved') return { ...baseStyle, fillColor: '#ef4444', fillOpacity: 0.6, color: '#b91c1c' };
    if (status === 'pending') return { ...baseStyle, fillColor: '#eab308', fillOpacity: 0.5, color: '#a16207' };
    
    // Default Available (Green)
    return { ...baseStyle, fillColor: '#22c55e', fillOpacity: 0.3, color: '#15803d' };
  };

  const onEachFeature = (feature, layer) => {
    layer.on({
      click: (e) => {
        L.DomEvent.stopPropagation(e);
        onKhasraSelect({
          khasraNo: feature.properties.khasra_no,
          khataNo: feature.properties.khata_no || 'N/A',
          areaHectares: feature.properties.area_hectares,
          geometry: feature.geometry
        });
      }
    });
    layer.bindPopup(`
      <div class="p-1 font-sans">
        <div class="font-bold border-b border-gray-200 mb-1">Plot Details</div>
        <div>Khasra: <b>${feature.properties.khasra_no}</b></div>
        <div>Area: <b>${feature.properties.area_hectares} ha</b></div>
      </div>
    `);
  };

  // State-specific WMS configurations
  const getWmsConfig = () => {
    const sc = (stateCode || '').toUpperCase();
    if (sc === 'MP') return { url: 'https://bhunaksha.mp.gov.in/bhunaksha/wms', layers: 'mp_village_layer' };
    if (sc === 'OR') return { url: 'https://bhunaksha.ori.nic.in/bhunaksha/wms', layers: 'odisha_layer' };
    return null;
  };

  const wmsConfig = getWmsConfig();

  // Rule 5: minZoom 14
  if (zoomLevel < 14) return null;

  return (
    <>
      {/* 1. Offline/Back-end Plot GeoJSON */}
      {plots.features && (
        <GeoJSON 
          key={villageCode} // Force re-render on village change
          data={plots} 
          style={getStyle} 
          onEachFeature={onEachFeature}
        />
      )}

      {/* 2. Optional State-portal WMS Layer Attempt */}
      {wmsEnabled && wmsConfig && (
        <WMSTileLayer
          url={wmsConfig.url}
          layers={wmsConfig.layers}
          format="image/png"
          transparent={true}
          version="1.1.1"
          opacity={0.5}
          eventHandlers={{
            tileerror: () => {
              console.warn('WMS Layer failed to load, falling back to local GeoJSON');
              setWmsEnabled(false);
            }
          }}
        />
      )}
    </>
  );
};

export default KhasraLayer;
