import { useEffect, useMemo, useState, useRef } from 'react';
import { MapContainer, TileLayer, LayersControl, LayerGroup, GeoJSON, CircleMarker, Popup, useMap } from 'react-leaflet';
const { BaseLayer, Overlay } = LayersControl;
import { FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';
import { useLocation } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import L from 'leaflet';
import claimService from '../services/claimService';

// Internal component to capture the map instance in v4
const MapInstanceCapture = ({ setMap }) => {
  const map = useMap();
  useEffect(() => {
    if (map) setMap(map);
  }, [map, setMap]);
  return null;
};

const Map = () => {
  const position = [22.5, 82.5]; // Central India region

  const location = useLocation();
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [map, setMap] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [selectedClaim, setSelectedClaim] = useState(null);
  const [selectedCenter, setSelectedCenter] = useState(null);
  const [showHighlight, setShowHighlight] = useState(false);
  const [paneReady, setPaneReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const data = await claimService.getClaims();
        if (isMounted) setClaims(data);
      } catch (e) {
        if (isMounted) setError(e.message || 'Failed to load claims');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  const filteredClaims = useMemo(() => {
    const q = (search || '').toLowerCase();
    if (!q) return claims;
    return claims.filter(c =>
      (c.village || '').toLowerCase().includes(q) ||
      (c.claimantName || '').toLowerCase().includes(q) ||
      (c.state || '').toLowerCase().includes(q) ||
      (c.district || '').toLowerCase().includes(q)
    );
  }, [claims, search]);

  const suggestions = useMemo(() => {
    const base = search ? filteredClaims : claims;
    return base.slice(0, 10);
  }, [search, filteredClaims, claims]);

  const getClaimBounds = (claim) => {
    try {
      if (!claim?.polygon || (Array.isArray(claim.polygon) && claim.polygon.length === 0)) return null;
      const gj = L.geoJSON(claim.polygon);
      const bounds = gj.getBounds();
      if (bounds && bounds.isValid()) return bounds;
      return null;
    } catch {
      return null;
    }
  };

  const handleSearch = () => {
    if (!map) return;
    const withBounds = filteredClaims
      .map(c => ({ c, b: getClaimBounds(c) }))
      .filter(x => x.b);

    if (withBounds.length === 0) return;
    if (withBounds.length === 1) {
      map.fitBounds(withBounds[0].b, { padding: [20, 20], maxZoom: 12 });
    } else {
      const union = withBounds.reduce((acc, x) => acc ? acc.extend(x.b) : L.latLngBounds(x.b), null);
      if (union) map.fitBounds(union, { padding: [20, 20] });
    }
  };

  useEffect(() => {
    if (!map || claims.length === 0) return;
    const params = new URLSearchParams(location.search);
    const claimId = params.get('claim');
    if (!claimId) return;
    const match = claims.find(c => String(c.id) === String(claimId));
    if (match) {
        selectClaim(match);
        const b = getClaimBounds(match);
        if (b) {
          map.fitBounds(b, { padding: [20, 20], maxZoom: 14 });
        }
    }
  }, [location.search, map, claims]);

  useEffect(() => {
    const onDocMouseDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setShowDropdown(false);
        setHighlightIndex(-1);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    if (!map) { setPaneReady(false); return; }
    if (!map.getPane('selected-claim-pane')) {
      map.createPane('selected-claim-pane');
    }
    const pane = map.getPane('selected-claim-pane');
    if (pane) {
      pane.style.zIndex = 650;
      setPaneReady(true);
    } else {
      setPaneReady(false);
    }
  }, [map]);

  const statusColor = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'approved') return '#10B981';
    if (s === 'rejected') return '#EF4444';
    return '#3B82F6';
  };

  const claimLabel = (c) => `${c.claimantName || 'Unknown'} — ${c.village || '-'}, ${c.district || '-'}, ${c.state || '-'}`;

  const claimSpatialSummary = (claim) => {
    if ((claim?.spatialConflicts || []).length > 0) return `${claim.spatialConflicts.length} conflict(s)`;
    if ((claim?.gisWarnings || []).length > 0) return `${claim.gisWarnings.length} warning(s)`;
    if (claim?.parcelMatch?.best_match?.reference_id) return `parcel ${claim.parcelMatch.best_match.reference_id}`;
    if ((claim?.pipelineStatus || '').toUpperCase().startsWith('SCORED')) return 'GIS checked';
    return 'Pipeline pending';
  };

  const getClaimCenter = (claim) => {
    const b = getClaimBounds(claim);
    if (!b) return null;
    const c = b.getCenter();
    return c ? [c.lat, c.lng] : null;
  };

  const isLatLngArray = (v) => Array.isArray(v) && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;

  const selectedHasValidPolygon = useMemo(() => {
    return selectedClaim ? !!getClaimBounds(selectedClaim) : false;
  }, [selectedClaim]);

  const selectClaim = (claim) => {
    setSelectedClaim(claim);
    setSelectedCenter(getClaimCenter(claim));
    setSearch(claimLabel(claim));
    setShowDropdown(false);
    setHighlightIndex(-1);
    setShowHighlight(!!getClaimBounds(claim));
  };

  const zoomToClaim = (claim) => {
    const b = getClaimBounds(claim);
    if (b && map) {
      map.fitBounds(b, { padding: [20, 20], maxZoom: 14 });
    }
  };

  const zoomSelected = () => {
    if (selectedClaim) {
      zoomToClaim(selectedClaim);
      setShowHighlight(!!getClaimBounds(selectedClaim));
    } else {
      handleSearch();
    }
  };

  return (
    <div className="p-4" style={{ minHeight: '100vh' }}>
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">Interactive WebGIS Map</h1>

      <div className="mb-4 relative z-[9999]" ref={containerRef}>
        <div className="flex">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search claimants, villages, or IDs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); setHighlightIndex(-1); setSelectedClaim(null); setSelectedCenter(null); setShowHighlight(false); }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setShowDropdown(true);
                setHighlightIndex((prev) => Math.min((prev < 0 ? 0 : prev + 1), suggestions.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex((prev) => Math.max(prev - 1, 0));
              } else if (e.key === 'Enter') {
                if (highlightIndex >= 0 && suggestions[highlightIndex]) {
                  e.preventDefault();
                  selectClaim(suggestions[highlightIndex]);
                } else {
                  zoomSelected();
                }
              } else if (e.key === 'Escape') {
                setShowDropdown(false);
                setHighlightIndex(-1);
              }
            }}
            className="border p-2 rounded-l w-full bg-white dark:bg-gray-800 dark:text-white"
          />
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded-r hover:bg-blue-700 font-bold"
            type="button"
            onClick={zoomSelected}
          >
            Search
          </button>
        </div>

        {showDropdown && (
          <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-[10000]">
            {suggestions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Type to search claims</div>
            ) : (
              suggestions.map((c, idx) => (
                <button
                  key={c.id}
                  type="button"
                  className={`w-full text-left px-3 py-2 flex items-center justify-between ${idx === highlightIndex ? 'bg-blue-50 dark:bg-gray-700' : ''}`}
                  onMouseEnter={() => setHighlightIndex(idx)}
                  onMouseLeave={() => setHighlightIndex(-1)}
                  onMouseDown={(e) => { e.preventDefault(); selectClaim(c); }}
                >
                  <span className="text-sm dark:text-white">{claimLabel(c)}</span>
                  <span className="ml-2 text-xs text-gray-500">{c.status || 'pending'}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="mb-2 text-red-600 bg-red-50 p-3 rounded-lg border border-red-200">{error}</div>
      )}

      <div className="h-[600px] w-full rounded-2xl overflow-hidden shadow-2xl border border-gray-200 dark:border-gray-700 relative">
        <MapContainer center={position} zoom={5} style={{ height: '100%', width: '100%' }}>
          <MapInstanceCapture setMap={setMap} />
          <LayersControl position="topright">
            <BaseLayer checked name="OpenStreetMap">
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
            </BaseLayer>
            <BaseLayer name="Satellite">
              <TileLayer
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution='&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
              />
            </BaseLayer>
            <Overlay checked name="Existing Claims">
              <LayerGroup>
                {!loading && filteredClaims.map((claim) => {
                  const bounds = getClaimBounds(claim);
                  if (!claim?.polygon || !bounds) return null;
                  return (
                    <GeoJSON
                      key={claim.id}
                      data={claim.polygon}
                      style={{ color: statusColor(claim.status), weight: 2, fillOpacity: 0.2 }}
                      onEachFeature={(feature, layer) => {
                        const geometry = feature?.geometry;
                        const coords = (geometry?.type === 'Polygon') ? geometry.coordinates[0] : 
                                      (geometry?.type === 'MultiPolygon') ? geometry.coordinates[0][0] : [];
                        
                        const coordList = coords.slice(0, 5).map(c => 
                          `<div style="font-family: monospace;">${c[1].toFixed(5)}, ${c[0].toFixed(5)}</div>`
                        ).join('');
                        
                        layer.bindPopup(
                          `<div style="font-family: sans-serif; gap: 4px; display: flex; flex-direction: column; min-width: 150px;">
                            <div><strong>Claimant:</strong> ${claim.claimantName || '-'} </div>
                            <div><strong>Village:</strong> ${claim.village || '-'} </div>
                            <div style="padding-top: 4px; border-top: 1px solid #eee; margin-top: 4px;">
                               <strong>Main Boundaries:</strong>
                               <div style="font-size: 10px; color: #666; margin-top: 2px;">${coordList}${coords.length > 5 ? '<div>...</div>' : ''}</div>
                            </div>
                            <div style="font-size: 10px; color: #999; margin-top: 4px;">ID: ${claim.id}</div>
                            <div><strong>Status:</strong> ${claim.status || 'pending'} </div>
                            <div><strong>ID:</strong> ${claim.id}</div>
                            <div><strong>Spatial:</strong> ${claimSpatialSummary(claim)}</div>
                          </div>`
                        );
                        layer.on('mousemove', (e) => {
                          const { lat, lng } = e.latlng;
                          layer.bindTooltip(`Lat: ${lat.toFixed(6)}<br/>Lng: ${lng.toFixed(6)}`, {
                            sticky: true,
                            className: 'custom-tooltip'
                          }).openTooltip();
                        });
                      }}
                    />
                  );
                })}
              </LayerGroup>
            </Overlay>
          </LayersControl>

          {showHighlight && paneReady && selectedHasValidPolygon && (
            <GeoJSON
              data={selectedClaim.polygon}
              pane="selected-claim-pane"
              style={{ color: '#2563EB', weight: 4, fillOpacity: 0.4 }}
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

          {paneReady && isLatLngArray(selectedCenter) && (
            <CircleMarker
              center={selectedCenter}
              pane="selected-claim-pane"
              pathOptions={{ color: '#2563EB', weight: 2, fillColor: '#3B82F6', fillOpacity: 0.7 }}
              radius={8}
            >
              <Popup>
                <div style={{ gap: '4px', display: 'flex', flexDirection: 'column' }}>
                  <div><strong>Selected Claim</strong></div>
                  <div>{(selectedClaim?.claimantName || 'Unknown')} — {(selectedClaim?.village || '-')}, {(selectedClaim?.district || '-')}, {(selectedClaim?.state || '-')}</div>
                  <div>ID: {selectedClaim?.id}</div>
                  <div>Spatial: {claimSpatialSummary(selectedClaim)}</div>
                </div>
              </Popup>
            </CircleMarker>
          )}

          <FeatureGroup>
            <EditControl
              position='topleft'
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
    </div>
  );
};

export default Map;
