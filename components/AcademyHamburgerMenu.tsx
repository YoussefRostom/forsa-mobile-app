import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, I18nManager, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../locales/i18n';

interface AcademyHamburgerMenuProps {
  visible: boolean;
  onClose: () => void;
}

const AcademyHamburgerMenu: React.FC<AcademyHamburgerMenuProps> = ({ visible, onClose }) => {
  const router = useRouter();
  const options = [
    {
      label: i18n.t('academyAssistance') || 'Assistance & Extras',
      route: '/academy-services',
      special: true,
    },
    { label: i18n.t('academyFeed') || 'Academy Feed', route: '/academy-feed' },
    { label: i18n.t('scanCheckIn') || 'Scan Check-in', route: '/scan-checkin' },
    { label: i18n.t('academyEditProfile') || 'Edit Profile', route: '/academy-edit-profile' },
    { label: i18n.t('academyUploadMedia') || 'Upload Media', route: '/academy-upload-media' },
    { label: i18n.t('searchClinics') || 'Search Clinics', route: '/academy-search-clinics' },
    { label: i18n.t('myBookings') || 'My Bookings', route: '/academy-bookings' },
    { label: i18n.t('signOut') || 'Sign Out', route: '/signout' },
  ];
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.menuBox}>
          {options.map(item => (
            <TouchableOpacity
              key={item.route}
              style={[styles.menuItem, item.special && styles.specialMenuItem]}
              onPress={() => {
                onClose();
                if (item.special && item.route === '/academy-services') {
                  // Show "coming soon" popup for Assistance & Extras
                  Alert.alert(
                    i18n.t('comingSoon') || 'Coming Soon',
                    i18n.t('comingSoonMessage') || 'This feature is coming soon!',
                    [{ text: i18n.t('ok') || 'OK' }]
                  );
                } else if (item.route === '/academy-feed') {
                  router.replace(item.route as any);
                } else {
                  router.push(item.route as any);
                }
              }}
            >
              <Text style={[styles.menuText, item.special && styles.specialMenuText]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={{
              backgroundColor: '#111',
              borderRadius: 12,
              marginTop: 16,
              alignSelf: 'stretch',
              alignItems: 'center',
              paddingVertical: 10,
            }}
            onPress={() => {
              const newLang = i18n.locale === 'en' ? 'ar' : 'en';
              const isRTL = newLang === 'ar';
              i18n.locale = newLang;
              I18nManager.forceRTL(isRTL);
              I18nManager.swapLeftAndRightInRTL(isRTL);
              onClose();
            }}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 16 }}>
              {i18n.locale === 'en' ? 'العربية' : 'English'}
            </Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  menuBox: {
    marginTop: 80,
    marginLeft: 18,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 28,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 10,
    minWidth: 210,
    alignItems: 'flex-start',
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 0,
    width: '100%',
  },
  menuText: {
    fontSize: 17,
    color: '#111',
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  specialMenuItem: {
    backgroundColor: '#faf6e7', // softer off-white
    borderRadius: 10,
    marginBottom: 8,
    marginTop: -2,
    shadowColor: '#ffe066', // softer gold shadow
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#ffe066',
  },
  specialMenuText: {
    color: '#bfa100', // softer gold
    textShadowColor: 'rgba(255, 224, 102, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    fontWeight: 'bold',
    fontSize: 17,
    letterSpacing: 0.2,
  },
});
export default AcademyHamburgerMenu;
