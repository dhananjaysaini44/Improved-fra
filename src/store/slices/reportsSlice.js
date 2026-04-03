import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  selectedReport: 'claims',
  loading: false,
  error: null,
};

const reportsSlice = createSlice({
  name: 'reports',
  initialState,
  reducers: {
    setSelectedReport: (state, action) => {
      state.selectedReport = action.payload;
    },
    clearReportsError: (state) => {
      state.error = null;
    },
  },
});

export const { setSelectedReport, clearReportsError } = reportsSlice.actions;
export default reportsSlice.reducer;
