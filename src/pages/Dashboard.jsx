import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { FileText, CheckCircle, AlertTriangle, TrendingUp, Users, MapPin, Calendar, ArrowUpRight, ArrowDownRight, Eye } from 'lucide-react';
import { CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis } from 'recharts';
import { MapContainer, TileLayer, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import claimService from '../services/claimService';
import alertsService from '../services/alertsService';
import logService from '../services/logService';

const Dashboard = () => {
  const navigate = useNavigate();
  const { user } = useSelector((state) => state.auth);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Dynamic data states
  const [kpiData, setKpiData] = useState([]);
  const [monthlyData, setMonthlyData] = useState([]);
  const [stateData, setStateData] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [claimLocations, setClaimLocations] = useState([]);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        // 1. Fetch KPI Stats
        const stats = await claimService.getClaimStats() || { total: 0, pending: 0, approved: 0, rejected: 0 };
        const activeAlerts = await alertsService.getAlerts({ status: 'active' }) || [];
        
        const kpis = [
          { title: 'Total Claims', value: (stats.total || 0).toLocaleString(), change: '+0%', trend: 'up', icon: FileText, color: 'text-blue-600', bgColor: 'bg-blue-50' },
          { title: 'Approved Claims', value: (stats.approved || 0).toLocaleString(), change: '+0%', trend: 'up', icon: CheckCircle, color: 'text-green-600', bgColor: 'bg-green-50' },
          { title: 'Pending Review', value: (stats.pending || 0).toLocaleString(), change: '+0%', trend: 'down', icon: Users, color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
          { title: 'Active Alerts', value: (activeAlerts.length || 0).toLocaleString(), change: '+0%', trend: 'up', icon: AlertTriangle, color: 'text-red-600', bgColor: 'bg-red-50' }
        ];
        setKpiData(kpis);

        // 2. Fetch Monthly Trends
        const trends = await claimService.getClaimTrends() || [];
        setMonthlyData(trends.length > 0 ? trends : []);

        // 3. Fetch State Distribution
        const distribution = await claimService.getStateDistribution() || [];
        setStateData(distribution.length > 0 ? distribution : []);

        // 4. Fetch Recent Activity (Logs for Admin, fallback for User)
        try {
          if (user?.role === 'admin') {
            const logs = await logService.getRecentLogs(5) || [];
            const activities = (Array.isArray(logs) ? logs : []).map(log => ({
              id: log.id,
              action: (log.action || 'Unknown').replace(/_/g, ' '),
              user: log.user_name || 'System',
              time: log.created_at ? new Date(log.created_at).toLocaleString() : 'Recently',
              type: (log.action || '').includes('claim') ? 'claim' : (log.action || '').includes('approve') ? 'approval' : 'report'
            }));
            setRecentActivity(activities);
          } else {
            // Non-admin: show recent claims
            const claims = await claimService.getClaims({ limit: 5 }) || [];
            const activities = (Array.isArray(claims) ? claims : []).map(c => ({
              id: c.id,
              action: `New claim: ${c.claimantName || 'Unknown'}`,
              user: c.village || 'Unknown',
              time: c.created_at ? new Date(c.created_at).toLocaleString() : 'Recently',
              type: 'claim'
            }));
            setRecentActivity(activities);
          }
        } catch (logErr) {
          console.warn('Could not fetch logs', logErr);
          setRecentActivity([]);
        }

        // 5. Fetch Map Locations
        const allClaims = await claimService.getClaims() || [];
        const locations = (Array.isArray(allClaims) ? allClaims : [])
          .filter(c => c.polygon && Array.isArray(c.polygon) && c.polygon.length > 0)
          .map(c => ({
            id: c.id,
            position: c.polygon[0], // Use first coordinate as representative center
            village: c.village || 'Unknown',
            status: (c.status || 'Pending').charAt(0).toUpperCase() + (c.status || 'Pending').slice(1),
            state: c.state || 'Unknown'
          }));
        setClaimLocations(locations);

      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError(err.message || 'Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [user]);

  // Extract first name from full name
  const getFirstName = (fullName) => {
    if (!fullName) return 'User';
    return fullName.split(' ')[0];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 p-6 rounded-lg border border-red-200 text-center">
        <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-red-800">Error</h2>
        <p className="text-red-600">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-green-600 to-blue-600 rounded-lg p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">Welcome back, {getFirstName(user?.name)}!</h1>
            <p className="text-green-100">Here's what's happening with FRA claims today.</p>
          </div>
          <div className="hidden md:block">
            <div className="flex items-center space-x-2 bg-white/10 rounded-lg px-4 py-2">
              <Calendar className="h-5 w-5" />
              <span className="text-sm">{new Date().toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {kpiData.map((kpi, index) => (
          <div key={index} className="bg-white rounded-lg shadow-sm border p-6 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">{kpi.title}</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">{kpi.value}</p>
                <div className="flex items-center mt-2">
                  {kpi.trend === 'up' ? (
                    <ArrowUpRight className="h-4 w-4 text-green-500 mr-1" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4 text-red-500 mr-1" />
                  )}
                  <span className={`text-sm font-medium ${kpi.trend === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                    {kpi.change}
                  </span>
                  <span className="text-sm text-gray-500 ml-1">vs last month</span>
                </div>
              </div>
              <div className={`p-3 rounded-lg ${kpi.bgColor}`}>
                <kpi.icon className={`h-6 w-6 ${kpi.color}`} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts and Map Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Trends */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Claim Trends</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="claims" stroke="#3B82F6" strokeWidth={2} name="Total Claims" />
              <Line type="monotone" dataKey="approved" stroke="#10B981" strokeWidth={2} name="Approved Claims" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* State Distribution */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Claims by State</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={stateData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent, x, y, textAnchor, fill }) => (
                  <text x={x} y={y} textAnchor={textAnchor} fill={fill} fontSize={12}>
                    <title>{`${name} ${(percent * 100).toFixed(0)}%`}</title>
                    {`${name} ${(percent * 100).toFixed(0)}%`}
                  </text>
                )}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {stateData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Claims Overview Map */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Claims Overview</h3>
            <button
              type="button"
              onClick={() => navigate('/map')}
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center"
            >
              <Eye className="h-4 w-4 mr-1" />
              View Full Map
            </button>
          </div>
          <div className="h-64 w-full rounded-lg overflow-hidden">
            <MapContainer
              center={[22.5, 82.5]}
              zoom={4}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {claimLocations.map((claim) => {
                const colorMap = { MP: '#3B82F6', TR: '#EF4444', OD: '#10B981', TL: '#F59E0B' };
                const color = colorMap[claim.state] || '#6366F1';
                return (
                  <Circle
                    key={claim.id}
                    center={claim.position}
                    radius={15000}
                    pathOptions={{ color, fillColor: color, fillOpacity: 0.9 }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <p className="font-semibold">{claim.village}</p>
                        <p className="text-gray-600">State: {claim.state}</p>
                        <p className={`text-xs ${claim.status === 'Approved' ? 'text-green-600' : 'text-yellow-600'}`}>
                          Status: {claim.status}
                        </p>
                      </div>
                    </Popup>
                  </Circle>
                );
              })}
              {/* State boundaries circles */}
              <Circle center={[23.2599, 81.8282]} radius={50000} pathOptions={{ color: '#3B82F6', fillColor: '#3B82F6', fillOpacity: 0.1 }} />
              <Circle center={[23.9408, 91.9882]} radius={50000} pathOptions={{ color: '#EF4444', fillColor: '#EF4444', fillOpacity: 0.1 }} />
              <Circle center={[20.9517, 85.0985]} radius={50000} pathOptions={{ color: '#10B981', fillColor: '#10B981', fillOpacity: 0.1 }} />
              <Circle center={[17.3850, 78.4867]} radius={50000} pathOptions={{ color: '#F59E0B', fillColor: '#F59E0B', fillOpacity: 0.1 }} />
            </MapContainer>
          </div>
          <div className="mt-3 flex justify-center space-x-4 text-xs">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div>
              <span className="truncate max-w-[120px] whitespace-nowrap overflow-hidden" title="Madhya Pradesh">Madhya Pradesh</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-red-500 rounded-full mr-1"></div>
              <span className="truncate max-w-[120px] whitespace-nowrap overflow-hidden" title="Tripura">Tripura</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
              <span className="truncate max-w-[120px] whitespace-nowrap overflow-hidden" title="Odisha">Odisha</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-yellow-500 rounded-full mr-1"></div>
              <span className="truncate max-w-[120px] whitespace-nowrap overflow-hidden" title="Telangana">Telangana</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent Activity */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Activity</h3>
          <div className="space-y-4">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-center space-x-3 p-3 rounded-lg hover:bg-gray-50">
                <div className={`p-2 rounded-full ${
                  activity.type === 'claim' ? 'bg-blue-100' :
                  activity.type === 'approval' ? 'bg-green-100' :
                  activity.type === 'alert' ? 'bg-red-100' : 'bg-purple-100'
                }`}>
                  {activity.type === 'claim' && <FileText className="h-4 w-4 text-blue-600" />}
                  {activity.type === 'approval' && <CheckCircle className="h-4 w-4 text-green-600" />}
                  {activity.type === 'alert' && <AlertTriangle className="h-4 w-4 text-red-600" />}
                  {activity.type === 'report' && <TrendingUp className="h-4 w-4 text-purple-600" />}
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{activity.action}</p>
                  <p className="text-sm text-gray-500">by {activity.user}</p>
                </div>
                <span className="text-xs text-gray-400">{activity.time}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/claim-submission')}
              className="w-full flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 transition-colors"
            >
              <FileText className="h-4 w-4 mr-2" />
              Submit New Claim
            </button>
            <button
              onClick={() => navigate('/map')}
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <MapPin className="h-4 w-4 mr-2" />
              View Map
            </button>
            <button
              onClick={() => navigate('/reports')}
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <TrendingUp className="h-4 w-4 mr-2" />
              Generate Report
            </button>
            <button
              onClick={() => navigate('/alerts')}
              className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <AlertTriangle className="h-4 w-4 mr-2" />
              View Alerts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
