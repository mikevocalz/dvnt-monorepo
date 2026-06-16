import { Dimensions, StyleSheet } from 'react-native'
import { RNHoleView } from 'react-native-hole-view'

const { width, height } = Dimensions.get('window')

export const FACE_OVAL = {
  width: width * 0.65,
  height: width * 0.82,
  x: (width - width * 0.65) / 2,
  y: height * 0.16
}

export function FaceOverlay() {
  return (
    <RNHoleView
      style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
      holes={[
        {
          x: FACE_OVAL.x,
          y: FACE_OVAL.y,
          width: FACE_OVAL.width,
          height: FACE_OVAL.height,
          borderRadius: FACE_OVAL.width
        }
      ]}
    />
  )
}
