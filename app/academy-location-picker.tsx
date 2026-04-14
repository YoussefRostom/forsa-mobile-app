import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import i18n from '../locales/i18n';

type PickerParams = {
  storageKey?: string;
  title?: string;
  latitude?: string;
  longitude?: string;
  city?: string;
  district?: string;
  address?: string;
  targetLocationId?: string;
};

const DEFAULT_LATITUDE = 30.0444;
const DEFAULT_LONGITUDE = 31.2357;

export default function AcademyLocationPickerScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<PickerParams>();
  const webViewRef = useRef<WebView>(null);

  const parsedLatitude = typeof params.latitude === 'string' ? Number(params.latitude) : Number.NaN;
  const parsedLongitude = typeof params.longitude === 'string' ? Number(params.longitude) : Number.NaN;
  const hasInitialSelection = Number.isFinite(parsedLatitude) && Number.isFinite(parsedLongitude);

  const [selectedLocation, setSelectedLocation] = useState<{ latitude: number; longitude: number } | null>(
    hasInitialSelection ? { latitude: parsedLatitude, longitude: parsedLongitude } : null
  );
  const [locating, setLocating] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const initialLatitude = hasInitialSelection ? parsedLatitude : DEFAULT_LATITUDE;
  const initialLongitude = hasInitialSelection ? parsedLongitude : DEFAULT_LONGITUDE;
  const title = typeof params.title === 'string' && params.title.trim()
    ? params.title.trim()
    : (i18n.t('chooseOnMap') || 'Choose on map');

  const mapHtml = useMemo(() => {
    const hintText = JSON.stringify(i18n.t('tapMapToChooseLocation') || 'Tap anywhere on the map to place the academy pin.');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <style>
            html, body, #map { height: 100%; width: 100%; margin: 0; padding: 0; }
            body { overflow: hidden; }
            .hint {
              position: absolute;
              top: 12px;
              left: 12px;
              right: 12px;
              z-index: 999;
              background: rgba(0, 0, 0, 0.78);
              color: #fff;
              padding: 10px 12px;
              border-radius: 12px;
              font-family: Arial, sans-serif;
              font-size: 13px;
              line-height: 18px;
            }
          </style>
        </head>
        <body>
          <div class="hint" id="hint"></div>
          <div id="map"></div>
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <script>
            document.getElementById('hint').innerText = ${hintText};

            const map = L.map('map', { zoomControl: true }).setView([${initialLatitude}, ${initialLongitude}], ${hasInitialSelection ? 15 : 11});
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              maxZoom: 19,
              attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);

            let marker = null;

            function postSelection(lat, lng) {
              if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ latitude: lat, longitude: lng }));
              }
            }

            function ensureMarker(lat, lng, shouldSend) {
              if (!marker) {
                marker = L.marker([lat, lng], { draggable: true }).addTo(map);
                marker.on('dragend', function () {
                  const pos = marker.getLatLng();
                  postSelection(pos.lat, pos.lng);
                });
              } else {
                marker.setLatLng([lat, lng]);
              }
              map.setView([lat, lng], Math.max(map.getZoom(), 15));
              if (shouldSend) {
                postSelection(lat, lng);
              }
            }

            if (${hasInitialSelection ? 'true' : 'false'}) {
              ensureMarker(${initialLatitude}, ${initialLongitude}, false);
            }

            map.on('click', function (event) {
              ensureMarker(event.latlng.lat, event.latlng.lng, true);
            });

            window.setMarkerFromApp = function (lat, lng) {
              ensureMarker(lat, lng, true);
            };
          </script>
        </body>
      </html>
    `;
  }, [hasInitialSelection, initialLatitude, initialLongitude]);

  const handleWebMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (Number.isFinite(data?.latitude) && Number.isFinite(data?.longitude)) {
        setSelectedLocation({ latitude: data.latitude, longitude: data.longitude });
      }
    } catch (error) {
      console.warn('Failed to parse picked map coordinates', error);
    }
  };

  const updateMapMarker = (latitude: number, longitude: number) => {
    webViewRef.current?.injectJavaScript(`window.setMarkerFromApp(${latitude}, ${longitude}); true;`);
  };

  const handleUseCurrentLocation = async () => {
    try {
      setLocating(true);
      const { status } = await Location.requestForegroundPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          i18n.t('locationPermissionNeeded') || 'Location permission needed',
          i18n.t('locationPermissionMessage') || 'Allow location access to continue.'
        );
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const nextSelection = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      };

      setSelectedLocation(nextSelection);
      updateMapMarker(nextSelection.latitude, nextSelection.longitude);
    } catch (error) {
      console.warn('Could not load current location in picker', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('locationUnavailable') || 'Could not get your location right now.');
    } finally {
      setLocating(false);
    }
  };

  const handleConfirmLocation = async () => {
    const storageKey = typeof params.storageKey === 'string' ? params.storageKey : '';

    if (!selectedLocation) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('selectLocationOnMapFirst') || 'Tap on the map to choose the academy location first.');
      return;
    }

    if (!storageKey) {
      Alert.alert(i18n.t('error') || 'Error', i18n.t('mapNotAvailable') || 'Map location is not available yet.');
      return;
    }

    try {
      setConfirming(true);
      const latitude = Number(selectedLocation.latitude.toFixed(6));
      const longitude = Number(selectedLocation.longitude.toFixed(6));

      const resolvedAddress = typeof params.address === 'string' ? params.address : '';
      const resolvedCity = typeof params.city === 'string' ? params.city : '';
      const resolvedDistrict = typeof params.district === 'string' ? params.district : '';

      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({
          latitude,
          longitude,
          address: resolvedAddress,
          city: resolvedCity,
          district: resolvedDistrict,
          targetLocationId: typeof params.targetLocationId === 'string' ? params.targetLocationId : '',
          mapUrl: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
        })
      );
      router.back();
    } catch (error) {
      console.warn('Could not save picked academy location', error);
      Alert.alert(i18n.t('error') || 'Error', i18n.t('errorMessage') || 'There was an error. Please try again.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <View style={styles.container}>
      <LinearGradient colors={['#000000', '#1a1a1a', '#2d2d2d']} style={styles.gradient}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerContent}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.headerSubtitle}>{i18n.t('chooseOnMap') || 'Choose on map'}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.topActionsRow}>
            <TouchableOpacity
              style={[styles.secondaryButton, locating && styles.buttonDisabled]}
              onPress={handleUseCurrentLocation}
              disabled={locating}
              activeOpacity={0.85}
            >
              {locating ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Ionicons name="locate-outline" size={18} color="#000" />
              )}
              <Text style={styles.secondaryButtonText}>
                {locating
                  ? (i18n.t('gettingCurrentLocation') || 'Getting current location...')
                  : (i18n.t('useCurrentLocation') || 'Use current location')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statusCard}>
            <Ionicons
              name={selectedLocation ? 'checkmark-circle' : 'pin-outline'}
              size={18}
              color={selectedLocation ? '#15803d' : '#6b7280'}
            />
            <Text style={styles.statusText}>
              {selectedLocation
                ? (i18n.t('mapPinSelected') || 'Map pin selected successfully')
                : (i18n.t('mapPinNotSelected') || 'No map pin selected yet')}
            </Text>
          </View>

          <View style={styles.mapCard}>
            <WebView
              ref={webViewRef}
              originWhitelist={['*']}
              source={{ html: mapHtml }}
              onMessage={handleWebMessage}
              javaScriptEnabled
              domStorageEnabled
              setSupportMultipleWindows={false}
              style={styles.webview}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryButton, (!selectedLocation || confirming) && styles.buttonDisabled]}
            onPress={handleConfirmLocation}
            disabled={!selectedLocation || confirming}
            activeOpacity={0.85}
          >
            {confirming ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            )}
            <Text style={styles.primaryButtonText}>{i18n.t('confirmLocation') || 'Confirm location'}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  topActionsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
  },
  mapCard: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#fff',
    minHeight: 320,
    marginBottom: 14,
  },
  webview: {
    flex: 1,
    backgroundColor: '#fff',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
});
