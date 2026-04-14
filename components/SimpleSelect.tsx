import React from 'react';
import { FlatList, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import i18n from '../locales/i18n';

interface SimpleSelectProps {
  visible: boolean;
  options: string[];
  selected: string;
  onSelect: (val: string) => void;
  onClose: () => void;
  label: string;
  getLabel?: (val: string) => string;
}

export default function SimpleSelect({ visible, options, selected, onSelect, onClose, label, getLabel }: SimpleSelectProps) {
  // If label is 'Date of Birth', show the localized age label instead
  const displayLabel = label === 'Date of Birth' || label === 'تاريخ الميلاد'
    ? (i18n.t('age') || 'Age')
    : label;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.modalBox}>
          <Text style={styles.label}>{displayLabel}</Text>
          <FlatList
            data={options}
            keyExtractor={item => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.option, item === selected && styles.selectedOption]}
                onPress={() => { onSelect(item); onClose(); }}
              >
                <Text style={[styles.optionText, item === selected && styles.selectedText]}>{getLabel ? getLabel(item) : item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBox: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    minWidth: 220,
    maxHeight: 340,
    elevation: 4,
  },
  label: {
    fontWeight: 'bold',
    fontSize: 18,
    marginBottom: 12,
    color: '#000',
    textAlign: 'center',
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  selectedOption: {
    backgroundColor: '#000',
  },
  optionText: {
    fontSize: 16,
    color: '#000',
    textAlign: 'center',
  },
  selectedText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});
