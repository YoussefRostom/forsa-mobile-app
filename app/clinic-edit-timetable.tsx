import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useState, useEffect } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Alert } from 'react-native';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import HamburgerMenu from '../components/HamburgerMenu';
import { useHamburgerMenu } from '../components/HamburgerMenuContext';
import i18n from '../locales/i18n';

const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ClinicEditTimetableScreen = () => {
  const router = useRouter();
  const [workingHours, setWorkingHours] = useState<Record<string, { from: string; to: string; doctors: string; off?: boolean }>>({});
  const [timePicker, setTimePicker] = useState<{visible: boolean, mode: 'from' | 'to', day: string | null}>({visible: false, mode: 'from', day: null});
  const [tempTime, setTempTime] = useState(new Date());
  const { openMenu } = useHamburgerMenu();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    router.replace('/clinic-edit-services');
  }, [router]);

  // Removed fade animation to prevent color glitch on screen load
  // Screen now renders with correct colors immediately

  const formatTime = (time: string): string => {
    if (!time) return '';
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${period}`;
  };

  const handleSave = async () => {
    if (!auth.currentUser) return;
    setSaving(true);
    try {
      // Normalize working hours
      const normalizedHours: Record<string, { from: string; to: string; doctors: string; off?: boolean }> = { ...workingHours };
      for (const day of Object.keys(normalizedHours)) {
        const config = normalizedHours[day];
        if (!config.off) {
          if (!config.from) config.from = '09:00';
          if (!config.to) config.to = '17:00';
        }
      }

      await setDoc(doc(db, 'clinics', auth.currentUser.uid), { workingHours: normalizedHours }, { merge: true });
      await setDoc(doc(db, 'users', auth.currentUser.uid), { workingHours: normalizedHours }, { merge: true });

      Alert.alert(i18n.t('success') || 'Success', 'Timetable updated successfully');
    } catch (err) {
      console.error("Error saving timetable", err);
      Alert.alert(i18n.t('error') || 'Error', 'Failed to update timetable');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1a1a1a' }]}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <LinearGradient
        colors={['#000000', '#1a1a1a', '#2d2d2d']}
        style={styles.gradient}
      >
        <View style={{ flex: 1 }}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.menuButton} onPress={openMenu}>
              <Ionicons name="menu" size={24} color="#fff" />
            </TouchableOpacity>
            <View style={styles.headerContent}>
              <Text style={styles.headerTitle}>{i18n.t('editTimetable') || 'Edit Timetable'}</Text>
              <Text style={styles.headerSubtitle}>{i18n.t('manageWorkingHours') || 'Manage your working hours'}</Text>
            </View>
          </View>

          <HamburgerMenu />

          <ScrollView 
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.formCard}>
              <Text style={styles.sectionTitle}>{i18n.t('working_hours') || 'Working Hours'}</Text>
              <View style={styles.tableContainer}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, { flex: 1.5 }]}>{i18n.t('day') || 'Day'}</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1 }]}>{i18n.t('from') || 'From'}</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1 }]}>{i18n.t('to') || 'To'}</Text>
                  <Text style={[styles.tableHeaderText, { flex: 1.5 }]}>{i18n.t('doctors_present') || 'Doctors'}</Text>
                  <View style={{ flex: 0.8 }} />
      </View>
                {daysOfWeek.map((day, idx) => {
            const isDayOff = workingHours[day]?.off || false;
            return (
                    <View key={day} style={[styles.tableRow, idx % 2 === 0 && styles.tableRowEven]}>
                      <Text style={[styles.tableDayText, { flex: 1.5 }]} numberOfLines={2}>
                        {i18n.t(day) || day.charAt(0).toUpperCase() + day.slice(1)}
                      </Text>
                <TouchableOpacity
                        style={[styles.timeButton, isDayOff && styles.timeButtonDisabled]}
                  disabled={isDayOff}
                  onPress={() => {
                          const currentTime = workingHours[day]?.from || '09:00';
                          const [h, m] = currentTime.split(':');
                            const d = new Date();
                            d.setHours(Number(h));
                            d.setMinutes(Number(m));
                          setTempTime(d);
                    setTimePicker({visible: true, mode: 'from', day});
                  }}
                  activeOpacity={0.7}
                >
                        <Text style={[styles.timeText, isDayOff && styles.timeTextDisabled]}>
                          {formatTime(workingHours[day]?.from || '09:00')}
                        </Text>
                </TouchableOpacity>
                <TouchableOpacity
                        style={[styles.timeButton, isDayOff && styles.timeButtonDisabled]}
                  disabled={isDayOff}
                  onPress={() => {
                          const currentTime = workingHours[day]?.to || '17:00';
                          const [h, m] = currentTime.split(':');
                            const d = new Date();
                            d.setHours(Number(h));
                            d.setMinutes(Number(m));
                          setTempTime(d);
                    setTimePicker({visible: true, mode: 'to', day});
                  }}
                  activeOpacity={0.7}
                >
                        <Text style={[styles.timeText, isDayOff && styles.timeTextDisabled]}>
                          {formatTime(workingHours[day]?.to || '17:00')}
                        </Text>
                </TouchableOpacity>
                <TextInput
                        style={[styles.doctorsInput, { flex: 1.5 }, isDayOff && styles.doctorsInputDisabled]}
                  placeholder={i18n.t('doctors_placeholder') || 'Dr. Ahmed, Dr. Sara'}
                  value={workingHours[day]?.doctors || ''}
                        onChangeText={v => setWorkingHours((prev) => ({ ...prev, [day]: { ...prev[day], doctors: v, from: prev[day]?.from || '09:00', to: prev[day]?.to || '17:00' } }))}
                  editable={!isDayOff}
                        placeholderTextColor="#999"
                />
                <TouchableOpacity
                        style={[styles.offButton, isDayOff && styles.offButtonActive]}
                        onPress={() => setWorkingHours(prev => ({ 
                          ...prev, 
                          [day]: { 
                            ...prev[day], 
                            off: !isDayOff,
                            from: prev[day]?.from || '09:00',
                            to: prev[day]?.to || '17:00',
                            doctors: prev[day]?.doctors || ''
                          } 
                        }))}
                  activeOpacity={0.8}
                >
                        <Text style={[styles.offButtonText, isDayOff && styles.offButtonTextActive]}>
                          {isDayOff ? (i18n.t('off') || 'Off') : (i18n.t('set_off') || 'Set Off')}
                        </Text>
                </TouchableOpacity>
              </View>
            );
          })}
              </View>
              <TouchableOpacity
                style={[styles.saveButton, saving && { opacity: 0.7 }]}
                activeOpacity={0.8}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonText}>{i18n.t('save') || 'Save'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Time Picker Modal */}
          {timePicker.visible && timePicker.day && (
            <Modal visible={true} transparent animationType="fade" onRequestClose={() => setTimePicker({visible: false, mode: 'from', day: null})}>
              <View style={styles.timePickerOverlay}>
                <View style={styles.timePickerCard}>
                  <View style={styles.timePickerHeader}>
                    <Text style={styles.timePickerTitle}>{i18n.t('select_time') || 'Select Time'}</Text>
                    <TouchableOpacity onPress={() => setTimePicker({visible: false, mode: 'from', day: null})}>
                      <Ionicons name="close" size={24} color="#000" />
                    </TouchableOpacity>
                  </View>
                <DateTimePicker
                  value={tempTime}
                  mode="time"
                  is24Hour={true}
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(event, selectedDate) => {
                    if (event.type === 'set' && selectedDate) {
                      setTempTime(selectedDate);
                    }
                  }}
                    textColor="#000"
                />
                  <View style={styles.timePickerActions}>
                    <TouchableOpacity 
                      style={styles.timePickerCancel} 
                      onPress={() => setTimePicker({visible: false, mode: 'from', day: null})}
                    >
                      <Text style={styles.timePickerCancelText}>{i18n.t('cancel') || 'Cancel'}</Text>
                  </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.timePickerOk} 
                      onPress={() => {
                    if (timePicker.day) {
                      const hours = tempTime.getHours().toString().padStart(2, '0');
                      const minutes = tempTime.getMinutes().toString().padStart(2, '0');
                      const timeStr = `${hours}:${minutes}`;
                      setWorkingHours(prev => ({
                        ...prev,
                        [timePicker.day as string]: {
                          ...prev[timePicker.day as string],
                              [timePicker.mode]: timeStr,
                              from: prev[timePicker.day as string]?.from || '09:00',
                              to: prev[timePicker.day as string]?.to || '17:00',
                              doctors: prev[timePicker.day as string]?.doctors || '',
                        }
                      }));
                    }
                    setTimePicker({visible: false, mode: 'from', day: null});
                      }}
                    >
                      <Text style={styles.timePickerOkText}>{i18n.t('ok') || 'OK'}</Text>
                  </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          )}
        </View>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  gradient: {
    flex: 1,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    paddingBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  headerContent: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    textAlign: 'center',
  },
  headerSubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  formCard: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 24,
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 20,
  },
  tableContainer: {
    marginBottom: 20,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  tableHeaderText: {
    fontWeight: 'bold',
    color: '#000',
    textAlign: 'center',
    fontSize: 14,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginBottom: 4,
  },
  tableRowEven: {
    backgroundColor: '#f9f9f9',
  },
  tableDayText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  timeButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    backgroundColor: '#fff',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  timeButtonDisabled: {
    backgroundColor: '#f0f0f0',
    opacity: 0.5,
  },
  timeText: {
    color: '#000',
    fontSize: 13,
  },
  timeTextDisabled: {
    color: '#999',
  },
  doctorsInput: {
    flex: 1.5,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    fontSize: 13,
    backgroundColor: '#fff',
    marginHorizontal: 4,
    color: '#000',
  },
  doctorsInputDisabled: {
    backgroundColor: '#f0f0f0',
    opacity: 0.5,
  },
  offButton: {
    flex: 0.8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    paddingVertical: 8,
    marginHorizontal: 4,
  },
  offButtonActive: {
    backgroundColor: '#ff3b30',
    borderColor: '#ff3b30',
  },
  offButtonText: {
    color: '#ff3b30',
    fontWeight: 'bold',
    fontSize: 12,
  },
  offButtonTextActive: {
    color: '#fff',
  },
  saveButton: {
    backgroundColor: '#000',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  timePickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  timePickerCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    width: '90%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  timePickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  timePickerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000',
  },
  timePickerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  timePickerCancel: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  timePickerCancelText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 16,
  },
  timePickerOk: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  timePickerOkText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default ClinicEditTimetableScreen;
