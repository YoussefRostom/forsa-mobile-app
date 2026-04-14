import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, I18nManager, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../locales/i18n';
import { useHamburgerMenu } from './HamburgerMenuContext';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import { subscribeMyNotifications } from '../services/NotificationService';
import { getCurrentUserRole, type Role } from '../services/UserRoleService';

interface MenuItem {
  label: string;
  route: string;
  icon: string;
  special?: boolean;
  comingSoon?: boolean;
  dividerBefore?: boolean;
}

export default function HamburgerMenu() {
  const router = useRouter();
  const segments = useSegments();
  const { visible, closeMenu } = useHamburgerMenu();
  const { user } = useAuth();

  // Detect role from current route
  const currentPath = '/' + segments.join('/');
  const getRole = (): 'player' | 'parent' | 'agent' | 'clinic' | 'academy' => {
    // Check for specific role routes first (more specific patterns)
    // Parent routes
    if (currentPath.includes('/parent-')) return 'parent';
    // Agent routes - but exclude search routes that players use
    // Only match actual agent profile/feed routes, not search routes
    if (currentPath.includes('/agent-feed') ||
      currentPath.includes('/agent-edit-profile') ||
      currentPath.includes('/agent-players') ||
      currentPath.includes('/agent-contacts') ||
      currentPath.includes('/agent-upload-media') ||
      currentPath.includes('/agent-my-media') ||
      currentPath.includes('/agent-services')) {
      return 'agent';
    }
    // Clinic routes - but exclude search routes that players use
    // Only match actual clinic profile/feed routes, not search routes
    if (currentPath.includes('/clinic-feed') ||
      currentPath.includes('/clinic-edit-services') ||
      currentPath.includes('/clinic-edit-timetable') ||
      currentPath.includes('/clinic-bookings') ||
      currentPath.includes('/clinic-messages') ||
      currentPath.includes('/clinic-chat')) {
      return 'clinic';
    }
    // Academy routes - but exclude search routes that players use
    // Only match actual academy profile/feed routes, not search routes
    if (currentPath.includes('/academy-feed') ||
      currentPath.includes('/academy-edit-profile') ||
      currentPath.includes('/academy-upload-media') ||
      currentPath.includes('/academy-messages') ||
      currentPath.includes('/academy-services') ||
      currentPath.includes('/academy-assistance') ||
      currentPath.includes('/academy-chat') ||
      currentPath.includes('/academy-home') ||
      currentPath.includes('/academy-bookings') ||
      currentPath.includes('/academy-clinic-details')) {
      return 'academy';
    }
    // Explicitly exclude search routes - these should show player menu
    // Default to player for all other routes (including /academy-search, /agent-search, /clinic-search, /parent-search-academies, etc.)
    return 'player';
  };

  const pathRole = getRole();
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [roleOnNotificationsScreen, setRoleOnNotificationsScreen] = useState<Role | null>(null);

  // When on /notifications, keep menu role from user profile so menu doesn't switch to player
  useEffect(() => {
    if (currentPath !== '/notifications' || !auth.currentUser) {
      setRoleOnNotificationsScreen(null);
      return;
    }
    getCurrentUserRole().then(setRoleOnNotificationsScreen).catch(() => setRoleOnNotificationsScreen(null));
  }, [currentPath]);

  const role = (currentPath === '/notifications' && roleOnNotificationsScreen) ? roleOnNotificationsScreen : pathRole;

  useEffect(() => {
    if (!auth.currentUser) {
      setUnreadNotificationCount(0);
      return;
    }
    const unsubscribe = subscribeMyNotifications((notifications) => {
      const unread = notifications.filter((n) => !n.read).length;
      setUnreadNotificationCount(unread);
    });
    return () => unsubscribe();
  }, []);

  // Get menu items based on role
  const getMenuItems = (): MenuItem[] => {
    let items: MenuItem[] = [];

    // Add Admin Dashboard link for admins
    if (user?.role === 'admin') {
      items.push({ label: 'Admin Dashboard', route: '/(admin)/dashboard', icon: 'shield-checkmark-outline' });
    }

    switch (role) {
      case 'parent':
        items = [...items,
        { label: i18n.t('parentFeed') || 'Parent Feed', route: '/parent-feed', icon: 'home-outline' },
        { label: i18n.t('parentEditProfile') || 'Edit Profile', route: '/parent-edit-profile', icon: 'create-outline' },
        { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline' },
        { label: 'My QR Code', route: '/my-qr-code', icon: 'qr-code-outline' },
        { label: i18n.t('searchAcademies') || 'Search Academies', route: '/parent-search-academies', icon: 'school-outline' },
        { label: i18n.t('searchClinics') || 'Search Clinics', route: '/parent-search-clinics', icon: 'medical-outline' },
        { label: i18n.t('myBookings') || 'My Bookings', route: '/parent-bookings', icon: 'calendar-outline' },
        { label: i18n.t('parentMessages') || 'Messages', route: '/parent-messages', icon: 'chatbubbles-outline' },
        ];
        break;
      case 'agent':
        items = [...items,
        { label: i18n.t('agentFeed') || 'Feed', route: '/agent-feed', icon: 'home-outline' },
        { label: i18n.t('agentEditProfile') || 'Edit Profile', route: '/agent-edit-profile', icon: 'create-outline' },
        { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline' },
        { label: i18n.t('agentPlayers') || 'Players', route: '/agent-players', icon: 'people-outline' },
        { label: i18n.t('messages') || 'Messages', route: '/agent-contacts', icon: 'chatbubbles-outline' },
        { label: i18n.t('myMedia') || 'My Media', route: '/agent-my-media', icon: 'images-outline' },
        { label: i18n.t('uploadMedia') || 'Upload Media', route: '/agent-upload-media', icon: 'cloud-upload-outline' },
        ];
        break;
      case 'clinic':
        items = [...items,
        { label: i18n.t('clinicFeed') || 'Clinic Feed', route: '/clinic-feed', icon: 'home-outline' },
        { label: 'Scan Check-in', route: '/scan-checkin', icon: 'qr-code-outline' },
        { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline' },
        { label: i18n.t('editServices') || 'Edit Services', route: '/clinic-edit-services', icon: 'list-outline' },
        { label: i18n.t('myBookings') || 'My Bookings', route: '/clinic-bookings', icon: 'calendar-outline' },
        { label: i18n.t('messages') || 'Messages', route: '/clinic-messages', icon: 'chatbubbles-outline' },
        ];
        break;
      case 'academy':
        items = [...items,
        { label: i18n.t('academyFeed') || 'Feed', route: '/academy-feed', icon: 'home-outline' },
        { label: 'Scan Check-in', route: '/scan-checkin', icon: 'qr-code-outline' },
        { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline' },
        { label: i18n.t('academyEditProfile') || 'Edit Profile', route: '/academy-edit-profile', icon: 'create-outline' },
        { label: i18n.t('academyUploadMedia') || 'Upload Media', route: '/academy-upload-media', icon: 'cloud-upload-outline' },
        { label: i18n.t('myBookings') || 'My Bookings', route: '/academy-bookings', icon: 'calendar-outline' },
        { label: i18n.t('academyMessages') || 'Messages', route: '/academy-messages', icon: 'chatbubbles-outline' },
        ];
        break;
      default: // player
        items = [...items,
        { label: i18n.t('feed') || 'Feed', route: '/player-feed', icon: 'home-outline' },
        { label: i18n.t('editProfile') || 'Edit Profile', route: '/player-profile', icon: 'create-outline' },
        { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline' },
        { label: 'My QR Code', route: '/my-qr-code', icon: 'qr-code-outline' },
        { label: i18n.t('uploadMedia') || 'Upload Media', route: '/player-upload-media', icon: 'cloud-upload-outline' },
        { label: i18n.t('myMedia') || 'My Media', route: '/player-my-media', icon: 'images-outline' },
        { label: i18n.t('messages') || 'Messages', route: '/player-messages', icon: 'chatbubbles-outline' },
        { label: i18n.t('myBookings') || 'My Bookings', route: '/player-bookings', icon: 'calendar-outline' },
        { label: i18n.t('searchAcademies') || 'Search Academies', route: '/academy-search', icon: 'school-outline' },
        { label: i18n.t('clinicSearch') || 'Clinic Search', route: '/clinic-search', icon: 'medical-outline' },
        ];
    }
    return items;
  };

  // Get assistance route based on role
  const getAssistanceRoute = (): string => {
    switch (role) {
      case 'parent': return '/parent-feed'; // No specific assistance for parent
      case 'agent': return '/agent-services';
      case 'clinic': return '/clinic-services';
      case 'academy': return '/academy-services';
      default: return '/player-verify';
    }
  };

  const menuItems = getMenuItems();
  const assistanceRoute = getAssistanceRoute();
  const assistanceLabel = role === 'player'
    ? (i18n.t('academyAssistance') || 'Assistance & Extras')
    : role === 'agent'
      ? (i18n.t('agentAssistance') || 'Assistance & Extras')
      : role === 'clinic'
        ? (i18n.t('clinicAssistance') || 'Assistance & Extras')
        : (i18n.t('academyAssistance') || 'Assistance & Extras');

  const handleNavigate = (path: string | { pathname: string; params?: any }) => {
    closeMenu();
    if (path === '/parent-feed' || path === '/agent-feed' || path === '/clinic-feed' || path === '/academy-feed' || path === '/player-feed' || path === '/(admin)/dashboard') {
      router.replace(path as any);
    } else {
      router.push(path as any);
    }
  };

  return (

    <Modal visible={visible} animationType="fade" transparent onRequestClose={closeMenu}>
      <View style={styles.modalContainer}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={closeMenu} />
        <View style={styles.menuBox}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {/* Regular Menu Items (no coming soon) */}
            {menuItems.filter(item => !item.comingSoon).map((item, index) => (
              <React.Fragment key={item.route}>
                {item.dividerBefore && <View style={styles.divider} />}
                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => handleNavigate(item.route)}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={item.icon as any}
                    size={20}
                    color={'#000'}
                    style={styles.menuIcon}
                  />
                  <Text style={styles.menuText}>
                    {item.label}
                  </Text>
                  {item.route === '/notifications' && unreadNotificationCount > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>
                        {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              </React.Fragment>
            ))}

            {/* Divider */}
            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleNavigate('/signout')}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={20} color="#ff3b30" style={styles.menuIcon} />
              <Text style={[styles.menuText, styles.signOutText]}>
                {i18n.t('signOut') || 'Sign Out'}
              </Text>
            </TouchableOpacity>

            {/* Language Switcher */}
            <View style={styles.languageSection}>
              <Text style={styles.languageLabel}>{i18n.t('selectLanguage') || 'Select Language'}</Text>
              <View style={styles.languageRow}>
                <TouchableOpacity
                  style={[styles.langButton, i18n.locale === 'en' && styles.langButtonActive]}
                  onPress={async () => {
                    i18n.locale = 'en';
                    await AsyncStorage.setItem('appLang', 'en');
                    I18nManager.forceRTL(false);
                    I18nManager.swapLeftAndRightInRTL(false);
                    closeMenu();
                    setTimeout(() => {
                      const currentPath = '/' + segments.join('/');
                      if (currentPath && currentPath !== '/') {
                        router.replace(currentPath as any);
                      }
                    }, 100);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.langButtonText, i18n.locale === 'en' && styles.langButtonTextActive]}>
                    English
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.langButton, i18n.locale === 'ar' && styles.langButtonActive]}
                  onPress={async () => {
                    i18n.locale = 'ar';
                    await AsyncStorage.setItem('appLang', 'ar');
                    I18nManager.forceRTL(true);
                    I18nManager.swapLeftAndRightInRTL(true);
                    closeMenu();
                    setTimeout(() => {
                      const currentPath = '/' + segments.join('/');
                      if (currentPath && currentPath !== '/') {
                        router.replace(currentPath as any);
                      }
                    }, 100);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.langButtonText, i18n.locale === 'ar' && styles.langButtonTextActive]}>
                    العربية
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    position: 'relative',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  menuBox: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 100 : 80,
    left: 20,
    width: 280,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    maxHeight: '80%',
    zIndex: 1000,
  },
  scrollContent: {
    paddingBottom: 16,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuIcon: {
    marginRight: 12,
    width: 24,
  },
  menuText: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
    flex: 1,
  },
  unreadBadge: {
    backgroundColor: '#FF3B30',
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  goldMenuItem: {
    backgroundColor: '#FFD700',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 2,
    borderBottomColor: '#e0c800',
    paddingVertical: 18,
  },
  goldMenuText: {
    color: '#000',
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.3,
  },
  specialMenuItemContainer: {
    position: 'relative',
    overflow: 'hidden',
  },
  specialMenuText: {
    color: '#999',
  },
  comingSoonBlurredText: {
    color: 'transparent',
    textShadowColor: 'rgba(100, 100, 100, 0.65)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  comingSoonBlurredIcon: {
    opacity: 0.15,
  },
  comingSoonOverlay: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  diagonalBannerContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  diagonalBanner: {
    position: 'absolute',
    width: '160%',
    height: 26,
    backgroundColor: 'rgba(80, 80, 80, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ rotate: '-18deg' }],
  },
  diagonalBannerText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  signOutText: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
    marginHorizontal: 24,
  },
  languageSection: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    marginTop: 8,
  },
  languageLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  langButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
  },
  langButtonActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  langButtonText: {
    fontSize: 15,
    color: '#000',
    fontWeight: '600',
  },
  langButtonTextActive: {
    color: '#fff',
  },
});
