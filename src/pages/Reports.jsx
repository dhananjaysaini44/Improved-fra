import { useState, useEffect, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line
} from 'recharts';
import { jsPDF } from 'jspdf';
import {
  FileText, BarChart2, PieChart as PieIcon, TrendingUp, Download,
  RefreshCw, AlertTriangle, CheckCircle, Clock, XCircle
} from 'lucide-react';
import { setSelectedReport } from '../store/slices/reportsSlice';
import claimService from '../services/claimService';

// ─── Colour palette ──────────────────────────────────────────────────────────
const STATUS_COLORS = {
  pending:  '#F59E0B',
  approved: '#10B981',
  rejected: '#EF4444',
};

const PIE_COLORS = [
  '#6366F1','#10B981','#F59E0B','#EF4444','#3B82F6',
  '#EC4899','#14B8A6','#8B5CF6','#F97316','#06B6D4',
];

// ─── Small helpers ────────────────────────────────────────────────────────────
const downloadCSV = (headers, rows, filename) => {
  const lines = [headers.join(','), ...rows.map(r => r.join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
};

const downloadPDF = (title, headers, rows) => {
  const doc = new jsPDF();
  doc.setFontSize(18);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

  // simple table
  let y = 40;
  const colW = Math.min(180 / headers.length, 45);
  doc.setFillColor(99, 102, 241);
  doc.setTextColor(255, 255, 255);
  doc.rect(14, y - 5, 180, 8, 'F');
  headers.forEach((h, i) => doc.text(String(h), 16 + i * colW, y));
  doc.setTextColor(0, 0, 0);
  y += 8;

  rows.forEach((row, ri) => {
    if (y > 270) { doc.addPage(); y = 20; }
    if (ri % 2 === 0) {
      doc.setFillColor(240, 240, 255);
      doc.rect(14, y - 5, 180, 7, 'F');
    }
    row.forEach((cell, i) => doc.text(String(cell ?? ''), 16 + i * colW, y));
    y += 8;
  });

  doc.save(`${title.replace(/\s+/g, '_').toLowerCase()}.pdf`);
};

// ─── Chart definitions ────────────────────────────────────────────────────────
const REPORT_TYPES = [
  { value: 'claims',   label: 'Monthly Trends',     icon: TrendingUp },
  { value: 'status',   label: 'Status Breakdown',   icon: PieIcon    },
  { value: 'state',    label: 'By State',           icon: BarChart2  },
  { value: 'district', label: 'By District',        icon: FileText   },
];

// ─── Custom tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-sm">
      {label && <p className="font-semibold text-gray-700 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }} className="flex items-center gap-1">
          <span className="font-medium">{p.name}:</span> {p.value}
        </p>
      ))}
    </div>
  );
};

// ─── KPI card ─────────────────────────────────────────────────────────────────
const KpiCard = ({ icon: Icon, label, value, color, bg }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4 shadow-sm">
    <div className={`p-3 rounded-xl ${bg}`}>
      <Icon className={`h-6 w-6 ${color}`} />
    </div>
    <div>
      <p className="text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  </div>
);

