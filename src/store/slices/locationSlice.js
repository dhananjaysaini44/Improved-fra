import { createSlice } from '@reduxjs/toolkit';

/**
 * Location Slice for Khasra-based cascading selection.
 * Stores the current hierarchical path and the unique village code.
 */
const initialState = {
  selectedState: null, // { code, name }
  selectedDistrict: null,
  selectedTehsil: null,
  selectedVillage: null,
  villageCode: null,
};

const locationSlice = createSlice({
  name: 'location',
  initialState,
  reducers: {
    /**
     * setLocation updates the current selection.
     * Expects Partial<LocationState> to merge into current state.
     */
    setLocation: (state, action) => {
      return { ...state, ...action.payload };
    },
    /**
     * Resets the entire location state to default.
     */
    resetLocation: () => initialState,
  },
});

export const { setLocation, resetLocation } = locationSlice.actions;
export default locationSlice.reducer;
