'use client';

import React, { useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
import QRCodeEncoder from 'qrcode';

type QRCodeProps = {
  value?: string;
  size?: number;
  color?: string;
  backgroundColor?: string;
  quietZone?: number;
  ecl?: 'L' | 'M' | 'Q' | 'H';
  testID?: string;
};

export default function QRCode({
  value = ' ',
  size = 100,
  color = '#000',
  backgroundColor = '#fff',
  quietZone = 0,
  ecl = 'M',
  testID,
}: QRCodeProps) {
  const qr = useMemo(
    () => QRCodeEncoder.create(value || ' ', { errorCorrectionLevel: ecl }),
    [ecl, value],
  );
  const moduleCount = qr.modules.size;
  const cellSize = (size - quietZone * 2) / moduleCount;

  return (
    <Svg height={size} testID={testID} viewBox={`0 0 ${size} ${size}`} width={size}>
      <Rect fill={backgroundColor} height={size} width={size} x={0} y={0} />
      {qr.modules.data.map((isDark: boolean, index: number) => {
        if (!isDark) return null;
        const x = index % moduleCount;
        const y = Math.floor(index / moduleCount);
        return (
          <Rect
            fill={color}
            height={cellSize}
            key={index}
            width={cellSize}
            x={quietZone + x * cellSize}
            y={quietZone + y * cellSize}
          />
        );
      })}
    </Svg>
  );
}