// ─── Main component ───────────────────────────────────────────────────────────
const Reports = () => {
  const dispatch = useDispatch();
  const { selectedReport } = useSelector((state) => state.reports);

  const [loading, setLoading]       = useState(true);
  const [error,   setError]         = useState(null);
  const [trends,  setTrends]        = useState([]);
  const [summary, setSummary]       = useState({ total: 0, pending: 0, approved: 0, rejected: 0 });
  const [stateData,    setStateData]    = useState([]);
  const [districtData, setDistrictData] = useState([]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, s, st, d] = await Promise.all([
        claimService.getClaimTrends(),
        claimService.getClaimStats(),
        claimService.getStateDistribution(),
        claimService.getDistrictDistribution(),
      ]);
      // Enrich monthly trends with rejected = total - approved
      const enriched = (t || []).map(row => ({
        ...row,
        rejected: Math.max(0, (row.claims || 0) - (row.approved || 0)),
      }));
      setTrends(enriched);
      setSummary(s || { total: 0, pending: 0, approved: 0, rejected: 0 });
      setStateData((st || []).map((item, i) => ({ ...item, color: item.color || PIE_COLORS[i % PIE_COLORS.length] })));
      setDistrictData(d || []);
    } catch (err) {
      setError(err.message || 'Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Export helpers ──────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    switch (selectedReport) {
      case 'claims':
        downloadCSV(['Month', 'Total Claims', 'Approved', 'Rejected'],
          trends.map(r => [r.month, r.claims, r.approved, r.rejected]),
          'monthly_trends.csv');
        break;
      case 'status':
        downloadCSV(['Status', 'Count'],
          [['Pending', summary.pending], ['Approved', summary.approved], ['Rejected', summary.rejected]],
          'status_breakdown.csv');
        break;
      case 'state':
        downloadCSV(['State', 'Claims'],
          stateData.map(r => [r.name, r.value]),
          'claims_by_state.csv');
        break;
      case 'district':
        downloadCSV(['District', 'Total', 'Approved', 'Rejected', 'Pending'],
          districtData.map(r => [r.name, r.value, r.approved, r.rejected, r.pending]),
          'claims_by_district.csv');
        break;
    }
  };

  const handleExportPDF = () => {
    switch (selectedReport) {
      case 'claims':
        downloadPDF('Monthly Claim Trends',
          ['Month', 'Total', 'Approved', 'Rejected'],
          trends.map(r => [r.month, r.claims, r.approved, r.rejected]));
        break;
      case 'status':
        downloadPDF('Status Breakdown',
          ['Status', 'Count'],
          [['Pending', summary.pending], ['Approved', summary.approved], ['Rejected', summary.rejected]]);
        break;
      case 'state':
        downloadPDF('Claims By State',
          ['State', 'Claims'],
          stateData.map(r => [r.name, r.value]));
        break;
      case 'district':
        downloadPDF('Claims By District',
          ['District', 'Total', 'Approved', 'Rejected', 'Pending'],
          districtData.map(r => [r.name, r.value, r.approved, r.rejected, r.pending]));
        break;
    }
  };

  // ── Status-breakdown donut data ─────────────────────────────────────────────
  const statusDonut = [
    { name: 'Pending',  value: summary.pending  || 0, color: STATUS_COLORS.pending  },
    { name: 'Approved', value: summary.approved || 0, color: STATUS_COLORS.approved },
    { name: 'Rejected', value: summary.rejected || 0, color: STATUS_COLORS.rejected },
  ].filter(d => d.value > 0);

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <div className="animate-spin rounded-full h-14 w-14 border-4 border-indigo-200 border-t-indigo-600" />
        <p className="text-gray-500 text-sm">Loading report data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4 text-center">
        <AlertTriangle className="h-14 w-14 text-red-400" />
        <p className="text-red-600 font-semibold">{error}</p>
        <button
          onClick={fetchAll}
          className="px-5 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" /> Retry
        </button>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Reports</h1>
          <p className="text-gray-500 text-sm mt-1">Live analytics based on submitted claims</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAll}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4 text-gray-500" />
          </button>
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium transition-colors"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-medium transition-colors"
          >
            <Download className="h-4 w-4" /> Export PDF
          </button>
        </div>
      </div>

      {/* ── Summary KPIs ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={FileText}    label="Total Claims"    value={summary.total    || 0} color="text-indigo-600" bg="bg-indigo-50" />
        <KpiCard icon={Clock}       label="Pending"         value={summary.pending  || 0} color="text-amber-600"  bg="bg-amber-50" />
        <KpiCard icon={CheckCircle} label="Approved"        value={summary.approved || 0} color="text-emerald-600" bg="bg-emerald-50" />
        <KpiCard icon={XCircle}     label="Rejected"        value={summary.rejected || 0} color="text-red-600"   bg="bg-red-50" />
      </div>

      {/* ── Report type tabs ── */}
      <div className="flex flex-wrap gap-2">
        {REPORT_TYPES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => dispatch(setSelectedReport(value))}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
              selectedReport === value
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Chart panel ── */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">

        {/* ──── Monthly Trends ──── */}
        {selectedReport === 'claims' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Monthly Claim Trends</h2>
            {trends.length === 0 ? (
              <EmptyState message="No claim data available yet." />
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={trends} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis dataKey="month" tick={{ fill: '#6B7280', fontSize: 12 }} />
                  <YAxis tick={{ fill: '#6B7280', fontSize: 12 }} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="claims"   name="Total"    fill="#6366F1" radius={[4,4,0,0]} />
                  <Bar dataKey="approved" name="Approved" fill="#10B981" radius={[4,4,0,0]} />
                  <Bar dataKey="rejected" name="Rejected" fill="#EF4444" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </>
        )}

        {/* ──── Status Breakdown ──── */}
        {selectedReport === 'status' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Status Breakdown</h2>
            {statusDonut.length === 0 ? (
              <EmptyState message="No claims have been submitted yet." />
            ) : (
              <div className="flex flex-col md:flex-row items-center gap-8">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={statusDonut}
                      cx="50%"
                      cy="50%"
                      innerRadius={70}
                      outerRadius={120}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {statusDonut.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col gap-4 min-w-[180px]">
                  {[
                    { label: 'Pending',  value: summary.pending,  color: STATUS_COLORS.pending },
                    { label: 'Approved', value: summary.approved, color: STATUS_COLORS.approved },
                    { label: 'Rejected', value: summary.rejected, color: STATUS_COLORS.rejected },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }} />
                      <span className="text-sm text-gray-600 flex-1">{label}</span>
                      <span className="font-bold text-gray-900">{value || 0}</span>
                      <span className="text-xs text-gray-400">
                        ({summary.total ? Math.round(((value || 0) / summary.total) * 100) : 0}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ──── By State ──── */}
        {selectedReport === 'state' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Claims by State</h2>
            {stateData.length === 0 ? (
              <EmptyState message="No claims with state data found." />
            ) : (
              <div className="flex flex-col lg:flex-row items-center gap-8">
                <div className="w-full lg:w-1/2">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie
                        data={stateData}
                        cx="50%"
                        cy="50%"
                        outerRadius={110}
                        dataKey="value"
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={true}
                      >
                        {stateData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="w-full lg:w-1/2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-2 text-gray-500 font-medium">State</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Claims</th>
                        <th className="text-right py-2 text-gray-500 font-medium">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stateData.map((row, i) => (
                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ background: row.color }} />
                            {row.name}
                          </td>
                          <td className="py-2 text-right font-semibold">{row.value}</td>
                          <td className="py-2 text-right text-gray-500">
                            {summary.total ? Math.round((row.value / summary.total) * 100) : 0}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ──── By District ──── */}
        {selectedReport === 'district' && (
          <>
            <h2 className="text-lg font-semibold text-gray-900 mb-6">Claims by District (Top 15)</h2>
            {districtData.length === 0 ? (
              <EmptyState message="No claims with district data found." />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(300, districtData.length * 40)}>
                <BarChart
                  data={districtData}
                  layout="vertical"
                  margin={{ left: 20, right: 30 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#6B7280', fontSize: 12 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#374151', fontSize: 12 }} width={110} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="approved" name="Approved" fill="#10B981" stackId="a" radius={[0,0,0,0]} />
                  <Bar dataKey="pending"  name="Pending"  fill="#F59E0B" stackId="a" />
                  <Bar dataKey="rejected" name="Rejected" fill="#EF4444" stackId="a" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ── Empty state ────────────────────────────────────────────────────────────────
const EmptyState = ({ message }) => (
  <div className="flex flex-col items-center justify-center py-20 text-center gap-4 text-gray-400">
    <BarChart2 className="h-16 w-16 opacity-30" />
    <p className="text-base">{message}</p>
    <p className="text-sm">Submit claims to start seeing analytics here.</p>
  </div>
);

export default Reports;
