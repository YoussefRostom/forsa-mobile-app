import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import PureQRCode from '../components/PureQRCode';
import i18n from '../locales/i18n';
import { getCurrentUserCheckInCode, ensureCheckInCodeForCurrentUser } from '../services/CheckInCodeService';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

function SimpleQRCode({ value, size = 250 }: { value: string; size?: number }) {
  return <PureQRCode value={value || 'forsa_checkin:unavailable'} size={size} color="#000" backgroundColor="#fff" quietZone={12} />;
}

export default function MyQrCodeScreen() {
  const router = useRouter();
  const [checkInCode, setCheckInCode] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    loadQRCode();
  }, []);

  const loadQRCode = async () => {
    try {
      setLoading(true);
      
      // Get current user's check-in code
      let code = await getCurrentUserCheckInCode();
      
      // If no code exists, generate one (for player/parent roles)
      if (!code) {
        setGenerating(true);
        try {
          code = await ensureCheckInCodeForCurrentUser();
        } catch (error: any) {
          console.error('Error generating check-in code:', error);
          Alert.alert(i18n.t('error') || 'Error', i18n.t('checkInFailedTryAgain') || 'Failed to process check-in. Please try again.');
          router.back();
          return;
        } finally {
          setGenerating(false);
        }
      }
      
      setCheckInCode(code);
      
      // Get user name
      const user = auth.currentUser;
      if (user) {
        const userRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userRef);
        if (userDoc.exists()) {
          const userData = userDoc.data();
          if (userData.firstName && userData.lastName) {
            setUserName(`${userData.firstName} ${userData.lastName}`);
          } else if (userData.firstName || userData.lastName) {
            setUserName(userData.firstName || userData.lastName);
          } else if (userData.parentName) {
            setUserName(userData.parentName);
          } else if (userData.email) {
            setUserName(userData.email.split('@')[0]);
          }
        }
      }
    } catch (error: any) {
      console.error('Error loading QR code:', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('qrCodeUnavailable') || 'QR code not available');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async () => {
    if (checkInCode) {
      await Clipboard.setStringAsync(checkInCode);
      Alert.alert(i18n.t('copied') || 'Copied', i18n.t('checkInCodeCopied') || 'Check-in code copied to clipboard');
    }
  };

  const qrPayload = checkInCode ? `forsa_checkin:${checkInCode}` : '';

  if (loading || generating) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('myQrCode') || 'My QR Code'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>
            {generating ? (i18n.t('generatingQrCode') || 'Generating QR code...') : (i18n.t('loading') || 'Loading...')}
          </Text>
        </View>
      </View>
    );
  }

  if (!checkInCode) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{i18n.t('myQrCode') || 'My QR Code'}</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={64} color="#FF3B30" />
          <Text style={styles.errorText}>{i18n.t('qrCodeUnavailable') || 'QR code not available'}</Text>
          <Text style={styles.errorSubtext}>
            {i18n.t('checkInCodesLimited') || 'Check-in codes are only available for players and parents.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#000" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{i18n.t('myQrCode') || 'My QR Code'}</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.card}>
        {userName && (
          <Text style={styles.userName}>{userName}</Text>
        )}
        
        <View style={styles.qrWrapper}>
          <SimpleQRCode value={qrPayload} size={250} />
        </View>

        <View style={styles.codeContainer}>
          <Text style={styles.codeLabel}>{i18n.t('checkInCode') || 'Check-in Code'}</Text>
          <TouchableOpacity
            style={styles.codeBox}
            onPress={copyCode}
            activeOpacity={0.7}
          >
            <Text style={styles.codeText}>{checkInCode}</Text>
            <Ionicons name="copy-outline" size={20} color="#007AFF" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.copyButton}
          onPress={copyCode}
          activeOpacity={0.7}
        >
          <Ionicons name="copy" size={20} color="#fff" />
          <Text style={styles.copyButtonText}>{i18n.t('copyCode') || 'Copy Code'}</Text>
        </TouchableOpacity>

        <View style={styles.infoBox}>
          <Ionicons name="information-circle-outline" size={20} color="#666" />
          <Text style={styles.infoText}>
            {i18n.t('showQrToStaff') || 'Show this QR code to academy or clinic staff to check in.'}
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 50 : 50,
    paddingBottom: 16,
    paddingHorizontal: 4,
    marginBottom: 20,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  errorText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginTop: 16,
    textAlign: 'center',
  },
  errorSubtext: {
    fontSize: 14,
    color: '#666',
    marginTop: 8,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  userName: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginBottom: 24,
  },
  qrWrapper: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: '#f0f0f0',
  },
  qrPlaceholder: {
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
  },
  qrPlaceholderText: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  qrPlaceholderSubtext: {
    marginTop: 4,
    fontSize: 10,
    color: '#666',
    paddingHorizontal: 8,
  },
  codeContainer: {
    width: '100%',
    marginBottom: 16,
  },
  codeLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  codeText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 1,
  },
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    gap: 8,
  },
  copyButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#f0f7ff',
    padding: 16,
    borderRadius: 12,
    marginTop: 24,
    gap: 12,
  },
  infoText: {
    flex: 1,
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});

