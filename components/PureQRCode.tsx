import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

type PureQRCodeProps = {
  value: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  quietZone?: number;
};

type QRGeneratorInstance = {
  addData: (value: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, column: number) => boolean;
};

function buildMatrix(value: string) {
  // `qrcode-generator` is a tiny pure-JS QR encoder, which avoids the
  // native/SVG bundling issue from react-native-qrcode-svg on iOS.
  const createQRCode = require('qrcode-generator');
  const qr: QRGeneratorInstance = createQRCode(0, 'M');

  qr.addData(value || 'forsa_checkin:unavailable');
  qr.make();

  const count = qr.getModuleCount();
  const modules = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, column) => qr.isDark(row, column))
  );

  return { count, modules };
}

export default function PureQRCode({
  value,
  size = 220,
  color = '#111',
  backgroundColor = '#fff',
  quietZone = 12,
}: PureQRCodeProps) {
  const { count, modules } = useMemo(() => buildMatrix(value), [value]);
  const cellSize = (size - quietZone * 2) / count;

  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          padding: quietZone,
          backgroundColor,
        },
      ]}
    >
      <View style={{ width: size - quietZone * 2, height: size - quietZone * 2 }}>
        {modules.map((row, rowIndex) => (
          <View key={`row-${rowIndex}`} style={{ flexDirection: 'row', height: cellSize }}>
            {row.map((isDark, columnIndex) => (
              <View
                key={`cell-${rowIndex}-${columnIndex}`}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: isDark ? color : backgroundColor,
                }}
              />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
