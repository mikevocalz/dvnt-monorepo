import { View } from 'react-native'
import { ID_HOLE } from './ScanOverlay'

type Box = {
  text: string
  boundingBox?: { x: number; y: number; width: number; height: number }
}

export function OCRBoundingBoxes({ blocks }: { blocks: Box[] }) {
  return (
    <View pointerEvents="none" className="absolute inset-0">
      {blocks.map((b, i) => {
        const bb = b.boundingBox
        if (!bb) return null

        const { x, y, width, height } = bb

        const inside =
          x >= ID_HOLE.x &&
          y >= ID_HOLE.y &&
          x + width <= ID_HOLE.x + ID_HOLE.width &&
          y + height <= ID_HOLE.y + ID_HOLE.height

        if (!inside) return null

        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width,
              height,
              borderWidth: 1,
              borderColor: 'rgba(34,197,94,0.9)',
              borderRadius: 4
            }}
          />
        )
      })}
    </View>
  )
}
