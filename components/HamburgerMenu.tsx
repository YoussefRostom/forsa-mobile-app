import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter, useSegments } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, I18nManager, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../locales/i18n';
import { useHamburgerMenu } from './HamburgerMenuContext';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import { subscribeMyNotifications } from '../services/NotificationService';
import { getCurrentUserRole, type Role } from '../services/UserRoleService';
import { findAdminUserId, getOrCreateConversation } from '../services/MessagingService';

type MenuRole = 'player' | 'parent' | 'agent' | 'clinic' | 'academy';
type MenuSectionKey = 'main' | 'discover' | 'content' | 'profile' | 'work' | 'operations' | 'support';

interface MenuItem {
  label: string;
  route: string;
  icon: string;
  section: MenuSectionKey;
  special?: boolean;
  comingSoon?: boolean;
}

const getRoleFromPath = (currentPath: string): MenuRole => {
  if (currentPath.includes('/parent-')) return 'parent';

  if (
    currentPath.includes('/agent-feed') ||
    currentPath.includes('/agent-edit-profile') ||
    currentPath.includes('/agent-players') ||
    currentPath.includes('/agent-contacts') ||
    currentPath.includes('/agent-upload-media') ||
    currentPath.includes('/agent-my-media') ||
    currentPath.includes('/agent-services')
  ) {
    return 'agent';
  }

  if (
    currentPath.includes('/clinic-feed') ||
    currentPath.includes('/clinic-edit-profile') ||
    currentPath.includes('/clinic-branches') ||
    currentPath.includes('/clinic-edit-branch') ||
    currentPath.includes('/clinic-edit-services') ||
    currentPath.includes('/clinic-edit-timetable') ||
    currentPath.includes('/clinic-upload-media') ||
    currentPath.includes('/clinic-bookings') ||
    currentPath.includes('/clinic-messages') ||
    currentPath.includes('/clinic-chat')
  ) {
    return 'clinic';
  }

  if (
    currentPath.includes('/academy-feed') ||
    currentPath.includes('/academy-edit-profile') ||
    currentPath.includes('/academy-upload-media') ||
    currentPath.includes('/academy-messages') ||
    currentPath.includes('/academy-services') ||
    currentPath.includes('/academy-assistance') ||
    currentPath.includes('/academy-chat') ||
    currentPath.includes('/academy-home') ||
    currentPath.includes('/academy-bookings') ||
    currentPath.includes('/academy-clinic-details')
  ) {
    return 'academy';
  }

  return 'player';
};

