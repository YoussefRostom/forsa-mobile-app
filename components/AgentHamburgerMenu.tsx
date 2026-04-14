import { useRouter } from 'expo-router';
import React from 'react';
import { I18nManager, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../locales/i18n';

interface AgentHamburgerMenuProps {
  visible: boolean;
  onClose: () => void;
  extraOptions?: Array<{ label: string; route: string }>;
}

const AgentHamburgerMenu: React.FC<AgentHamburgerMenuProps> = ({ visible, onClose, extraOptions = [] }) => {
  const router = useRouter();
  const options = [
    {
      label: i18n.t('agentAssistance') || 'Assistance & Extras',
      route: '/agent-services',
      special: true,
    },
    { label: i18n.t('agentFeed') || 'Feed', route: '/agent-feed' },
    { label: i18n.t('agentEditProfile') || 'Edit Profile', route: '/agent-edit-profile' },
    { label: i18n.t('agentPlayers') || 'Players', route: '/agent-players' },
    { label: i18n.t('messages') || 'Messages', route: '/agent-contacts' },
    { label: i18n.t('uploadMedia') || 'Upload Media', route: '/agent-upload-media' },
      { label: i18n.t('myMedia') || 'My Media', route: '/agent-my-media' },
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
                if (item.route === '/agent-feed') {
                  router.replace(item.route as any);
                } else {
                  router.push(item.route as any);
                }
              }}
            >
              <Text style={[styles.menuText, item.special && styles.specialMenuText]}>{item.label}</Text>
            </TouchableOpacity>
          ))}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#000', borderRadius: 8, paddingHorizontal: 16 }]} onPress={() => { 
              i18n.locale = 'en';
              I18nManager.forceRTL(false);
              I18nManager.swapLeftAndRightInRTL(false);
              onClose();
            }}>
              <Text style={[styles.menuText, { color: '#fff' }]}>English</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.menuItem, { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: '#000' }]} onPress={() => { 
              i18n.locale = 'ar';
              I18nManager.forceRTL(true);
              I18nManager.swapLeftAndRightInRTL(true);
              onClose();
            }}>
              <Text style={[styles.menuText, { color: '#000' }]}>العربية</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

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
    borderRadius: 16,
    paddingVertical: 18,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    minWidth: 180,
  },
  menuItem: {
    paddingVertical: 12,
  },
  menuText: {
    fontSize: 17,
    color: '#222',
    fontWeight: 'bold',
  },
  specialMenuItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 6,
    marginTop: -6,
    shadowColor: '#bfa100', // more muted gold
    shadowOpacity: 0.22,
    shadowRadius: 5,
    elevation: 3,
  },
  specialMenuText: {
    color: '#bfa100', // gold-blackish
    textShadowColor: '#bfa100',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
    fontWeight: 'bold',
    fontSize: 18,
  },
});
export default AgentHamburgerMenu;
