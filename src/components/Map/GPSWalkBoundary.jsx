import React, { useState, useEffect } from 'react';
import { Polyline, Marker, Circle, Tooltip, useMap } from 'react-leaflet';
import { Play, Square, Trash2, MapPin, SignalHigh, CheckCircle } from 'lucide-react';
import L from 'leaflet';

// Simple calculation for area using the Shoelace Formula
const calculateArea = (coords) => {
    if (coords.length < 3) return 0;
    let area = 0;
    const n = coords.length;
    for (let i = 0; i < n; i++) {
        let j = (i + 1) % n;
        const x1 = coords[i][1] * 111320 * Math.cos(coords[i][0] * Math.PI / 180);
        const y1 = coords[i][0] * 111320;
        const x2 = coords[j][1] * 111320 * Math.cos(coords[j][0] * Math.PI / 180);
        const y2 = coords[j][0] * 111320;
        area += (x1 * y2) - (x2 * y1);
    }
    return Math.abs(area / 2) / 10000; // in Hectares
};

const GPSWalkBoundary = ({ onComplete }) => {
    const map = useMap();
    const [isWalking, setIsWalking] = useState(false);
    const [waypoints, setWaypoints] = useState([]);
    const [watchId, setWatchId] = useState(null);
    const [lastLoc, setLastLoc] = useState(null);
    const [accuracy, setAccuracy] = useState(null);
    const [justAdded, setJustAdded] = useState(false);

    // Initial GPS setup on mount
    useEffect(() => {
        if (!navigator.geolocation) return;

        const id = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy: currentAccuracy } = position.coords;
                setAccuracy(currentAccuracy);
                const newLoc = [latitude, longitude];
                setLastLoc(newLoc);
                
                // Fly to initial lock
                if (currentAccuracy < 30 && !lastLoc) {
                    map.flyTo(newLoc, 18);
                }
            },
            (error) => console.error("GPS Error:", error),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
        setWatchId(id);

        return () => {
            if (id) navigator.geolocation.clearWatch(id);
        };
    }, []);

    const startWalking = () => {
        setIsWalking(true);
    };

    const addCorner = () => {
        if (!lastLoc) {
            alert("Waiting for GPS lock... Move slightly or check location permissions.");
            return;
        }
        if (accuracy > 20) {
            if (!window.confirm(`Accuracy is low (±${Math.round(accuracy)}m). Add this corner anyway?`)) return;
        }
        setWaypoints(prev => [...prev, lastLoc]);
        setJustAdded(true);
        setTimeout(() => setJustAdded(false), 1000);
    };

    // Record waypoint every 3 seconds if walking
    useEffect(() => {
        let interval;
        if (isWalking && lastLoc) {
            interval = setInterval(() => {
                setWaypoints(prev => {
                    if (accuracy > 20) return prev;
                    if (prev.length === 0 || 
                        prev[prev.length - 1][0] !== lastLoc[0] || 
                        prev[prev.length - 1][1] !== lastLoc[1]) {
                        return [...prev, lastLoc];
                    }
                    return prev;
                });
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [isWalking, lastLoc, accuracy]);

    const stopWalking = () => {
        setIsWalking(false);

        if (waypoints.length >= 3) {
            const closedWaypoints = [...waypoints, waypoints[0]];
            const area = calculateArea(closedWaypoints);
            
            const geoJson = {
                type: 'Feature',
                properties: {
                    source: 'GPS_WALK',
                    area_hectares: area,
                    vertices: closedWaypoints
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [closedWaypoints.map(w => [w[1], w[0]])]
                }
            };
            
            onComplete(geoJson);
        } else {
            alert("Boundary requires at least 3 points. Keep walking or add more corners.");
        }
    };

    const clearBoundary = () => {
        setWaypoints([]);
        setIsWalking(false);
    };

    return (
        <div className="absolute top-20 left-4 z-[1000] flex flex-col gap-2">
            <div className="flex flex-col gap-2 bg-white/95 backdrop-blur-sm p-3 rounded-2xl shadow-2xl border border-gray-100 min-w-[240px]">
                <div className="flex items-center justify-between mb-2 px-1">
                    <div className="flex items-center gap-2">
                        <SignalHigh className={`w-4 h-4 ${accuracy < 20 ? 'text-green-500' : 'text-orange-500 animate-pulse'}`} />
                        <span className="text-xs font-bold text-gray-700">GPS Signal</span>
                    </div>
                    {accuracy && (
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${accuracy < 20 ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            ±{Math.round(accuracy)}m
                        </span>
                    )}
                </div>

                {lastLoc && (
                    <div className="bg-gray-100/50 p-2 rounded-lg mb-2 text-[10px] font-mono text-gray-600 flex justify-around border border-gray-100">
                        <div className="flex flex-col items-center">
                            <span className="uppercase text-[8px] text-gray-400 font-sans font-bold">Lat</span>
                            <span>{lastLoc[0].toFixed(6)}</span>
                        </div>
                        <div className="w-px h-6 bg-gray-200"></div>
                        <div className="flex flex-col items-center">
                            <span className="uppercase text-[8px] text-gray-400 font-sans font-bold">Lng</span>
                            <span>{lastLoc[1].toFixed(6)}</span>
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    {!isWalking ? (
                        <button
                            onClick={startWalking}
                            type="button"
                            className="w-full flex items-center justify-center bg-blue-600 text-white px-4 py-2.5 rounded-xl shadow-md hover:bg-blue-700 transition-all font-bold text-sm"
                        >
                            <Play className="w-4 h-4 mr-2" />
                            Start Tracking Walk
                        </button>
                    ) : (
                        <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-xl text-center text-xs font-bold animate-pulse flex items-center justify-center">
                             <SignalHigh className="w-3 h-3 mr-2" /> Mapping Continuous Walk...
                        </div>
                    )}

                    <button
                        onClick={addCorner}
                        type="button"
                        className={`w-full flex items-center justify-center px-4 py-2.5 rounded-xl shadow-md transition-all font-bold text-sm ${
                            justAdded ? 'bg-green-500 text-white' : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                    >
                        {justAdded ? <CheckCircle className="w-4 h-4 mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
                        {justAdded ? 'Corner Saved!' : 'Add Corner (Pin)'}
                    </button>

                    {(isWalking || waypoints.length > 0) && (
                        <button
                            onClick={stopWalking}
                            type="button"
                            className="w-full flex items-center justify-center bg-gray-900 text-white px-4 py-2.5 rounded-xl shadow-md hover:bg-black transition-all font-bold text-sm mt-1"
                        >
                            <Square className="w-4 h-4 mr-2" />
                            Finish & Record 
                        </button>
                    )}
                </div>

                {waypoints.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-gray-100 flex flex-col gap-1">
                        <div className="flex items-center justify-between px-1 text-xs">
                            <span className="text-gray-500">Nodes Captured:</span>
                            <span className="font-bold text-gray-800">{waypoints.length}</span>
                        </div>
                        {waypoints.length >= 3 && (
                            <div className="flex items-center justify-between px-1 text-xs text-blue-600 font-bold bg-blue-50 rounded-lg p-1.5 border border-blue-100">
                                <span>Area:</span>
                                <span>{calculateArea(waypoints).toFixed(4)} ha</span>
                            </div>
                        )}
                        <button
                            onClick={clearBoundary}
                            type="button"
                            className="flex items-center justify-center bg-gray-50 text-gray-400 px-4 py-1.5 rounded-lg hover:bg-red-50 hover:text-red-500 transition-all text-[10px] font-bold"
                        >
                            <Trash2 className="w-3 h-3 mr-2" />
                            Reset
                        </button>
                    </div>
                )}
            </div>

            {/* Visual Feedback on Map */}
            {waypoints.length > 0 && (
                <Polyline 
                    positions={waypoints} 
                    color="#3b82f6" 
                    weight={4} 
                    dashArray="10, 10" 
                    eventHandlers={{
                        mousemove: (e) => {
                            const { lat, lng } = e.latlng;
                            e.target.bindTooltip(`Captured Pt<br/>Lat: ${lat.toFixed(6)}<br/>Lng: ${lng.toFixed(6)}`, {
                                sticky: true,
                                className: 'custom-tooltip'
                            }).openTooltip();
                        }
                    }}
                />
            )}
            {lastLoc && (
                <>
                    <Marker 
                        position={lastLoc} 
                        icon={L.divIcon({
                            className: 'bg-blue-500 w-4 h-4 rounded-full border-2 border-white shadow-lg ring-4 ring-blue-500/30'
                        })}
                    />
                    {accuracy && (
                        <Circle 
                            center={lastLoc} 
                            radius={accuracy} 
                            pathOptions={{ 
                                fillColor: accuracy < 20 ? '#10b981' : '#f59e0b',
                                fillOpacity: 0.1,
                                color: accuracy < 20 ? '#10b981' : '#f59e0b',
                                weight: 1
                            }} 
                        />
                    )}
                </>
            )}
        </div>
    );
};

export default GPSWalkBoundary;
