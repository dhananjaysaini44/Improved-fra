import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Home, Map, FileText, List, AlertTriangle, BarChart3, Settings, User, LogOut, Bell, Moon, Sun, Menu, X, Download } from 'lucide-react';
import { logout } from '../store/slices/authSlice';
import { useState, useEffect, useRef } from 'react';

const MainLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { user } = useSelector((state) => state.auth);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  
  // Notifications state
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: 'alert',
      title: 'New Forest Alert',
      message: 'Potential deforestation detected in Madhya Pradesh',
      time: '2 hours ago',
      unread: true
    },
    {
      id: 2,
      type: 'claim',
      title: 'Claim Approved',
      message: 'Claim #FR-2024-001 has been approved',
      time: '1 day ago',
      unread: true
    },
    {
      id: 3,
      type: 'system',
      title: 'System Update',
      message: 'Monthly data sync completed successfully',
      time: '2 days ago',
      unread: false
    }
  ]);
  
  const unreadCount = notifications.filter(n => n.unread).length;
  const notificationRef = useRef(null);

  // Close notification dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Listen for PWA install prompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      // Prevent Chrome 67 and earlier from automatically showing the prompt
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    }
  };

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Map', href: '/map', icon: Map },
    { name: 'Claim Submission', href: '/claim-submission', icon: FileText },
    { name: 'Claim Tracking', href: '/claim-tracking', icon: List },
    { name: 'Alerts', href: '/alerts', icon: AlertTriangle },
    { name: 'Reports', href: '/reports', icon: BarChart3 },
    // Show Admin only for admins
    ...(user?.role === 'admin' ? [{ name: 'Admin', href: '/admin', icon: Settings }] : []),
    { name: 'Profile', href: '/profile', icon: User },
  ];

  const handleLogout = () => {
    dispatch(logout());
    localStorage.removeItem('token');
    navigate('/login');
  };

  useEffect(() => {
    const stored = localStorage.getItem('darkMode');
    const initial = stored ? stored === 'true' : false;
    setDarkMode(initial);
    document.documentElement.classList.toggle('dark', initial);
  }, []);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    localStorage.setItem('darkMode', String(next));
    document.documentElement.classList.toggle('dark', next);
  };

  return (
    <div className={`flex h-screen ${darkMode ? 'bg-gray-900' : 'bg-gray-100'}`}>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="fixed inset-0 bg-gray-600 bg-opacity-75" onClick={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 w-64 ${darkMode ? 'bg-gray-800' : 'bg-white'} shadow-lg transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0`}>
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center">
                <Map className="h-5 w-5 text-white" />
              </div>
            </div>
            <div className="ml-3">
              <h2 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>Drishti</h2>
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1 rounded-md text-gray-400 hover:text-gray-500 focus:outline-none"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center">
              <User className="h-6 w-6 text-white" />
            </div>
            <div className="ml-3">
              <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                {user?.name || 'User'}
              </p>
              <p className="text-xs text-gray-500">{user?.email || 'user@example.com'}</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="mt-4 px-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md mb-1 transition-colors duration-200 ${
                  isActive
                    ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200'
                    : `${darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`
                }`}
              >
                <item.icon className="mr-3 h-5 w-5 flex-shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleLogout}
            className={`group flex items-center px-3 py-2 text-sm font-medium rounded-md w-full transition-colors duration-200 ${
              darkMode ? 'text-gray-300 hover:bg-gray-700 hover:text-white' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
            }`}
          >
            <LogOut className="mr-3 h-5 w-5" />
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:pl-0">
        {/* Header */}
        <header className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'} shadow-sm border-b px-4 lg:px-6 relative z-[1000]`}>
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <button
                onClick={() => setSidebarOpen(true)}
                className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 focus:outline-none"
              >
                <Menu className="h-6 w-6" />
              </button>
              <h1 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'} ml-2 lg:ml-0`}>
                Drishti DSS
              </h1>
            </div>

            <div className="flex items-center space-x-4">
              {/* Install PWA Button */}
              {deferredPrompt && (
                <button
                  onClick={handleInstallClick}
                  className={`flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors border ${
                    darkMode 
                      ? 'border-green-500 text-green-400 hover:bg-green-900/30' 
                      : 'border-green-600 text-green-700 hover:bg-green-50'
                  }`}
                  title="Install App"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  <span className="hidden sm:inline">Install App</span>
                </button>
              )}

              {/* Dark Mode Toggle */}
              <button
                onClick={toggleDarkMode}
                className={`p-2 rounded-md ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-gray-600'} focus:outline-none`}
              >
                {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>

              {/* Notifications */}
              <div className="relative" ref={notificationRef}>
                <button 
                  onClick={() => setShowNotifications(!showNotifications)}
                  className={`p-2 rounded-md ${darkMode ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-gray-600'} focus:outline-none relative`}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 block h-5 w-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center">
                      {unreadCount}
                    </span>
                  )}
                </button>
                
                {/* Notification Dropdown */}
                {showNotifications && (
                  <div className={`absolute right-0 mt-2 w-80 ${darkMode ? 'bg-gray-800' : 'bg-white'} rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-[10000]`} style={{ zIndex: 10000 }}>
                    <div className="py-1">
                      <div className={`px-4 py-2 border-b ${darkMode ? 'border-gray-700 text-white' : 'border-gray-200 text-gray-900'} flex items-center justify-between`}>
                        <h3 className="text-lg font-medium">Notifications</h3>
                        <button
                          onClick={(e) => { e.stopPropagation(); setNotifications([]); setShowNotifications(false); }}
                          title="Clear notifications and close"
                          aria-label="Clear notifications and close"
                          className={`${darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      {notifications.length === 0 ? (
                        <div className={`px-4 py-3 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                          No notifications
                        </div>
                      ) : (
                        notifications.map((notification) => (
                          <div 
                            key={notification.id} 
                            className={`px-4 py-3 border-b ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-100 hover:bg-gray-50'} cursor-pointer ${notification.unread ? (darkMode ? 'bg-gray-700' : 'bg-blue-50') : ''}`}
                          >
                            <div className="flex items-start">
                              <div className={`flex-shrink-0 mr-3 mt-1`}>
                                {notification.type === 'alert' && <AlertTriangle className="h-4 w-4 text-red-500" />}
                                {notification.type === 'claim' && <FileText className="h-4 w-4 text-green-500" />}
                                {notification.type === 'system' && <Settings className="h-4 w-4 text-blue-500" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                                  {notification.title}
                                </p>
                                <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} mt-1`}>
                                  {notification.message}
                                </p>
                                <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} mt-2`}>
                                  {notification.time}
                                </p>
                              </div>
                              {notification.unread && (
                                <div className="flex-shrink-0">
                                  <span className="inline-block h-2 w-2 rounded-full bg-blue-500"></span>
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                      <div className={`px-4 py-2 border-t ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                        <button
                          onClick={() => {
                            setShowNotifications(false);
                            setShowNotificationsModal(true);
                          }}
                          className={`text-sm ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-800'} font-medium`}
                        >
                          View all notifications
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* User Menu */}
              <div className="flex items-center">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                  <User className="h-4 w-4 text-white" />
                </div>
                <span className={`ml-2 text-sm font-medium ${darkMode ? 'text-white' : 'text-gray-700'} hidden md:block`}>
                  {user?.name || 'User'}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Notifications Modal */}
        {showNotificationsModal && (
          <div className="fixed inset-0 z-[11000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/50" onClick={() => setShowNotificationsModal(false)}></div>
            <div className={`relative z-[11001] w-full max-w-2xl ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-gray-900'} rounded-lg shadow-2xl border ${darkMode ? 'border-gray-700' : 'border-gray-200'}`}>
              <div className="flex items-center justify-between px-5 py-3 border-b">
                <h3 className="text-lg font-semibold">All Notifications</h3>
                <button
                  onClick={() => setShowNotificationsModal(false)}
                  className={`${darkMode ? 'text-gray-300 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-3">
                {notifications.length === 0 ? (
                  <div className={`${darkMode ? 'text-gray-400' : 'text-gray-500'} text-center py-8`}>
                    No notifications
                  </div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id} className={`p-3 rounded border ${darkMode ? 'border-gray-700 hover:bg-gray-700' : 'border-gray-200 hover:bg-gray-50'}`}>
                      <div className="flex items-start">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'} mt-1`}>{n.message}</p>
                          <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-500'} mt-2`}>{n.time}</p>
                        </div>
                        {n.unread && <span className="ml-3 inline-block h-2 w-2 rounded-full bg-blue-500 mt-2"></span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between px-5 py-3 border-t">
                <button
                  onClick={() => setNotifications([])}
                  className={`text-sm ${darkMode ? 'text-red-300 hover:text-red-200' : 'text-red-600 hover:text-red-700'} font-medium`}
                >
                  Clear all
                </button>
                <button
                  onClick={() => setShowNotificationsModal(false)}
                  className={`px-4 py-2 rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600 text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className={`flex-1 overflow-auto ${darkMode ? 'bg-gray-900 text-gray-100' : 'bg-gray-50 text-gray-900'}`}>
          <div className="p-4 lg:p-6">
            <Outlet />
          </div>
        </main>

        {/* Footer */}
        <footer className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white'} border-t px-4 lg:px-6 py-4`}>
          <div className="flex items-center justify-between">
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              © 2025 Drishti DSS. All rights reserved.
            </p>
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <span>Focus States: MP, TR, OD, TS</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default MainLayout;
