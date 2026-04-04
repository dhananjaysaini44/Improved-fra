import React from 'react';

/**
 * KhasraSelectionPanel displays details of the selected plot from the map.
 * It provides clear visual feedback on plot availability and facilitates confirmation or reset action.
 * 
 * Props:
 * - selectedKhasra: { khasraNo, khataNo, areaHectares, geometry }
 * - statusInfo: { available, existingClaimId } 
 * - onConfirm: Function to submit selection to form state.
 * - onReset: Function to clear current map selection.
 */
const KhasraSelectionPanel = ({ selectedKhasra, statusInfo, onConfirm, onReset }) => {
  if (!selectedKhasra) return null;

  const isAvailable = statusInfo?.available;

  return (
    <div className={`mt-6 p-6 rounded-2xl border-2 shadow-xl transition-all duration-300 ${
      isAvailable ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
    }`}>
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200 border-opacity-50">
        <div className="flex items-center space-x-3">
          <div className={`w-4 h-4 rounded-full animate-pulse ${
            isAvailable ? 'bg-green-600' : 'bg-red-600'
          }`}></div>
          <h3 className="text-2xl font-black text-gray-800 tracking-tight">
            Khasra No: <span className="text-blue-600">{selectedKhasra.khasraNo}</span>
          </h3>
        </div>
        <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-sm ${
          isAvailable ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {isAvailable ? '✅ Available' : '⚠️ Conflict'}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm transition-transform hover:scale-[1.02]">
          <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-1">Khata Number</p>
          <p className="text-xl font-black text-gray-700">{selectedKhasra.khataNo}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm transition-transform hover:scale-[1.02]">
          <p className="text-[10px] text-gray-400 uppercase font-black tracking-widest mb-1">Area (Hectares)</p>
          <p className="text-xl font-black text-gray-700">{selectedKhasra.areaHectares} ha</p>
        </div>
      </div>

      {isAvailable ? (
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-4">
          <button 
            onClick={onConfirm}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-4 px-8 rounded-2xl shadow-lg transform active:scale-95 transition-all ring-offset-2 ring-green-500 focus:ring-4"
          >
            Confirm This Plot
          </button>
          <button 
            onClick={onReset}
            className="px-8 py-4 bg-white border-2 border-gray-200 text-gray-500 font-black rounded-2xl hover:bg-gray-50 hover:border-gray-300 transition-all active:scale-95"
          >
            Reset
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-white bg-opacity-60 border-l-4 border-red-600 rounded-lg text-sm text-red-900 font-bold shadow-sm">
            This land was already claimed in 
            <span className="bg-red-100 px-2 py-0.5 rounded mx-1 italic underline decoration-red-400">
              Claim ID: #{statusInfo?.existingClaimId || 'N/A'}
            </span>. 
            You must choose another plot or start a GPS walk.
          </div>
          <div className="flex space-x-4">
            <button 
              onClick={onReset}
              className="flex-1 px-8 py-4 bg-white border-2 border-red-200 text-red-600 font-black rounded-2xl hover:bg-red-100 transition-all active:scale-95 shadow-sm"
            >
              Select Different Plot
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default KhasraSelectionPanel;