export default function HamburgerMenu() {
  const router = useRouter();
  const segments = useSegments();
  const { visible, closeMenu } = useHamburgerMenu();
  const { user } = useAuth();

  const currentPath = '/' + segments.join('/');
  const pathRole = getRoleFromPath(currentPath);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [roleOnNotificationsScreen, setRoleOnNotificationsScreen] = useState<Role | null>(null);
  const [openingAdminChat, setOpeningAdminChat] = useState(false);
  const adminChatCache = useRef<{ adminId: string; convId: string } | null>(null);

  useEffect(() => {
    if (!auth.currentUser) return;
    findAdminUserId()
      .then(async (adminId) => {
        if (!adminId || adminChatCache.current) return;
        const convId = await getOrCreateConversation(adminId);
        adminChatCache.current = { adminId, convId };
      })
      .catch(() => {});
  }, []);

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
      const unread = notifications.filter((notification) => !notification.read).length;
      setUnreadNotificationCount(unread);
    });
    return () => unsubscribe();
  }, []);

  const getSectionLabel = (section: MenuSectionKey) => {
    switch (section) {
      case 'main':
        return i18n.t('menuMain') || 'Main';
      case 'discover':
        return i18n.t('menuDiscover') || 'Discover';
      case 'content':
        return i18n.t('menuContent') || 'Content';
      case 'profile':
        return i18n.t('menuProfile') || 'Profile';
      case 'work':
        return i18n.t('menuWork') || 'Work';
      case 'operations':
        return i18n.t('menuOperations') || 'Operations';
      case 'support':
        return i18n.t('menuSupport') || 'Support';
      default:
        return '';
    }
  };

  const getMenuItems = (): MenuItem[] => {
    let items: MenuItem[] = [];

    if (user?.role === 'admin') {
      items.push({
        label: 'Admin Dashboard',
        route: '/(admin)/dashboard',
        icon: 'shield-checkmark-outline',
        section: 'main',
      });
    }

    switch (role) {
      case 'parent':
        items = [
          ...items,
          { label: i18n.t('parentFeed') || 'Parent Feed', route: '/parent-feed', icon: 'home-outline', section: 'main' },
          { label: i18n.t('parentMessages') || 'Messages', route: '/parent-messages', icon: 'chatbubbles-outline', section: 'main' },
          { label: i18n.t('myBookings') || 'My Bookings', route: '/parent-bookings', icon: 'calendar-outline', section: 'main' },
          { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline', section: 'main' },
          { label: i18n.t('searchAcademies') || 'Search Academies', route: '/parent-search-academies', icon: 'school-outline', section: 'discover' },
          { label: i18n.t('searchClinics') || 'Search Clinics', route: '/parent-search-clinics', icon: 'medical-outline', section: 'discover' },
          { label: i18n.t('searchUsers') || 'Search Users', route: '/user-search', icon: 'search-outline', section: 'discover' },
          { label: i18n.t('myQrCode') || 'My QR Code', route: '/my-qr-code', icon: 'qr-code-outline', section: 'discover' },
          { label: i18n.t('parentEditProfile') || 'Edit Profile', route: '/parent-edit-profile', icon: 'create-outline', section: 'profile' },
          { label: i18n.t('contactUs') || 'Contact Us', route: '__admin_chat__', icon: 'headset-outline', section: 'support' },
        ];
        break;
      case 'agent':
        items = [
          ...items,
          { label: i18n.t('agentFeed') || 'Feed', route: '/agent-feed', icon: 'home-outline', section: 'main' },
          { label: i18n.t('messages') || 'Messages', route: '/agent-contacts', icon: 'chatbubbles-outline', section: 'main' },
          { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline', section: 'main' },
          { label: i18n.t('agentPlayers') || 'Players', route: '/agent-players', icon: 'people-outline', section: 'work' },
          { label: i18n.t('myMedia') || 'My Media', route: '/agent-my-media', icon: 'images-outline', section: 'content' },
          { label: i18n.t('uploadMedia') || 'Upload Media', route: '/agent-upload-media', icon: 'cloud-upload-outline', section: 'content' },
          { label: i18n.t('agentEditProfile') || 'Edit Profile', route: '/agent-edit-profile', icon: 'create-outline', section: 'profile' },
          { label: i18n.t('contactUs') || 'Contact Us', route: '__admin_chat__', icon: 'headset-outline', section: 'support' },
        ];
        break;
      case 'clinic':
        items = [
          ...items,
          { label: i18n.t('clinicFeed') || 'Clinic Feed', route: '/clinic-feed', icon: 'home-outline', section: 'main' },
          { label: i18n.t('messages') || 'Messages', route: '/clinic-messages', icon: 'chatbubbles-outline', section: 'main' },
          { label: i18n.t('myBookings') || 'My Bookings', route: '/clinic-bookings', icon: 'calendar-outline', section: 'main' },
          { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline', section: 'main' },
          { label: i18n.t('scanCheckIn') || 'Scan Check-in', route: '/scan-checkin', icon: 'qr-code-outline', section: 'operations' },
          { label: i18n.t('clinicEditProfile') || 'Edit Profile', route: '/clinic-edit-profile', icon: 'create-outline', section: 'content' },
          { label: i18n.t('uploadMedia') || 'Upload Media', route: '/clinic-upload-media', icon: 'cloud-upload-outline', section: 'content' },
          { label: i18n.t('contactUs') || 'Contact Us', route: '__admin_chat__', icon: 'headset-outline', section: 'support' },
        ];
        break;
      case 'academy':
        items = [
          ...items,
          { label: i18n.t('academyFeed') || 'Feed', route: '/academy-feed', icon: 'home-outline', section: 'main' },
          { label: i18n.t('academyMessages') || 'Messages', route: '/academy-messages', icon: 'chatbubbles-outline', section: 'main' },
          { label: i18n.t('myBookings') || 'My Bookings', route: '/academy-bookings', icon: 'calendar-outline', section: 'main' },
          { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline', section: 'main' },
          { label: i18n.t('scanCheckIn') || 'Scan Check-in', route: '/scan-checkin', icon: 'qr-code-outline', section: 'operations' },
          { label: i18n.t('academyEditProfile') || 'Edit Profile', route: '/academy-edit-profile', icon: 'create-outline', section: 'content' },
          { label: i18n.t('academyUploadMedia') || 'Upload Media', route: '/academy-upload-media', icon: 'cloud-upload-outline', section: 'content' },
          { label: i18n.t('contactUs') || 'Contact Us', route: '__admin_chat__', icon: 'headset-outline', section: 'support' },
        ];
        break;
      default:
        items = [
          ...items,
          { label: i18n.t('feed') || 'Feed', route: '/player-feed', icon: 'home-outline', section: 'main' },
          { label: i18n.t('messages') || 'Messages', route: '/player-messages', icon: 'chatbubbles-outline', section: 'main' },
          { label: i18n.t('myBookings') || 'My Bookings', route: '/player-bookings', icon: 'calendar-outline', section: 'main' },
          { label: i18n.t('notifications') || 'Notifications', route: '/notifications', icon: 'notifications-outline', section: 'main' },
          { label: i18n.t('myProfile') || 'My Profile', route: '/player-profile', icon: 'person-circle-outline', section: 'content' },
          { label: i18n.t('myMedia') || 'My Media', route: '/player-my-media', icon: 'images-outline', section: 'content' },
          { label: i18n.t('uploadMedia') || 'Upload Media', route: '/player-upload-media', icon: 'cloud-upload-outline', section: 'content' },
          { label: i18n.t('searchUsers') || 'Search Users', route: '/user-search', icon: 'search-outline', section: 'discover' },
          { label: i18n.t('searchAcademies') || 'Search Academies', route: '/academy-search', icon: 'school-outline', section: 'discover' },
          { label: i18n.t('clinicSearch') || 'Clinic Search', route: '/clinic-search', icon: 'medical-outline', section: 'discover' },
          { label: i18n.t('myQrCode') || 'My QR Code', route: '/my-qr-code', icon: 'qr-code-outline', section: 'discover' },
          { label: i18n.t('contactUs') || 'Contact Us', route: '__admin_chat__', icon: 'headset-outline', section: 'support' },
        ];
    }

    return items;
  };

  const menuItems = getMenuItems();
  const groupedMenuItems = menuItems.reduce((groups, item) => {
    const existingGroup = groups.find((group) => group.section === item.section);
    if (existingGroup) {
      existingGroup.items.push(item);
    } else {
      groups.push({ section: item.section, items: [item] });
    }
    return groups;
  }, [] as Array<{ section: MenuSectionKey; items: MenuItem[] }>);

  const chatPathnameForRole = (): string => {
    switch (role) {
      case 'academy':
        return '/academy-chat';
      case 'clinic':
        return '/clinic-chat';
      case 'parent':
        return '/parent-chat';
      case 'agent':
        return '/agent-messages';
      default:
        return '/player-chat';
    }
  };

  const handleContactUs = async () => {
    if (openingAdminChat) return;
    closeMenu();
    try {
      setOpeningAdminChat(true);
      let adminId: string;
      let convId: string;
      if (adminChatCache.current) {
        ({ adminId, convId } = adminChatCache.current);
      } else {
        const foundAdmin = await findAdminUserId();
        if (!foundAdmin) {
          Alert.alert(i18n.t('noAdminFound') || 'No admin found');
          return;
        }
        adminId = foundAdmin;
        convId = await getOrCreateConversation(adminId);
        adminChatCache.current = { adminId, convId };
      }
      const pathname = chatPathnameForRole();
      const nameKey = (role === 'agent' || role === 'player') ? 'name' : 'contact';
      router.push({ pathname: pathname as any, params: { conversationId: convId, otherUserId: adminId, [nameKey]: i18n.t('adminConversation') || 'Admin' } });
    } catch (err) {
      console.error(err);
    } finally {
      setOpeningAdminChat(false);
    }
  };

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
            {groupedMenuItems.map((group) => (
              <View key={group.section} style={styles.sectionBlock}>
                <Text style={styles.sectionLabel}>{getSectionLabel(group.section)}</Text>
                <View style={styles.sectionCard}>
                  {group.items.map((item, index) => (
                    <TouchableOpacity
                      key={item.route}
                      style={[
                        styles.menuItem,
                        item.comingSoon && styles.specialMenuItemContainer,
                        index === group.items.length - 1 && styles.menuItemLast,
                      ]}
                      onPress={() => {
                        if (item.route === '__admin_chat__') {
                          handleContactUs();
                        } else if (item.comingSoon) {
                          Alert.alert(
                            i18n.t('comingSoon') || 'Coming Soon',
                            i18n.t('comingSoonMessage') || 'This feature is coming soon!',
                            [{ text: i18n.t('ok') || 'OK' }]
                          );
                        } else {
                          handleNavigate(item.route);
                        }
                      }}
                      activeOpacity={item.comingSoon ? 0.6 : 0.7}
                      disabled={item.comingSoon}
                    >
                      <Ionicons
                        name={item.icon as any}
                        size={20}
                        color={item.comingSoon ? '#bbb' : '#000'}
                        style={[styles.menuIcon, item.comingSoon && styles.comingSoonBlurredIcon]}
                      />
                      <Text style={[styles.menuText, item.comingSoon && styles.specialMenuText, item.comingSoon && styles.comingSoonBlurredText]}>
                        {item.label}
                      </Text>
                      {item.route === '/notifications' && unreadNotificationCount > 0 && (
                        <View style={styles.unreadBadge}>
                          <Text style={styles.unreadBadgeText}>
                            {unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}
                          </Text>
                        </View>
                      )}
                      {item.comingSoon && (
                        <View style={styles.diagonalBannerContainer} pointerEvents="none">
                          <View style={styles.diagonalBanner}>
                            <Text style={styles.diagonalBannerText}>{i18n.t('comingSoon') || 'Coming Soon'}</Text>
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            <View style={styles.sectionBlock}>
              <Text style={styles.sectionLabel}>{i18n.t('menuApp') || 'App'}</Text>
              <View style={styles.sectionCard}>
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
                          const nextPath = '/' + segments.join('/');
                          if (nextPath && nextPath !== '/') {
                            router.replace(nextPath as any);
                          }
                        }, 100);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[styles.langButtonText, i18n.locale === 'en' && styles.langButtonTextActive]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                      >
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
                          const nextPath = '/' + segments.join('/');
                          if (nextPath && nextPath !== '/') {
                            router.replace(nextPath as any);
                          }
                        }, 100);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[styles.langButtonText, i18n.locale === 'ar' && styles.langButtonTextActive]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.8}
                      >
                        العربية
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity
                  style={[styles.menuItem, styles.menuItemLast]}
                  onPress={() => handleNavigate('/signout')}
                  activeOpacity={0.7}
                >
                  <Ionicons name="log-out-outline" size={20} color="#ff3b30" style={styles.menuIcon} />
                  <Text style={[styles.menuText, styles.signOutText]}>
                    {i18n.t('signOut') || 'Sign Out'}
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
  },
  sectionBlock: {
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: '#666',
    marginBottom: 8,
    marginHorizontal: 8,
  },
  sectionCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  menuItemLast: {
    borderBottomWidth: 0,
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
  languageSection: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  languageLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'left',
  },
  languageRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  langButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    borderWidth: 2,
    borderColor: '#e0e0e0',
    alignItems: 'center',
    minWidth: 0,
  },
  langButtonActive: {
    backgroundColor: '#000',
    borderColor: '#000',
  },
  langButtonText: {
    flexShrink: 1,
    fontSize: 15,
    color: '#000',
    fontWeight: '600',
    textAlign: 'center',
  },
  langButtonTextActive: {
    color: '#fff',
  },
});
